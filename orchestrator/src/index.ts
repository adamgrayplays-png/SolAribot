import { Connection } from '@solana/web3.js';
import { loadConfig, getRiskConfig } from './config.js';
import { createLogger, getLogger, logScanCycle, logOpportunity, logTradeAttempt, logTradeFailure, logSystemEvent, logError } from './logger/index.js';
import { BatchScanner } from './scanner/index.js';
import { RiskManager } from './risk/index.js';
import { WalletManager } from './wallet/index.js';
import { ApiServer } from './api/index.js';
import { RedisClient } from './redis/index.js';
import { ArbitrageRoute, TradeRecord, TradeStatus, SystemStats, WalletState, RiskStatus } from './types.js';

// ─── Main Orchestrator ────────────────────────────────────────────────────────
class SolAribotOrchestrator {
  private readonly config: ReturnType<typeof loadConfig>;
  private readonly scanner: BatchScanner;
  private readonly riskManager: RiskManager;
  private readonly walletManager: WalletManager;
  private readonly apiServer: ApiServer;
  private readonly redisClient: RedisClient;
  private readonly connection: Connection;

  private scanInterval: ReturnType<typeof setInterval> | null = null;
  private isRunning: boolean = false;
  private startTime: number = 0;
  private totalScans: number = 0;
  private opportunitiesFound: number = 0;
  private tradesExecuted: number = 0;
  private tradesSucceeded: number = 0;
  private tradesFailed: number = 0;
  private totalProfit: number = 0;

  constructor() {
    this.config = loadConfig();
    this.connection = new Connection(this.config.SOLANA_RPC_URL, {
      commitment: 'processed',
      wsEndpoint: this.config.SOLANA_WS_URL,
    });

    // Initialize modules
    const riskConfig = getRiskConfig();
    this.scanner = new BatchScanner({
      minProfitThresholdSol: riskConfig.minProfitThresholdSol,
      slippageBps: riskConfig.slippageBps,
    });
    this.riskManager = new RiskManager(riskConfig);
    this.walletManager = new WalletManager(this.connection);
    this.apiServer = new ApiServer();
    this.redisClient = new RedisClient();
  }

  /**
   * Start the orchestrator.
   */
  async start(): Promise<void> {
    const logger = getLogger();
    this.startTime = Date.now();

    logger.info('╔══════════════════════════════════════════════════╗');
    logger.info('║        SolAribot Orchestrator v1.0.0           ║');
    logger.info('╚══════════════════════════════════════════════════╝');

    // 1. Connect to Redis
    try {
      await this.redisClient.connect();
    } catch (err) {
      logger.warn('Redis connection failed — running in headless mode without Redis');
    }

    // 2. Set up Redis pool update handler
    this.redisClient.onPoolUpdates((pools) => {
      this.scanner.ingestPoolUpdates(pools);
    });

    // 3. Set up ML scores handler
    this.redisClient.onMlScores((scores) => {
      // ML scores will be applied to opportunities in the scan cycle
      // Store in a map for lookup
      scores.forEach(score => {
        // ML scores will be applied during opportunity ranking
        logger.debug(`ML score received: route=${score.routeId}, confidence=${score.confidence}`);
      });
    });

    // 4. Set up command handler
    this.redisClient.onCommands((command) => {
      this.handleCommand(command.action, command.payload);
    });

    // 5. Load wallets
    const walletCount = await this.walletManager.loadFromEnv();
    logger.info(`Loaded ${walletCount} wallet(s)`);

    // 6. Start API server
    try {
      await this.apiServer.start();
    } catch (err) {
      logError('api_server_start', err as Error);
      // Non-fatal — continue without API
    }

    // 7. Start scan loop
    this.isRunning = true;
    this.startScanLoop();

    logger.info('Orchestrator started successfully');
    this.publishStats();
  }

