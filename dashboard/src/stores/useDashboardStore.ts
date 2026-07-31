import { create } from 'zustand';
import { api, type Balance, type Trade, type Opportunity, type Position,
         type DexLatency, type SystemMetrics, type PnlSummary, type Settings } from '../api/client';

interface DashboardState {
  // Data
  balance: Balance | null;
  trades: Trade[];
  tradesTotal: number;
  tradesPage: number;
  tradesPages: number;
  opportunities: Opportunity[];
  positions: Position[];
  dexLatency: DexLatency[];
  systemMetrics: SystemMetrics | null;
  pnlSummary: PnlSummary | null;
  settings: Settings | null;

  // Loading states
  loading: {
    balance: boolean;
    trades: boolean;
    opportunities: boolean;
    positions: boolean;
    dexLatency: boolean;
    systemMetrics: boolean;
    pnlSummary: boolean;
    settings: boolean;
  };

  // Error states
  errors: {
    balance: string | null;
    trades: string | null;
    opportunities: string | null;
    positions: string | null;
    dexLatency: string | null;
    systemMetrics: string | null;
    pnlSummary: string | null;
    settings: string | null;
  };

  // Actions
  fetchBalance: (signal?: AbortSignal) => Promise<void>;
  fetchTrades: (params?: { page?: string; limit?: string; from?: string; to?: string; status?: string }) => Promise<void>;
  fetchOpportunities: (signal?: AbortSignal) => Promise<void>;
  fetchPositions: (signal?: AbortSignal) => Promise<void>;
  fetchDexLatency: (signal?: AbortSignal) => Promise<void>;
  fetchSystemMetrics: (signal?: AbortSignal) => Promise<void>;
  fetchPnlSummary: (signal?: AbortSignal) => Promise<void>;
  fetchSettings: (signal?: AbortSignal) => Promise<void>;
  updateSettings: (settings: Partial<Settings>) => Promise<void>;

  // Direct data setters (for WebSocket updates)
  setBalance: (balance: Balance) => void;
  addOpportunity: (opp: Opportunity) => void;
  addTrade: (trade: Trade) => void;
  setDexLatency: (latency: DexLatency[]) => void;
  setSystemMetrics: (metrics: SystemMetrics) => void;
  setPnlSummary: (summary: PnlSummary) => void;
}

const initialLoading = {
  balance: false,
  trades: false,
  opportunities: false,
  positions: false,
  dexLatency: false,
  systemMetrics: false,
  pnlSummary: false,
  settings: false,
};

const initialErrors = {
  balance: null,
  trades: null,
  opportunities: null,
  positions: null,
  dexLatency: null,
  systemMetrics: null,
  pnlSummary: null,
  settings: null,
} as Record<string, string | null>;

