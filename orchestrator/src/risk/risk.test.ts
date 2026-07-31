import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RiskManager } from './index.js';
import { RiskConfig, ArbitrageRoute, RouteHop } from '../types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeRoute(
  overrides: Partial<ArbitrageRoute> = {}
): ArbitrageRoute {
  return {
    id: 'test-route-1',
    type: 'multi-hop',
    hops: [
      {
        dex: 'raydium',
        poolAddress: 'pool1',
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        price: 20.0,
        liquidity: 1000,
        tradingFee: 25,
      },
      {
        dex: 'orca',
        poolAddress: 'pool2',
        tokenIn: 'USDC',
        tokenOut: 'SOL',
        price: 21.0,
        liquidity: 1000,
        tradingFee: 30,
      },
    ],
    tokenIn: 'SOL',
    tokenOut: 'SOL',
    amountIn: 1.0,
    expectedAmountOut: 1.05,
    netProfit: 0.05,
    grossProfit: 0.08,
    roi: 5.0,
    totalFees: 0.02,
    slippageEstimate: 0.01,
    computeBudget: 200_000,
    priorityFee: 0.000_005,
    confidence: 0.5,
    timestamp: Date.now(),
    ...overrides,
  };
}

const defaultConfig: RiskConfig = {
  maxPositionSizeSol: 10.0,
  dailyLossLimitSol: 1.0,
  maxConcurrentTrades: 3,
  slippageBps: 50,
  minLiquiditySol: 0.1,
  minProfitThresholdSol: 0.001,
  maxPriorityFeeSol: 0.01,
  blacklistedPools: [],
  congestionCooldownMs: 5000,
};

