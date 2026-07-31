import { v4 as uuidv4 } from 'uuid'; // we'll use crypto.randomUUID instead
import * as crypto from 'node:crypto';
import { PoolState, ArbitrageRoute, RouteHop, RouteType, DexName } from '../types.js';
import { getDexFee } from '../config.js';

// ─── Simple UUID generation without dependency ────────────────────────────────
function generateId(): string {
  return crypto.randomUUID();
}

// ─── Price Oracle — Stores latest pool states per DEX/pair ────────────────────
export class PriceOracle {
  private pools: Map<string, PoolState> = new Map();

  /** Key: "dex:tokenA:tokenB" */
  private key(pool: PoolState): string {
    return `${pool.dex}:${pool.tokenA}:${pool.tokenB}`;
  }

  update(pool: PoolState): void {
    this.pools.set(this.key(pool), pool);
  }

  /** Update from a batch of pool states */
  updateBatch(pools: PoolState[]): void {
    for (const pool of pools) {
      this.update(pool);
    }
  }

  /** Get the best price for a token pair across all DEXs */
  getBestPrice(tokenIn: string, tokenOut: string): { price: number; dex: DexName; pool: PoolState } | null {
    let best: { price: number; dex: DexName; pool: PoolState } | null = null;

    for (const [key, pool] of this.pools) {
      const [, a, b] = key.split(':');

      if (a === tokenIn && b === tokenOut) {
        // priceA = price of tokenIn (a) in terms of tokenOut (b)
        const price = parseFloat(pool.priceA);
        if (!best || price > best.price) {
          best = { price, dex: pool.dex as DexName, pool };
        }
      }
      if (a === tokenOut && b === tokenIn) {
        // Pool stores tokenOut/tokenIn, so priceB = price of tokenIn in terms of tokenOut
        const price = parseFloat(pool.priceB);
        if (!best || price > best.price) {
          best = { price, dex: pool.dex as DexName, pool };
        }
      }
    }

    return best;
  }

  /** Get all pools for a specific token (as the base) */
  getPoolsForToken(token: string): PoolState[] {
    const result: PoolState[] = [];
    for (const [key, pool] of this.pools) {
      const [, a, b] = key.split(':');
      if (a === token || b === token) {
        result.push(pool);
      }
    }
    return result;
  }

  /** Get all known tokens */
  getKnownTokens(): Set<string> {
    const tokens = new Set<string>();
    for (const [, pool] of this.pools) {
      tokens.add(pool.tokenA);
      tokens.add(pool.tokenB);
    }
    return tokens;
  }

  /** Pool count */
  get poolCount(): number {
    return this.pools.size;
  }

  /** Clear all pools (for re-sync) */
  clear(): void {
    this.pools.clear();
  }
}

// ─── Route Detector ───────────────────────────────────────────────────────────
export class RouteDetector {
  constructor(
    private readonly oracle: PriceOracle,
    private readonly config: {
      minProfitThresholdSol: number;
      slippageBps: number;
    }
  ) {}

  /**
   * Detect all profitable arbitrage routes from the current pool states.
   * Returns routes sorted by expected profit (descending).
   */
  detectAll(amountIn: number = 1.0): ArbitrageRoute[] {
    const routes: ArbitrageRoute[] = [];
    const tokens = this.oracle.getKnownTokens();
    const tokenList = [...tokens];

    // ── 1. Direct 2-pool pairs (simple arbitrage across DEXs) ──────────
    // Find cases where same token pair exists on multiple DEXs with price differences
    for (const tokenA of tokenList) {
      for (const tokenB of tokenList) {
        if (tokenA === tokenB) continue;
        const routes2 = this.detectTwoPoolArbitrage(tokenA, tokenB, amountIn);
        routes.push(...routes2);
      }
    }

    // ── 2. Triangular arbitrage (A→B→C→A) ─────────────────────────────
    if (tokenList.length >= 3) {
      for (let i = 0; i < tokenList.length; i++) {
        for (let j = 0; j < tokenList.length; j++) {
          if (j === i) continue;
          for (let k = 0; k < tokenList.length; k++) {
            if (k === i || k === j) continue;
            const route = this.detectTriangularArbitrage(
              tokenList[i], tokenList[j], tokenList[k], amountIn
            );
            if (route) routes.push(route);
          }
        }
      }
    }

    // ── 3. Multi-hop routes (A→B→C) ───────────────────────────────────
    for (let i = 0; i < tokenList.length; i++) {
      for (let j = 0; j < tokenList.length; j++) {
        if (j === i) continue;
        for (let k = 0; k < tokenList.length; k++) {
          if (k === i || k === j) continue;
          const route = this.detectMultiHopRoute(
            tokenList[i], tokenList[j], tokenList[k], amountIn
          );
          if (route) routes.push(route);
        }
      }
    }

    // Sort by expected profit (descending), filter minimum threshold
    return routes
      .filter(r => r.netProfit >= this.config.minProfitThresholdSol)
      .sort((a, b) => b.netProfit - a.netProfit);
  }

