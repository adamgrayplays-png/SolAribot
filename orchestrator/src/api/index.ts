import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyCors from '@fastify/cors';
import { ArbitrageRoute, ApiResponse, WsMessage, SystemStats, TradeRecord, RiskStatus, WalletState } from '../types.js';
import { loadConfig } from '../config.js';
import { getLogger, logSystemEvent, logError } from '../logger/index.js';

// ─── WebSocket Client Manager ─────────────────────────────────────────────────
class WsClientManager {
  private clients: Set<import('ws').WebSocket> = new Set();

  add(ws: import('ws').WebSocket): void {
    this.clients.add(ws);
    ws.on('close', () => this.clients.delete(ws));
    ws.on('error', () => this.clients.delete(ws));
  }

  broadcast<T>(type: string, payload: T): void {
    const message: WsMessage<T> = {
      type,
      payload,
      timestamp: Date.now(),
    };
    const data = JSON.stringify(message);

    for (const ws of this.clients) {
      if (ws.readyState === ws.OPEN) {
        try {
          ws.send(data);
        } catch {
          this.clients.delete(ws);
        }
      }
    }
  }

  get clientCount(): number {
    return this.clients.size;
  }
}

// ─── API Server ───────────────────────────────────────────────────────────────
export class ApiServer {
  private app: ReturnType<typeof Fastify>;
  private port: number;
  private wsManager: WsClientManager = new WsClientManager();

  // State references (set by orchestrator)
  latestOpportunities: ArbitrageRoute[] = [];
  tradeHistory: TradeRecord[] = [];
  systemStats: SystemStats | null = null;
  walletStates: WalletState[] = [];
  riskStatus: RiskStatus | null = null;

  constructor() {
    const config = loadConfig();
    this.port = config.API_PORT;

    this.app = Fastify({
      logger: false, // We use our own pino logger
    });
  }

  async start(): Promise<void> {
    const logger = getLogger();

    // Register plugins
    await this.app.register(fastifyCors, {
      origin: true,
      methods: ['GET', 'POST', 'OPTIONS'],
    });

    await this.app.register(fastifyWebsocket);

    // ── REST Routes ──────────────────────────────────────────────────────

    // Health check
    this.app.get('/api/health', async () => {
      const response: ApiResponse<{ status: string; uptime: number; clients: number }> = {
        success: true,
        data: {
          status: 'healthy',
          uptime: process.uptime(),
          clients: this.wsManager.clientCount,
        },
        timestamp: Date.now(),
      };
      return response;
    });

    // Live opportunities (ranked)
    this.app.get('/api/opportunities', async (request) => {
      const query = request.query as { limit?: string };
      const limit = Math.min(parseInt(query.limit || '50', 10) || 50, 200);
      const opportunities = this.latestOpportunities.slice(0, limit);

      const response: ApiResponse<ArbitrageRoute[]> = {
        success: true,
        data: opportunities,
        timestamp: Date.now(),
      };
      return response;
    });

    // System stats
    this.app.get('/api/stats', async () => {
      const response: ApiResponse<SystemStats | null> = {
        success: true,
        data: this.systemStats,
        timestamp: Date.now(),
      };
      return response;
    });

    // Trade history
    this.app.get('/api/trades', async (request) => {
      const query = request.query as { limit?: string };
      const limit = Math.min(parseInt(query.limit || '50', 10) || 50, 200);
      const response: ApiResponse<TradeRecord[]> = {
        success: true,
        data: this.tradeHistory.slice(-limit).reverse(),
        timestamp: Date.now(),
      };
      return response;
    });

    // Wallet status
    this.app.get('/api/wallets', async () => {
      const response: ApiResponse<WalletState[]> = {
        success: true,
        data: this.walletStates,
        timestamp: Date.now(),
      };
      return response;
    });

    // Risk status
    this.app.get('/api/risk', async () => {
      const response: ApiResponse<RiskStatus | null> = {
        success: true,
        data: this.riskStatus,
        timestamp: Date.now(),
      };
      return response;
    });

    // ── WebSocket Routes ─────────────────────────────────────────────────

    this.app.get('/ws/opportunities', { websocket: true }, (socket, req) => {
      this.wsManager.add(socket);

      // Send latest opportunities immediately on connect
      const initMsg: WsMessage<ArbitrageRoute[]> = {
        type: 'opportunities',
        payload: this.latestOpportunities.slice(0, 50),
        timestamp: Date.now(),
      };
      socket.send(JSON.stringify(initMsg));

      logSystemEvent('ws_client_connected', { endpoint: 'opportunities', clientCount: this.wsManager.clientCount });
    });

    this.app.get('/ws/stats', { websocket: true }, (socket, req) => {
      this.wsManager.add(socket);

      // Send latest stats immediately on connect
      if (this.systemStats) {
        const initMsg: WsMessage<SystemStats> = {
          type: 'stats',
          payload: this.systemStats,
          timestamp: Date.now(),
        };
        socket.send(JSON.stringify(initMsg));
      }

      logSystemEvent('ws_client_connected', { endpoint: 'stats', clientCount: this.wsManager.clientCount });
    });

    this.app.get('/ws/trades', { websocket: true }, (socket, req) => {
      this.wsManager.add(socket);

      // Send trade history immediately on connect
      const initMsg: WsMessage<TradeRecord[]> = {
        type: 'trades',
        payload: this.tradeHistory.slice(-50).reverse(),
        timestamp: Date.now(),
      };
      socket.send(JSON.stringify(initMsg));

      logSystemEvent('ws_client_connected', { endpoint: 'trades', clientCount: this.wsManager.clientCount });
    });

    // Start listening
    try {
      await this.app.listen({ port: this.port, host: '0.0.0.0' });
      logger.info(`API server listening on port ${this.port}`);
    } catch (err) {
      logError('api_start', err as Error);
      throw err;
    }
  }

  // ─── Broadcast Methods ─────────────────────────────────────────────────

  broadcastOpportunities(opportunities: ArbitrageRoute[]): void {
    this.latestOpportunities = opportunities;
    this.wsManager.broadcast('opportunities', opportunities.slice(0, 50));
  }

  broadcastStats(stats: SystemStats): void {
    this.systemStats = stats;
    this.wsManager.broadcast('stats', stats);
  }

  broadcastTrade(trade: TradeRecord): void {
    this.tradeHistory.push(trade);
    // Keep only last 1000 trades
    if (this.tradeHistory.length > 1000) {
      this.tradeHistory = this.tradeHistory.slice(-1000);
    }
    this.wsManager.broadcast('trade', trade);
  }

  // ─── Shutdown ──────────────────────────────────────────────────────────

  async stop(): Promise<void> {
    await this.app.close();
  }
}