// ─── RiskManager Tests ────────────────────────────────────────────────────────
describe('RiskManager', () => {
  let riskManager: RiskManager;

  beforeEach(() => {
    riskManager = new RiskManager({ ...defaultConfig });
  });

  // ─── Configuration ────────────────────────────────────────────────────
  it('should initialize with default config', () => {
    const config = riskManager.getConfig();
    expect(config.maxPositionSizeSol).toBe(10.0);
    expect(config.dailyLossLimitSol).toBe(1.0);
    expect(config.maxConcurrentTrades).toBe(3);
  });

  it('should update config partially', () => {
    riskManager.updateConfig({ maxPositionSizeSol: 20.0 });
    const config = riskManager.getConfig();
    expect(config.maxPositionSizeSol).toBe(20.0);
    expect(config.dailyLossLimitSol).toBe(1.0); // unchanged
  });

  // ─── Daily Loss Tracking ──────────────────────────────────────────────
  it('should track daily losses', () => {
    expect(riskManager.getDailyLoss()).toBe(0);
    riskManager.recordLoss(0.5);
    expect(riskManager.getDailyLoss()).toBe(0.5);
  });

  it('should activate circuit breaker when daily loss limit reached', () => {
    riskManager.recordLoss(0.5);
    expect(riskManager.getStatus().isCircuitBreakerActive).toBe(false);

    riskManager.recordLoss(0.6);
    expect(riskManager.getStatus().isCircuitBreakerActive).toBe(true);
  });

  it('should reduce daily loss with profits', () => {
    riskManager.recordLoss(0.5);
    expect(riskManager.getDailyLoss()).toBe(0.5);

    riskManager.recordProfit(0.3);
    expect(riskManager.getDailyLoss()).toBe(0.2);
  });

  it('should not let daily loss go negative', () => {
    riskManager.recordLoss(0.5);
    riskManager.recordProfit(1.0);
    expect(riskManager.getDailyLoss()).toBe(0);
  });

  it('should reset circuit breaker when loss drops below 50% of limit', () => {
    riskManager.recordLoss(1.0); // hits limit
    expect(riskManager.getStatus().isCircuitBreakerActive).toBe(true);

    riskManager.recordProfit(0.6); // loss = 0.4, which is 40% of limit (1.0) — below 50%
    expect(riskManager.getStatus().isCircuitBreakerActive).toBe(false);
  });

  // ─── Trade Lifecycle ──────────────────────────────────────────────────
  it('should start and complete trades', () => {
    expect(riskManager.activeTradeCount).toBe(0);
    expect(riskManager.startTrade('trade-1')).toBe(true);
    expect(riskManager.activeTradeCount).toBe(1);

    riskManager.completeTrade('trade-1');
    expect(riskManager.activeTradeCount).toBe(0);
  });

  it('should reject trades when max concurrent reached', () => {
    expect(riskManager.startTrade('trade-1')).toBe(true);
    expect(riskManager.startTrade('trade-2')).toBe(true);
    expect(riskManager.startTrade('trade-3')).toBe(true);
    expect(riskManager.startTrade('trade-4')).toBe(false); // rejected
  });

  // ─── Congestion Detection ─────────────────────────────────────────────
  it('should detect congestion from priority fee samples', () => {
    // Feed low fees
    riskManager.feedPriorityFeeSample(0.001);
    riskManager.feedPriorityFeeSample(0.002);
    expect(riskManager.getStatus().isCongested).toBe(false);

    // Feed high fees (above maxPriorityFeeSol of 0.01)
    riskManager.feedPriorityFeeSample(0.05);
    riskManager.feedPriorityFeeSample(0.04);
    riskManager.feedPriorityFeeSample(0.03);
    expect(riskManager.getStatus().isCongested).toBe(true);
  });

  it('should not be congested with no samples', () => {
    expect(riskManager.getStatus().isCongested).toBe(false);
  });

  // ─── Opportunity Validation ───────────────────────────────────────────
  it('should accept a valid profitable opportunity', () => {
    const route = makeRoute({ netProfit: 0.05 });
    const result = riskManager.validateOpportunity(route);
    expect(result.accepted).toBe(true);
  });

  it('should reject when circuit breaker is active', () => {
    riskManager.recordLoss(1.0); // activates circuit breaker
    const route = makeRoute({ netProfit: 0.05 });
    const result = riskManager.validateOpportunity(route);
    expect(result.accepted).toBe(false);
    expect(result.reason).toContain('Circuit breaker');
  });

  it('should reject when congested', () => {
    riskManager.feedPriorityFeeSample(0.05);
    riskManager.feedPriorityFeeSample(0.05);
    riskManager.feedPriorityFeeSample(0.05);

    const route = makeRoute({ netProfit: 0.05 });
    const result = riskManager.validateOpportunity(route);
    expect(result.accepted).toBe(false);
    expect(result.reason).toContain('congestion');
  });

  it('should reject when max concurrent trades reached', () => {
    riskManager.startTrade('trade-1');
    riskManager.startTrade('trade-2');
    riskManager.startTrade('trade-3');

    const route = makeRoute({ netProfit: 0.05 });
    const result = riskManager.validateOpportunity(route);
    expect(result.accepted).toBe(false);
    expect(result.reason).toContain('concurrent');
  });

  it('should reject when position size exceeds max', () => {
    const route = makeRoute({ amountIn: 15.0, netProfit: 0.05 });
    const result = riskManager.validateOpportunity(route);
    expect(result.accepted).toBe(false);
    expect(result.reason).toContain('Position size');
  });

  it('should reject when profit below minimum threshold', () => {
    const route = makeRoute({ netProfit: 0.0001 }); // below 0.001
    const result = riskManager.validateOpportunity(route);
    expect(result.accepted).toBe(false);
    expect(result.reason).toContain('threshold');
  });

  it('should reject when liquidity is insufficient', () => {
    const route = makeRoute({
      hops: [
        {
          dex: 'raydium' as const,
          poolAddress: 'pool1',
          tokenIn: 'SOL',
          tokenOut: 'USDC',
          price: 20.0,
          liquidity: 0.01, // below minLiquiditySol of 0.1
          tradingFee: 25,
        },
        {
          dex: 'orca' as const,
          poolAddress: 'pool2',
          tokenIn: 'USDC',
          tokenOut: 'SOL',
          price: 21.0,
          liquidity: 1000,
          tradingFee: 30,
        },
      ],
    });
    const result = riskManager.validateOpportunity(route);
    expect(result.accepted).toBe(false);
    expect(result.reason).toContain('liquidity');
  });

  it('should reject when pool is blacklisted', () => {
    riskManager.updateConfig({ blacklistedPools: ['pool1'] });
    const route = makeRoute();
    const result = riskManager.validateOpportunity(route);
    expect(result.accepted).toBe(false);
    expect(result.reason).toContain('blacklisted');
  });

  it('should get status correctly', () => {
    riskManager.startTrade('trade-1');
    const status = riskManager.getStatus();
    expect(status).toHaveProperty('dailyLoss');
    expect(status).toHaveProperty('isCircuitBreakerActive');
    expect(status).toHaveProperty('isCongested');
    expect(status).toHaveProperty('activeTrades');
    expect(status.activeTrades).toBe(1);
  });
});