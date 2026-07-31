import { z } from 'zod';

// ─── DEX Identifiers ──────────────────────────────────────────────────────────
export const DEX_NAMES = [
  'jupiter',
  'raydium',
  'orca',
  'meteora',
  'lifinity',
  'openbook',
  'phoenix',
] as const;

export type DexName = (typeof DEX_NAMES)[number];

// ─── Pool State (received from Rust engine via Redis) ─────────────────────────
export const PoolStateSchema = z.object({
  dex: z.enum(DEX_NAMES),
  poolAddress: z.string(),
  tokenA: z.string(),   // mint address
  tokenB: z.string(),   // mint address
  priceA: z.string(),   // price of tokenA in terms of tokenB (as decimal string)
  priceB: z.string(),   // price of tokenB in terms of tokenA (as decimal string)
  liquidityA: z.string(),
  liquidityB: z.string(),
  timestamp: z.number(),
  slot: z.number(),
});

export type PoolState = z.infer<typeof PoolStateSchema>;

// ─── Arbitrage Route Types ────────────────────────────────────────────────────
export type RouteHop = {
  dex: DexName;
  poolAddress: string;
  tokenIn: string;
  tokenOut: string;
  price: number;        // effective price
  liquidity: number;
  tradingFee: number;   // fee in basis points (e.g., 30 = 0.3%)
};

export type RouteType = 'triangular' | 'multi-hop' | 'circular';

export type ArbitrageRoute = {
  id: string;
  type: RouteType;
  hops: RouteHop[];
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  expectedAmountOut: number;
  netProfit: number;        // after all fees, in SOL
  grossProfit: number;      // before fees, in SOL
  roi: number;              // return on investment (%)
  totalFees: number;        // total fees in SOL
  slippageEstimate: number; // estimated slippage in SOL
  computeBudget: number;    // estimated compute budget in lamports
  priorityFee: number;      // estimated priority fee in SOL
  confidence: number;       // ML model confidence score (0-1)
  timestamp: number;
};

// ─── Trade Execution ──────────────────────────────────────────────────────────
export type TradeStatus = 'pending' | 'submitted' | 'confirmed' | 'failed';

export type TradeRecord = {
  id: string;
  routeId: string;
  wallet: string;
  txSignature: string | null;
  expectedProfit: number;
  actualProfit: number | null;
  status: TradeStatus;
  fees: number;
  slippage: number;
  executionTimeMs: number;
  error: string | null;
  timestamp: number;
};

// ─── Wallet State ─────────────────────────────────────────────────────────────
export type WalletState = {
  publicKey: string;
  index: number;
  balance: number;       // in SOL
  lastChecked: number;
  isActive: boolean;
};

// ─── Risk Configuration ───────────────────────────────────────────────────────
export type RiskConfig = {
  maxPositionSizeSol: number;
  dailyLossLimitSol: number;
  maxConcurrentTrades: number;
  slippageBps: number;
  minLiquiditySol: number;
  minProfitThresholdSol: number;
  maxPriorityFeeSol: number;
  blacklistedPools: string[];
  congestionCooldownMs: number;
};

// ─── System Stats ─────────────────────────────────────────────────────────────
export type SystemStats = {
  uptime: number;
  totalScans: number;
  opportunitiesFound: number;
  tradesExecuted: number;
  tradesSucceeded: number;
  tradesFailed: number;
  totalProfit: number;
  dailyProfit: number;
  bestTrade: number;
  worstTrade: number;
  winRate: number;
  avgExecutionTime: number;
  wallets: WalletState[];
  risk: RiskStatus;
};

export type RiskStatus = {
  dailyLoss: number;
  isCircuitBreakerActive: boolean;
  isCongested: boolean;
  activeTrades: number;
};

// ─── Redis Channels ───────────────────────────────────────────────────────────
export const REDIS_CHANNELS = {
  POOL_UPDATES: 'solAribot:pool:updates',
  OPPORTUNITIES: 'solAribot:opportunities',
  TRADES: 'solAribot:trades',
  ML_SCORES: 'solAribot:ml:scores',
  COMMANDS: 'solAribot:commands',
} as const;

// ─── API Response Wrappers ────────────────────────────────────────────────────
export type ApiResponse<T> = {
  success: boolean;
  data: T;
  error?: string;
  timestamp: number;
};

export type WsMessage<T> = {
  type: string;
  payload: T;
  timestamp: number;
};