const useDashboardStore = create<DashboardState>((set, get) => ({
  balance: null,
  trades: [],
  tradesTotal: 0,
  tradesPage: 1,
  tradesPages: 1,
  opportunities: [],
  positions: [],
  dexLatency: [],
  systemMetrics: null,
  pnlSummary: null,
  settings: null,

  loading: { ...initialLoading },
  errors: { ...initialErrors },

  // --- REST fetchers ---
  fetchBalance: async (signal) => {
    set(s => ({ loading: { ...s.loading, balance: true }, errors: { ...s.errors, balance: null } }));
    try {
      const balance = await api.getBalance(signal);
      set(s => ({ balance, loading: { ...s.loading, balance: false } }));
    } catch (e: any) {
      if (e.name === 'AbortError') return;
      set(s => ({ loading: { ...s.loading, balance: false }, errors: { ...s.errors, balance: e.message } }));
    }
  },

  fetchTrades: async (params) => {
    set(s => ({ loading: { ...s.loading, trades: true }, errors: { ...s.errors, trades: null } }));
    try {
      const result = await api.getTrades(params);
      set(s => ({
        trades: result.trades,
        tradesTotal: result.total,
        tradesPage: result.page,
        tradesPages: result.pages,
        loading: { ...s.loading, trades: false },
      }));
    } catch (e: any) {
      set(s => ({ loading: { ...s.loading, trades: false }, errors: { ...s.errors, trades: e.message } }));
    }
  },

  fetchOpportunities: async (signal) => {
    set(s => ({ loading: { ...s.loading, opportunities: true }, errors: { ...s.errors, opportunities: null } }));
    try {
      const result = await api.getOpportunities({ limit: '50' }, signal);
      set(s => ({ opportunities: result.opportunities, loading: { ...s.loading, opportunities: false } }));
    } catch (e: any) {
      if (e.name === 'AbortError') return;
      set(s => ({ loading: { ...s.loading, opportunities: false }, errors: { ...s.errors, opportunities: e.message } }));
    }
  },

  fetchPositions: async (signal) => {
    set(s => ({ loading: { ...s.loading, positions: true }, errors: { ...s.errors, positions: null } }));
    try {
      const result = await api.getPositions(signal);
      set(s => ({ positions: result.positions, loading: { ...s.loading, positions: false } }));
    } catch (e: any) {
      if (e.name === 'AbortError') return;
      set(s => ({ loading: { ...s.loading, positions: false }, errors: { ...s.errors, positions: e.message } }));
    }
  },

  fetchDexLatency: async (signal) => {
    set(s => ({ loading: { ...s.loading, dexLatency: true }, errors: { ...s.errors, dexLatency: null } }));
    try {
      const result = await api.getDexLatency(signal);
      set(s => ({ dexLatency: result.dexes, loading: { ...s.loading, dexLatency: false } }));
    } catch (e: any) {
      if (e.name === 'AbortError') return;
      set(s => ({ loading: { ...s.loading, dexLatency: false }, errors: { ...s.errors, dexLatency: e.message } }));
    }
  },

  fetchSystemMetrics: async (signal) => {
    set(s => ({ loading: { ...s.loading, systemMetrics: true }, errors: { ...s.errors, systemMetrics: null } }));
    try {
      const metrics = await api.getSystemMetrics(signal);
      set(s => ({ systemMetrics: metrics, loading: { ...s.loading, systemMetrics: false } }));
    } catch (e: any) {
      if (e.name === 'AbortError') return;
      set(s => ({ loading: { ...s.loading, systemMetrics: false }, errors: { ...s.errors, systemMetrics: e.message } }));
    }
  },

  fetchPnlSummary: async (signal) => {
    set(s => ({ loading: { ...s.loading, pnlSummary: true }, errors: { ...s.errors, pnlSummary: null } }));
    try {
      const summary = await api.getPnlSummary(signal);
      set(s => ({ pnlSummary: summary, loading: { ...s.loading, pnlSummary: false } }));
    } catch (e: any) {
      if (e.name === 'AbortError') return;
      set(s => ({ loading: { ...s.loading, pnlSummary: false }, errors: { ...s.errors, pnlSummary: e.message } }));
    }
  },

  fetchSettings: async (signal) => {
    set(s => ({ loading: { ...s.loading, settings: true }, errors: { ...s.errors, settings: null } }));
    try {
      const settings = await api.getSettings(signal);
      set(s => ({ settings, loading: { ...s.loading, settings: false } }));
    } catch (e: any) {
      if (e.name === 'AbortError') return;
      set(s => ({ loading: { ...s.loading, settings: false }, errors: { ...s.errors, settings: e.message } }));
    }
  },

  updateSettings: async (partial) => {
    try {
      const settings = await api.updateSettings(partial);
      set(s => ({ settings, errors: { ...s.errors, settings: null } }));
    } catch (e: any) {
      set(s => ({ errors: { ...s.errors, settings: e.message } }));
      throw e;
    }
  },

  // --- WebSocket setters ---
  setBalance: (balance) => set({ balance }),
  addOpportunity: (opp) => set(s => ({ opportunities: [opp, ...s.opportunities].slice(0, 200) })),
  addTrade: (trade) => set(s => ({ trades: [trade, ...s.trades].slice(0, 200) })),
  setDexLatency: (dexLatency) => set({ dexLatency }),
  setSystemMetrics: (systemMetrics) => set({ systemMetrics }),
  setPnlSummary: (pnlSummary) => set({ pnlSummary }),
}));

export default useDashboardStore;