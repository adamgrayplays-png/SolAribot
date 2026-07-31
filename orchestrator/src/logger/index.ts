import pino from 'pino';
import { loadConfig } from '../config.js';

let loggerInstance: pino.Logger | null = null;

// ─── Trade-specific child logger ──────────────────────────────────────────────
export interface TradeLogData {
  tradeId: string;
  routeId: string;
  routeType: string;
  hops: number;
  wallet: string;
  amountIn: number;
  expectedProfit: number;
  actualProfit?: number;
  txSignature?: string;
  executionTimeMs?: number;
  error?: string;
  status: string;
}

// ─── Opportunity Log Data ─────────────────────────────────────────────────────
export interface OpportunityLogData {
  scannerRunId: string;
  routeId: string;
  routeType: string;
  hops: number;
  expectedProfit: number;
  roi: number;
  confidence: number;
  reason?: string; // why skipped/rejected
}

// ─── Create / Get Logger ──────────────────────────────────────────────────────
export function createLogger(): pino.Logger {
  if (loggerInstance) return loggerInstance;

  const config = loadConfig();
  const isDev = process.env.NODE_ENV !== 'production';

  loggerInstance = pino({
    level: config.LOG_LEVEL,
    transport: isDev
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
    serializers: {
      err: pino.stdSerializers.err,
      error: pino.stdSerializers.err,
    },
    base: {
      service: 'solAribot-orchestrator',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });

  return loggerInstance;
}

export function getLogger(): pino.Logger {
  if (!loggerInstance) {
    return createLogger();
  }
  return loggerInstance;
}

// ─── Convenience loggers ──────────────────────────────────────────────────────
export function logOpportunity(data: OpportunityLogData): void {
  const logger = getLogger();
  logger.info(
    { ...data, event: 'opportunity' },
    `[OPPORTUNITY] ${data.routeType} route: ${data.expectedProfit.toFixed(6)} SOL profit (${data.roi.toFixed(2)}% ROI)`
  );
}

export function logTradeAttempt(data: TradeLogData): void {
  const logger = getLogger();
  logger.info(
    { ...data, event: 'trade' },
    `[TRADE] ${data.status} | ${data.expectedProfit.toFixed(6)} SOL expected` +
      (data.actualProfit !== undefined ? ` | ${data.actualProfit.toFixed(6)} SOL actual` : '') +
      (data.txSignature ? ` | tx: ${data.txSignature}` : '')
  );
}

export function logTradeFailure(data: TradeLogData): void {
  const logger = getLogger();
  logger.error(
    { ...data, event: 'trade_failure' },
    `[TRADE FAILED] ${data.error || 'Unknown error'}`
  );
}

export function logScanCycle(opportunitiesFound: number, elapsedMs: number): void {
  const logger = getLogger();
  logger.info(
    { event: 'scan_cycle', opportunitiesFound, elapsedMs },
    `[SCAN] Cycle complete: ${opportunitiesFound} opportunities in ${elapsedMs}ms`
  );
}

export function logSystemEvent(event: string, details?: Record<string, unknown>): void {
  const logger = getLogger();
  logger.info(
    { event, ...details },
    `[SYSTEM] ${event}`
  );
}

export function logError(context: string, error: Error, details?: Record<string, unknown>): void {
  const logger = getLogger();
  logger.error(
    { err: error, context, ...details, event: 'error' },
    `[ERROR] ${context}: ${error.message}`
  );
}