  /**
   * Direct two-pool arbitrage: same token pair on different DEXs with price diff.
   * E.g., Buy SOL/USDC on DEX A for 20 USDC, sell on DEX B for 21 USDC.
   */
  private detectTwoPoolArbitrage(
    tokenA: string,
    tokenB: string,
    amountIn: number
  ): ArbitrageRoute[] {
    const routes: ArbitrageRoute[] = [];

    // Get all pools for this pair across all DEXs
    const pools: { dex: DexName; pool: PoolState; priceInB: number }[] = [];

    for (const [key, pool] of this.oracle['pools'] as Map<string, PoolState>) {
      const [, a, b] = key.split(':');
      if ((a === tokenA && b === tokenB)) {
        pools.push({ dex: pool.dex as DexName, pool, priceInB: parseFloat(pool.priceA) });
      } else if ((a === tokenB && b === tokenA)) {
        pools.push({ dex: pool.dex as DexName, pool, priceInB: 1 / parseFloat(pool.priceA) });
      }
    }

    // Find buy-low/sell-high pairs
    for (let i = 0; i < pools.length; i++) {
      for (let j = 0; j < pools.length; j++) {
        if (i === j) continue;
        const buyPool = pools[i];
        const sellPool = pools[j];

        // Check if profitable
        const buyPrice = buyPool.priceInB;
        const sellPrice = sellPool.priceInB;

        if (sellPrice <= buyPrice) continue;

        // Build route hops
        const feeBps = getDexFee(buyPool.dex) + getDexFee(sellPool.dex);
        const totalFeeFraction = feeBps / 10000;
        const slippageFraction = this.config.slippageBps / 10000;

        const grossAmountOut = amountIn * (sellPrice / buyPrice);
        const netAmountOut = grossAmountOut * (1 - totalFeeFraction) * (1 - slippageFraction);
        const profit = netAmountOut - amountIn;

        const route: ArbitrageRoute = {
          id: generateId(),
          type: 'multi-hop',
          hops: [
            {
              dex: buyPool.dex,
              poolAddress: buyPool.pool.poolAddress,
              tokenIn: tokenA,
              tokenOut: tokenB,
              price: buyPrice,
              liquidity: Math.min(
                parseFloat(buyPool.pool.liquidityA || '0'),
                parseFloat(buyPool.pool.liquidityB || '0')
              ),
              tradingFee: feeBps / 2,
            },
            {
              dex: sellPool.dex,
              poolAddress: sellPool.pool.poolAddress,
              tokenIn: tokenB,
              tokenOut: tokenA,
              price: sellPrice,
              liquidity: Math.min(
                parseFloat(sellPool.pool.liquidityA || '0'),
                parseFloat(sellPool.pool.liquidityB || '0')
              ),
              tradingFee: feeBps / 2,
            },
          ],
          tokenIn: tokenA,
          tokenOut: tokenA,
          amountIn,
          expectedAmountOut: netAmountOut,
          netProfit: profit,
          grossProfit: grossAmountOut - amountIn,
          roi: (profit / amountIn) * 100,
          totalFees: grossAmountOut * totalFeeFraction,
          slippageEstimate: grossAmountOut * slippageFraction,
          computeBudget: 200_000,
          priorityFee: 0.000_005,
          confidence: 0.5, // default until ML model scores
          timestamp: Date.now(),
        };

        routes.push(route);
      }
    }

    return routes;
  }