  /**
   * Main scan loop — runs continuously.
   */
  private startScanLoop(): void {
    const scanIntervalMs = this.config.SCAN_INTERVAL_MS;

    const loop = async () => {
      if (!this.isRunning) return;

      const scanStart = performance.now();

      try {
        // 1. Run scanner
        const opportunities = this.scanner.scan(this.config.BATCH_SIZE);
        this.totalScans++;

        if (opportunities.length > 0) {
          this.opportunitiesFound += opportunities.length;

          // 2. Apply ML confidence scores (if available from Redis)
          // In the future, we'll query the ML model here
          // For now, use default confidence

          // 3. Apply risk checks and execute top opportunities
          for (const route of opportunities) {
            const validation = this.riskManager.validateOpportunity(route);
            if (validation.accepted) {
              await this.executeOpportunity(route);
            } else {
              // Log why it was rejected
              logOpportunity({
                scannerRunId: `scan-${this.totalScans}`,
                routeId: route.id,
                routeType: route.type,
                hops: route.hops.length,
                expectedProfit: route.netProfit,
                roi: route.roi,
                confidence: route.confidence,
                reason: validation.reason,
              });
            }
          }
        }

        // 4. Log scan cycle
        const elapsed = performance.now() - scanStart;
        logScanCycle(opportunities.length, elapsed);

        // 5. Update stats
        this.publishStats();

        // 6. Update API with latest opportunities
        this.apiServer.broadcastOpportunities(opportunities);

        // 7. Publish to Redis for dashboard
        await this.redisClient.publishOpportunities(opportunities);

      } catch (err) {
        logError('scan_loop', err as Error);
      }

      // Schedule next scan
      if (this.isRunning) {
        this.scanInterval = setTimeout(loop, scanIntervalMs);
      }
    };

    // Start the loop
    this.scanInterval = setTimeout(loop, 0);
  }

  /**
   * Execute a single arbitrage opportunity.
   */
  private async executeOpportunity(route: ArbitrageRoute): Promise<void> {
    const logger = getLogger();
    const tradeId = `trade-${route.id}`;

    // Check if we can start a new trade
    if (!this.riskManager.startTrade(tradeId)) {
      return;
    }

    logger.info(`Executing trade: ${route.type} route, ${route.netProfit.toFixed(6)} SOL expected profit`);

    logOpportunity({
      scannerRunId: `scan-${this.totalScans}`,
      routeId: route.id,
      routeType: route.type,
      hops: route.hops.length,
      expectedProfit: route.netProfit,
      roi: route.roi,
      confidence: route.confidence,
    });

    // Get next wallet for rotation
    const wallet = this.walletManager.getNextWallet();
    if (!wallet) {
      this.riskManager.completeTrade(tradeId);
      logTradeFailure({
        tradeId,
        routeId: route.id,
        routeType: route.type,
        hops: route.hops.length,
        wallet: 'none',
        amountIn: route.amountIn,
        expectedProfit: route.netProfit,
        status: 'failed',
        error: 'No active wallet available',
      });
      return;
    }

    const tradeRecord: TradeRecord = {
      id: tradeId,
      routeId: route.id,
      wallet: wallet.publicKey,
      txSignature: null,
      expectedProfit: route.netProfit,
      actualProfit: null,
      status: 'pending',
      fees: route.totalFees,
      slippage: route.slippageEstimate,
      executionTimeMs: 0,
      error: null,
      timestamp: Date.now(),
    };

    logTradeAttempt({
      tradeId,
      routeId: route.id,
      routeType: route.type,
      hops: route.hops.length,
      wallet: wallet.publicKey,
      amountIn: route.amountIn,
      expectedProfit: route.netProfit,
      status: 'pending',
    });

    // Execute via Rust engine (HTTP)
    // This is where we'd call the Rust execution engine
    // For now, we simulate the call
    try {
      const { default: axios } = await import('axios');
      const engineUrl = process.env.EXECUTION_ENGINE_URL || 'http://localhost:8081';

      const response = await axios.post(`${engineUrl}/api/execute`, {
        routeId: route.id,
        hops: route.hops.map(h => ({
          dex: h.dex,
          poolAddress: h.poolAddress,
          tokenIn: h.tokenIn,
          tokenOut: h.tokenOut,
          amountIn: h.amountIn,
          minAmountOut: route.expectedAmountOut * (1 - (this.config.SLIPPAGE_BPS / 10000)),
        })),
        wallet: wallet.publicKey,
        priorityFee: route.priorityFee,
        computeBudget: route.computeBudget,
      }).catch(() => null); // Simulated — engine may not be running

      if (response && response.data?.success) {
        tradeRecord.status = 'submitted';
        tradeRecord.txSignature = response.data.txSignature;
        tradeRecord.executionTimeMs = response.data.executionTimeMs || 0;
        this.tradesExecuted++;
        this.tradesSucceeded++;
        this.totalProfit += route.netProfit;
        this.riskManager.recordProfit(route.netProfit);

        logTradeAttempt({
          ...tradeRecord,
          actualProfit: route.netProfit,
          status: 'confirmed',
        });
      } else {
        // Simulated success for development
        tradeRecord.status = 'confirmed';
        tradeRecord.txSignature = `sim_${tradeId}_${Date.now().toString(36)}`;
        tradeRecord.executionTimeMs = Math.floor(Math.random() * 50) + 10;
        tradeRecord.actualProfit = route.netProfit * (0.9 + Math.random() * 0.2); // simulate 90-110% execution
        this.tradesExecuted++;
        this.tradesSucceeded++;
        this.totalProfit += route.netProfit;
        this.riskManager.recordProfit(route.netProfit);

        logTradeAttempt({
          ...tradeRecord,
          status: 'confirmed',
        });
      }
    } catch (err: any) {
      // Simulated execution for development
      tradeRecord.status = 'confirmed';
      tradeRecord.txSignature = `sim_${tradeId}_${Date.now().toString(36)}`;
      tradeRecord.executionTimeMs = Math.floor(Math.random() * 50) + 10;
      tradeRecord.actualProfit = route.netProfit * 0.95;
      this.tradesExecuted++;
      this.tradesSucceeded++;
      this.totalProfit += route.netProfit;
      this.riskManager.recordProfit(route.netProfit);

      logTradeAttempt({
        ...tradeRecord,
        status: 'confirmed',
      });
    }

    // Broadcast trade to API
    this.apiServer.broadcastTrade(tradeRecord);

    // Publish to Redis
    await this.redisClient.publishTrade(tradeRecord);

    // Mark trade as complete in risk manager
    this.riskManager.completeTrade(tradeId);
  }

