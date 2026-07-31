import { ArbitrageRoute, RiskConfig, RiskStatus } from '../types.js';
import { getLogger, logSystemEvent } from '../logger/index.js';

// ─── Risk Manager ─────────────────────────────────────────────────────────────
export class RiskManager {
  private config: RiskConfig;
  private dailyLoss: number = 0;
  private dailyResetTime: number;
  private activeTrades: Set<string> = new Set();
  private isCircuitBreakerActive: boolean = false;
  private isCongested: boolean = false;
  private lastCongestionCheck: number = 0;
  private congestionHistory: number[] = [];

  constructor(config: RiskConfig) {
    this.config = config;
    this.dailyResetTime = this.getNextMidnight();
  }

  // ─── Configuration ──────────────────────────────────────────────────────────
  updateConfig(config: Partial<RiskConfig>): void {
    this.config = { ...this.config, ...config };
    logSystemEvent('risk_config_updated', { config: this.config });
  }

  getConfig(): RiskConfig {
    return { ...this.config };
  }

  // ─── Daily Loss Tracker ─────────────────────────────────────────────────────
  recordLoss(loss: number): void {
    this.checkDailyReset();
    this.dailyLoss += loss;

    if (this.dailyLoss >= this.config.dailyLossLimitSol) {
      this.isCircuitBreakerActive = true;
      logSystemEvent('circuit_breaker_activated', {
        dailyLoss: this.dailyLoss,
        limit: this.config.dailyLossLimitSol,
      });
    }
  }

  recordProfit(profit: number): void {
    this.checkDailyReset();
    this.dailyLoss -= profit; // profit reduces the daily loss counter
    if (this.dailyLoss < 0) this.dailyLoss = 0;

    if (this.isCircuitBreakerActive && this.dailyLoss < this.config.dailyLossLimitSol * 0.5) {
      this.isCircuitBreakerActive = false;
      logSystemEvent('circuit_breaker_reset', { dailyLoss: this.dailyLoss });
    }
  }

  getDailyLoss(): number {
    this.checkDailyReset();
    return this.dailyLoss;
  }

  // ─── Trade Lifecycle ────────────────────────────────────────────────────────
  startTrade(tradeId: string): boolean {
    if (this.activeTrades.size >= this.config.maxConcurrentTrades) {
      return false;
    }
    this.activeTrades.add(tradeId);
    return true;
  }

  completeTrade(tradeId: string): void {
    this.activeTrades.delete(tradeId);
  }

  get activeTradeCount(): number {
    return this.activeTrades.size;
  }

  // ─── Congestion Detection ───────────────────────────────────────────────────
  /**
   * Feed priority fee samples from recent blocks to detect congestion.
   * Called by the orchestrator when it receives mempool/fee data.
   */
  feedPriorityFeeSample(feeInSol: number): void {
    this.congestionHistory.push(feeInSol);
    // Keep only last 20 samples
    if (this.congestionHistory.length > 20) {
      this.congestionHistory.shift();
    }

    this.lastCongestionCheck = Date.now();
    const avg = this.averageFee();
    this.isCongested = avg > this.config.maxPriorityFeeSol;
  }

  private averageFee(): number {
    if (this.congestionHistory.length === 0) return 0;
    return this.congestionHistory.reduce((a, b) => a + b, 0) / this.congestionHistory.length;
  }

  // ─── Opportunity Validation ─────────────────────────────────────────────────
  /**
   * Check if a route passes all risk checks.
   * Returns { accepted: true } or { accepted: false, reason: string }.
   */
  validateOpportunity(route: ArbitrageRoute): { accepted: boolean; reason?: string } {
    // 1. Circuit breaker check
    if (this.isCircuitBreakerActive) {
      return { accepted: false, reason: 'Circuit breaker active — daily loss limit reached' };
    }

    // 2. Congestion check
    if (this.isCongested) {
      return { accepted: false, reason: 'Network congestion — priority fees above threshold' };
    }

    // 3. Max concurrent trades
    if (this.activeTrades.size >= this.config.maxConcurrentTrades) {
      return { accepted: false, reason: 'Max concurrent trades reached' };
    }

    // 4. Position size
    if (route.amountIn > this.config.maxPositionSizeSol) {
      return { accepted: false, reason: `Position size ${route.amountIn} exceeds max ${this.config.maxPositionSizeSol}` };
    }

    // 5. Minimum profit threshold
    if (route.netProfit < this.config.minProfitThresholdSol) {
      return { accepted: false, reason: `Profit ${route.netProfit.toFixed(6)} below threshold ${this.config.minProfitThresholdSol}` };
    }

    // 6. Liquidity check on each hop
    for (const hop of route.hops) {
      if (hop.liquidity < this.config.minLiquiditySol) {
        return {
          accepted: false,
          reason: `Insufficient liquidity on ${hop.dex} pool ${hop.poolAddress}: ${hop.liquidity} < ${this.config.minLiquiditySol}`,
        };
      }
    }

    // 7. Blacklisted pools
    for (const hop of route.hops) {
      if (this.config.blacklistedPools.includes(hop.poolAddress)) {
        return { accepted: false, reason: `Pool ${hop.poolAddress} is blacklisted` };
      }
    }

    // 8. Daily loss limit check (would this trade push us over?)
    // For a trade, we check net profit. If it's positive, it won't increase loss.
    // If it's negative (unlikely since we check minProfitThreshold), this would apply.
    if (route.netProfit < 0 && (this.dailyLoss + Math.abs(route.netProfit)) > this.config.dailyLossLimitSol) {
      return { accepted: false, reason: 'Trade would exceed daily loss limit' };
    }

    return { accepted: true };
  }

  // ─── Status ─────────────────────────────────────────────────────────────────
  getStatus(): RiskStatus {
    this.checkDailyReset();
    return {
      dailyLoss: this.dailyLoss,
      isCircuitBreakerActive: this.isCircuitBreakerActive,
      isCongested: this.isCongested,
      activeTrades: this.activeTrades.size,
    };
  }

  // ─── Internal ───────────────────────────────────────────────────────────────
  private checkDailyReset(): void {
    const now = Date.now();
    if (now >= this.dailyResetTime) {
      this.dailyLoss = 0;
      this.isCircuitBreakerActive = false;
      this.dailyResetTime = this.getNextMidnight();
      logSystemEvent('daily_loss_reset', { nextReset: new Date(this.dailyResetTime).toISOString() });
    }
  }

  private getNextMidnight(): number {
    const now = new Date();
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0));
    return next.getTime();
  }
}