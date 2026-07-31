const API_BASE = '/api';

interface FetchOptions {
  method?: string;
  body?: unknown;
  params?: Record<string, string>;
  signal?: AbortSignal;
}

async function request<T>(endpoint: string, options: FetchOptions = {}): Promise<T> {
  const { method = 'GET', body, params, signal } = options;

  let url = `${API_BASE}${endpoint}`;
  if (params) {
    const searchParams = new URLSearchParams(params);
    url += `?${searchParams.toString()}`;
  }

  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(body ? {} : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => 'Unknown error');
    throw new Error(`API ${method} ${endpoint} ${res.status}: ${errorText}`);
  }

  return res.json() as Promise<T>;
}

// =============================================================================
// Types
// =============================================================================
export interface Balance {
  sol: number;
  usd_value: number;
  tokens: { mint: string; symbol: string; amount: number; usd_value: number }[];
}

export interface Trade {
  id: string;
  status: 'pending' | 'submitted' | 'confirmed' | 'failed';
  trade_type: string;
  route: { dex: string; input_mint: string; output_mint: string; amount: number }[];
  input_mint: string;
  output_mint: string;
  input_amount: number;
  output_amount: number;
  expected_profit: number;
  actual_profit: number | null;
  profit_margin_bps: number;
  slippage_bps: number;
  tx_signature: string | null;
  slot_number: number | null;
  error_message: string | null;
  execution_time_ms: number | null;
  ml_confidence: number | null;
  created_at: string;
  executed_at: string | null;
  confirmed_at: string | null;
}

export interface Opportunity {
  id: string;
  trade_type: string;
  route: { dex: string; input_mint: string; output_mint: string; amount: number }[];
  expected_profit: number;
  profit_margin_bps: number;
  confidence: number;
  estimated_slippage_bps: number;
  fake_probability: number;
  detected_at: string;
  expired_at: string | null;
}

export interface Position {
  id: string;
  token_pair: string;
  entry_price: number;
  current_price: number;
  amount: number;
  pnl_sol: number;
  pnl_pct: number;
  age_seconds: number;
  created_at: string;
}

export interface DexLatency {
  dex_name: string;
  latency_ms: number;
  is_healthy: boolean;
  last_checked: string;
}

export interface SystemMetrics {
  cpu_usage_pct: number;
  memory_usage_mb: number;
  memory_total_mb: number;
  rpc_endpoints: { url: string; status: 'healthy' | 'degraded' | 'down'; latency_ms: number }[];
  uptime_seconds: number;
  opportunities_scanned: number;
  last_trade_timestamp: string | null;
}

export interface DailyPnl {
  date: string;
  total_profit_sol: number;
  total_trades: number;
  successful_trades: number;
  win_rate: number;
}

export interface PnlSummary {
  total_profit_sol: number;
  daily_profit_sol: number;
  win_rate_pct: number;
  total_trades: number;
  successful_trades: number;
}

export interface Settings {
  min_profit_threshold: number;
  max_position_size: number;
  daily_loss_limit: number;
  slippage_bps: number;
  enabled_dexes: string[];
  max_concurrent_trades: number;
  trade_cooldown_secs: number;
}

// =============================================================================
// API Methods
// =============================================================================
export const api = {
  // Balance
  getBalance: (signal?: AbortSignal) =>
    request<Balance>('/balance', { signal }),

  // Trades
  getTrades: (params?: { page?: string; limit?: string; from?: string; to?: string; status?: string }, signal?: AbortSignal) =>
    request<{ trades: Trade[]; total: number; page: number; pages: number }>('/trades', { params: params as Record<string, string>, signal }),

  // Opportunities
  getOpportunities: (params?: { limit?: string; min_profit?: string }, signal?: AbortSignal) =>
    request<{ opportunities: Opportunity[] }>('/opportunities', { params: params as Record<string, string>, signal }),

  // Positions
  getPositions: (signal?: AbortSignal) =>
    request<{ positions: Position[] }>('/positions', { signal }),

  // DEX Latency
  getDexLatency: (signal?: AbortSignal) =>
    request<{ dexes: DexLatency[] }>('/dex-latency', { signal }),

  // System Metrics
  getSystemMetrics: (signal?: AbortSignal) =>
    request<SystemMetrics>('/system-metrics', { signal }),

  // P&L Summary
  getPnlSummary: (signal?: AbortSignal) =>
    request<PnlSummary>('/pnl/summary', { signal }),

  // Daily P&L
  getDailyPnl: (params?: { days?: string }, signal?: AbortSignal) =>
    request<{ data: DailyPnl[] }>('/pnl/daily', { params: params as Record<string, string>, signal }),

  // Settings
  getSettings: (signal?: AbortSignal) =>
    request<Settings>('/settings', { signal }),

  updateSettings: (settings: Partial<Settings>) =>
    request<Settings>('/settings', { method: 'PUT', body: settings }),
};