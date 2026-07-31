import { z } from 'zod';
import { RiskConfig, DEX_NAMES } from './types.js';

// ─── Environment Variable Schema ──────────────────────────────────────────────
const EnvSchema = z.object({
  // Solana RPC
  SOLANA_RPC_URL: z.string().url().default('https://api.mainnet-beta.solana.com'),
  SOLANA_RPC_FALLBACKS: z.string().default(''),
  SOLANA_WS_URL: z.string().url().default('wss://api.mainnet-beta.solana.com'),

  // Wallet
  WALLET_PRIVATE_KEY: z.string().optional(),
  WALLET_PUBLIC_KEY: z.string().optional(),

  // Database
  DATABASE_URL: z.string().default('postgresql://solAribot:password@localhost:5432/solAribot'),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // Arbitrage
  MIN_PROFIT_THRESHOLD: z.coerce.number().positive().default(0.001),
  MAX_POSITION_SIZE: z.coerce.number().positive().default(10.0),
  DAILY_LOSS_LIMIT: z.coerce.number().positive().default(1.0),
  SLIPPAGE_BPS: z.coerce.number().int().min(0).max(1000).default(50),
  MIN_LIQUIDITY_SOL: z.coerce.number().positive().default(0.1),
  MAX_PRIORITY_FEE_SOL: z.coerce.number().positive().default(0.01),
  MAX_CONCURRENT_TRADES: z.coerce.number().int().positive().default(3),
  CONGESTION_COOLDOWN_MS: z.coerce.number().int().positive().default(5000),

  // Server
  API_PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),

  // Performance
  SCAN_INTERVAL_MS: z.coerce.number().int().positive().default(50),
  BALANCE_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
  BATCH_SIZE: z.coerce.number().int().positive().default(50),
});

export type EnvConfig = z.infer<typeof EnvSchema>;

// ─── Config singleton ─────────────────────────────────────────────────────────
let configInstance: EnvConfig | null = null;

export function loadConfig(): EnvConfig {
  if (configInstance) return configInstance;

  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    console.error('❌ Invalid environment configuration:', result.error.format());
    // Fall back to defaults for missing values
    const defaults = EnvSchema.parse({});
    configInstance = { ...defaults, ...Object.fromEntries(
      Object.entries(process.env).filter(([_, v]) => v !== undefined)
    ) } as EnvConfig;
    return configInstance!;
  }

  configInstance = result.data;
  return configInstance;
}

// ─── Risk Config Derivation ───────────────────────────────────────────────────
export function getRiskConfig(): RiskConfig {
  const env = loadConfig();
  return {
    maxPositionSizeSol: env.MAX_POSITION_SIZE,
    dailyLossLimitSol: env.DAILY_LOSS_LIMIT,
    maxConcurrentTrades: env.MAX_CONCURRENT_TRADES,
    slippageBps: env.SLIPPAGE_BPS,
    minLiquiditySol: env.MIN_LIQUIDITY_SOL,
    minProfitThresholdSol: env.MIN_PROFIT_THRESHOLD,
    maxPriorityFeeSol: env.MAX_PRIORITY_FEE_SOL,
    blacklistedPools: [],
    congestionCooldownMs: env.CONGESTION_COOLDOWN_MS,
  };
}

// ─── RPC Fallbacks ────────────────────────────────────────────────────────────
export function getRpcFallbacks(): string[] {
  const raw = loadConfig().SOLANA_RPC_FALLBACKS;
  if (!raw) return [];
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

// ─── DEX Fees (in basis points) ───────────────────────────────────────────────
export const DEX_FEES: Record<string, number> = {
  jupiter: 0,      // Jupiter is an aggregator, fees depend on underlying DEX
  raydium: 25,     // 0.25%
  orca: 30,        // 0.30% (whirlpools)
  meteora: 30,     // 0.30%
  lifinity: 10,    // 0.10%
  openbook: 0,     // Order book, no LP fee
  phoenix: 0,      // Order book, no LP fee
};

export function getDexFee(dex: string): number {
  return DEX_FEES[dex] ?? 30; // default to 30 bps
}