  /**
   * Triangular arbitrage: A → B → C → A via 3 different pools.
   */
  private detectTriangularArbitrage(
    tokenA: string,
    tokenB: string,
    tokenC: string,
    amountIn: number
  ): ArbitrageRoute | null {
    // Find: buy A→B, then B→C, then C→A
    const hop1 = this.oracle.getBestPrice(tokenA, tokenB);
    const hop2 = this.oracle.getBestPrice(tokenB, tokenC);
    const hop3 = this.oracle.getBestPrice(tokenC, tokenA);

    if (!hop1 || !hop2 || !hop3) return null;

    // Calculate profit through triangle
    const feeBps = getDexFee(hop1.dex) + getDexFee(hop2.dex) + getDexFee(hop3.dex);
    const totalFeeFraction = feeBps / 10000;
    const slippageFraction = this.config.slippageBps / 10000;

    const afterHop1 = amountIn * hop1.price;
    const afterHop2 = afterHop1 * hop2.price;
    const afterHop3 = afterHop2 * hop3.price;

    const fee = afterHop3 * totalFeeFraction;
    const slippage = afterHop3 * slippageFraction;
    const netAmountOut = afterHop3 - fee - slippage;
    const profit = netAmountOut - amountIn;

    if (profit <= 0) return null;

    return {
      id: generateId(),
      type: 'triangular',
      hops: [
        {
          dex: hop1.dex,
          poolAddress: hop1.pool.poolAddress,
          tokenIn: tokenA,
          tokenOut: tokenB,
          price: hop1.price,
          liquidity: Math.min(
            parseFloat(hop1.pool.liquidityA || '0'),
            parseFloat(hop1.pool.liquidityB || '0')
          ),
          tradingFee: getDexFee(hop1.dex),
        },
        {
          dex: hop2.dex,
          poolAddress: hop2.pool.poolAddress,
          tokenIn: tokenB,
          tokenOut: tokenC,
          price: hop2.price,
          liquidity: Math.min(
            parseFloat(hop2.pool.liquidityA || '0'),
            parseFloat(hop2.pool.liquidityB || '0')
          ),
          tradingFee: getDexFee(hop2.dex),
        },
        {
          dex: hop3.dex,
          poolAddress: hop3.pool.poolAddress,
          tokenIn: tokenC,
          tokenOut: tokenA,
          price: hop3.price,
          liquidity: Math.min(
            parseFloat(hop3.pool.liquidityA || '0'),
            parseFloat(hop3.pool.liquidityB || '0')
          ),
          tradingFee: getDexFee(hop3.dex),
        },
      ],
      tokenIn: tokenA,
      tokenOut: tokenA,
      amountIn,
      expectedAmountOut: netAmountOut,
      netProfit: profit,
      grossProfit: afterHop3 - amountIn,
      roi: (profit / amountIn) * 100,
      totalFees: fee,
      slippageEstimate: slippage,
      computeBudget: 300_000,
      priorityFee: 0.000_005,
      confidence: 0.5,
      timestamp: Date.now(),
    };
  }

  /**
   * Multi-hop route: A → B → C (end token different from start).
   * Profitable if you can get more C than A's equivalent value in C.
   */
  private detectMultiHopRoute(
    tokenA: string,
    tokenB: string,
    tokenC: string,
    amountIn: number
  ): ArbitrageRoute | null {
    const hop1 = this.oracle.getBestPrice(tokenA, tokenB);
    const hop2 = this.oracle.getBestPrice(tokenB, tokenC);

    if (!hop1 || !hop2) return null;

    // We also need a reference price from A→C to check if multi-hop beats direct
    const directPrice = this.oracle.getBestPrice(tokenA, tokenC);
    if (!directPrice) return null;

    const feeBps = getDexFee(hop1.dex) + getDexFee(hop2.dex);
    const totalFeeFraction = feeBps / 10000;
    const slippageFraction = this.config.slippageBps / 10000;

    const throughAmount = amountIn * hop1.price * hop2.price;
    const directAmount = amountIn * directPrice.price;

    // Multi-hop is only profitable if it beats the direct route
    const fee = throughAmount * totalFeeFraction;
    const slippage = throughAmount * slippageFraction;
    const netThroughAmount = throughAmount - fee - slippage;
    const profit = netThroughAmount - directAmount;

    if (profit <= 0) return null;

    return {
      id: generateId(),
      type: 'multi-hop',
      hops: [
        {
          dex: hop1.dex,
          poolAddress: hop1.pool.poolAddress,
          tokenIn: tokenA,
          tokenOut: tokenB,
          price: hop1.price,
          liquidity: Math.min(
            parseFloat(hop1.pool.liquidityA || '0'),
            parseFloat(hop1.pool.liquidityB || '0')
          ),
          tradingFee: getDexFee(hop1.dex),
        },
        {
          dex: hop2.dex,
          poolAddress: hop2.pool.poolAddress,
          tokenIn: tokenB,
          tokenOut: tokenC,
          price: hop2.price,
          liquidity: Math.min(
            parseFloat(hop2.pool.liquidityA || '0'),
            parseFloat(hop2.pool.liquidityB || '0')
          ),
          tradingFee: getDexFee(hop2.dex),
        },
      ],
      tokenIn: tokenA,
      tokenOut: tokenC,
      amountIn,
      expectedAmountOut: netThroughAmount,
      netProfit: profit,
      grossProfit: throughAmount - directAmount,
      roi: (profit / amountIn) * 100,
      totalFees: fee,
      slippageEstimate: slippage,
      computeBudget: 250_000,
      priorityFee: 0.000_005,
      confidence: 0.5,
      timestamp: Date.now(),
    };
  }
}

// ─── Batch Scanner ────────────────────────────────────────────────────────────
export class BatchScanner {
  private readonly oracle: PriceOracle;
  private readonly detector: RouteDetector;

  constructor(config: { minProfitThresholdSol: number; slippageBps: number }) {
    this.oracle = new PriceOracle();
    this.detector = new RouteDetector(this.oracle, config);
  }

  /** Update pool states from a batch received via Redis */
  ingestPoolUpdates(pools: PoolState[]): void {
    this.oracle.updateBatch(pools);
  }

  /** Run a full scan across all tokens */
  scan(batchSize: number = 1.0): ArbitrageRoute[] {
    return this.detector.detectAll(batchSize);
  }

  get poolCount(): number {
    return this.oracle.poolCount;
  }
}