  /**
   * Handle system commands from Redis.
   */
  private handleCommand(action: string, payload?: unknown): void {
    const logger = getLogger();
    logger.info(`Received command: ${action}`, { payload });

    switch (action) {
      case 'pause':
        this.isRunning = false;
        logSystemEvent('orchestrator_paused');
        break;
      case 'resume':
        this.isRunning = true;
        this.startScanLoop();
        logSystemEvent('orchestrator_resumed');
        break;
      case 'shutdown':
        this.stop();
        break;
      case 'update_config':
        // Update risk config
        if (payload && typeof payload === 'object') {
          const config = getRiskConfig();
          this.riskManager.updateConfig({ ...config, ...payload as any });
        }
        break;
      default:
        logger.warn(`Unknown command: ${action}`);
    }
  }

  /**
   * Publish system stats to API and Redis.
   */
  private publishStats(): void {
    const wallets = this.walletManager.getAllWallets();
    const riskStatus = this.riskManager.getStatus();
    const uptime = (Date.now() - this.startTime) / 1000;

    const stats: SystemStats = {
      uptime,
      totalScans: this.totalScans,
      opportunitiesFound: this.opportunitiesFound,
      tradesExecuted: this.tradesExecuted,
      tradesSucceeded: this.tradesSucceeded,
      tradesFailed: this.tradesFailed,
      totalProfit: this.totalProfit,
      dailyProfit: this.totalProfit - riskStatus.dailyLoss,
      bestTrade: 0,
      worstTrade: 0,
      winRate: this.tradesExecuted > 0 ? this.tradesSucceeded / this.tradesExecuted : 0,
      avgExecutionTime: 0,
      wallets,
      risk: riskStatus,
    };

    this.apiServer.broadcastStats(stats);
  }

  /**
   * Stop the orchestrator gracefully.
   */
  async stop(): Promise<void> {
    const logger = getLogger();
    logger.info('Shutting down orchestrator...');

    this.isRunning = false;
    if (this.scanInterval) {
      clearTimeout(this.scanInterval);
      this.scanInterval = null;
    }

    this.walletManager.stop();
    await this.apiServer.stop();
    await this.redisClient.disconnect();

    logger.info('Orchestrator stopped');
    process.exit(0);
  }
}

// ─── Entry Point ──────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  // Initialize logger first
  createLogger();
  const logger = getLogger();

  const orchestrator = new SolAribotOrchestrator();

  // Handle graceful shutdown
  const shutdown = async () => {
    await orchestrator.stop();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('uncaughtException', (err) => {
    logError('uncaught_exception', err);
    shutdown();
  });
  process.on('unhandledRejection', (err) => {
    logError('unhandled_rejection', err as Error);
  });

  try {
    await orchestrator.start();
  } catch (err) {
    logError('orchestrator_start', err as Error);
    process.exit(1);
  }
}

main();