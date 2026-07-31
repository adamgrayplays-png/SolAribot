-- =============================================================================
-- SolAribot — Database Initialization Script
-- =============================================================================
-- Run this script to create the initial database schema.
-- Usage: psql -U solAribot -d solAribot -f scripts/init-db.sql
-- =============================================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- Users & Wallets
-- =============================================================================
CREATE TABLE IF NOT EXISTS wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    label VARCHAR(64) NOT NULL,
    public_key VARCHAR(44) NOT NULL UNIQUE,
    encrypted_private_key TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_wallets_public_key ON wallets(public_key);
CREATE INDEX idx_wallets_active ON wallets(is_active) WHERE is_active = true;

-- =============================================================================
-- Trades (executed arbitrage transactions)
-- =============================================================================
CREATE TABLE IF NOT EXISTS trades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet_id UUID REFERENCES wallets(id),
    status VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending | submitted | confirmed | failed
    trade_type VARCHAR(20) NOT NULL,  -- triangular | multi_hop | circular
    route JSONB NOT NULL,  -- Array of swap steps: [{dex, input_mint, output_mint, amount}]
    input_mint VARCHAR(44) NOT NULL,
    output_mint VARCHAR(44) NOT NULL,
    input_amount NUMERIC(20, 9) NOT NULL,
    output_amount NUMERIC(20, 9) NOT NULL,
    expected_profit NUMERIC(20, 9) NOT NULL,
    actual_profit NUMERIC(20, 9),
    profit_margin_bps NUMERIC(10, 2),
    slippage_bps NUMERIC(10, 2),
    tx_signature VARCHAR(88),
    slot_number BIGINT,
    error_message TEXT,
    execution_time_ms INTEGER,
    is_simulated BOOLEAN DEFAULT false,
    ml_confidence NUMERIC(5, 4),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    executed_at TIMESTAMPTZ,
    confirmed_at TIMESTAMPTZ
);

CREATE INDEX idx_trades_status ON trades(status);
CREATE INDEX idx_trades_created_at ON trades(created_at DESC);
CREATE INDEX idx_trades_wallet_id ON trades(wallet_id);
CREATE INDEX idx_trades_tx_signature ON trades(tx_signature);

-- =============================================================================
-- Opportunities (detected arbitrage opportunities, whether executed or not)
-- =============================================================================
CREATE TABLE IF NOT EXISTS opportunities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    trade_type VARCHAR(20) NOT NULL,
    route JSONB NOT NULL,
    expected_profit NUMERIC(20, 9) NOT NULL,
    profit_margin_bps NUMERIC(10, 2) NOT NULL,
    confidence NUMERIC(5, 4),
    is_executed BOOLEAN DEFAULT false,
    trade_id UUID REFERENCES trades(id),
    detected_at TIMESTAMPTZ DEFAULT NOW(),
    expired_at TIMESTAMPTZ,
    reason_skipped TEXT  -- Why it was skipped (if not executed)
);

CREATE INDEX idx_opportunities_detected ON opportunities(detected_at DESC);
CREATE INDEX idx_opportunities_executed ON opportunities(is_executed);

-- =============================================================================
-- DEX Latency (per-DEX ping times for monitoring)
-- =============================================================================
CREATE TABLE IF NOT EXISTS dex_latency (
    id SERIAL PRIMARY KEY,
    dex_name VARCHAR(32) NOT NULL,
    latency_ms NUMERIC(10, 2) NOT NULL,
    is_healthy BOOLEAN DEFAULT true,
    recorded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_dex_latency_dex ON dex_latency(dex_name, recorded_at DESC);

-- =============================================================================
-- RPC Health (RPC endpoint health history)
-- =============================================================================
CREATE TABLE IF NOT EXISTS rpc_health (
    id SERIAL PRIMARY KEY,
    rpc_url TEXT NOT NULL,
    slot_number BIGINT,
    latency_ms NUMERIC(10, 2),
    is_healthy BOOLEAN NOT NULL,
    error_message TEXT,
    checked_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_rpc_health_url ON rpc_health(rpc_url, checked_at DESC);

-- =============================================================================
-- Daily P&L (aggregated daily profit/loss snapshots)
-- =============================================================================
CREATE TABLE IF NOT EXISTS daily_pnl (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL UNIQUE,
    total_trades INTEGER DEFAULT 0,
    successful_trades INTEGER DEFAULT 0,
    failed_trades INTEGER DEFAULT 0,
    total_profit_sol NUMERIC(20, 9) DEFAULT 0,
    total_fees_sol NUMERIC(20, 9) DEFAULT 0,
    net_profit_sol NUMERIC(20, 9) DEFAULT 0,
    win_rate NUMERIC(5, 2),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_daily_pnl_date ON daily_pnl(date DESC);

-- =============================================================================
-- System Metrics (CPU/RAM/RPC health snapshots)
-- =============================================================================
CREATE TABLE IF NOT EXISTS system_metrics (
    id SERIAL PRIMARY KEY,
    cpu_usage_pct NUMERIC(5, 2),
    memory_usage_mb NUMERIC(10, 2),
    memory_total_mb NUMERIC(10, 2),
    rpc_latency_ms NUMERIC(10, 2),
    rpc_slot_lag INTEGER,
    opportunities_scanned INTEGER,
    recorded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_system_metrics_recorded ON system_metrics(recorded_at DESC);

-- =============================================================================
-- Configuration (runtime editable config)
-- =============================================================================
CREATE TABLE IF NOT EXISTS config (
    key VARCHAR(64) PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default config values
INSERT INTO config (key, value, description) VALUES
    ('min_profit_threshold', '0.001', 'Minimum profit in SOL to execute a trade'),
    ('max_position_size', '10.0', 'Maximum position size in SOL per trade'),
    ('daily_loss_limit', '1.0', 'Daily loss limit in SOL'),
    ('slippage_bps', '50', 'Max slippage in basis points'),
    ('max_concurrent_trades', '3', 'Maximum concurrent trades')
ON CONFLICT (key) DO NOTHING;

-- =============================================================================
-- Create materialized view for dashboard performance
-- =============================================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS dashboard_performance AS
SELECT
    COALESCE(SUM(net_profit_sol), 0) AS total_profit_sol,
    COALESCE(SUM(total_trades), 0) AS total_trades,
    COALESCE(SUM(successful_trades), 0) AS successful_trades,
    CASE WHEN SUM(total_trades) > 0
        THEN ROUND(SUM(successful_trades)::NUMERIC / SUM(total_trades) * 100, 2)
        ELSE 0
    END AS win_rate_pct
FROM daily_pnl;

-- =============================================================================
-- Function to refresh dashboard materialized view
-- =============================================================================
CREATE OR REPLACE FUNCTION refresh_dashboard_performance()
RETURNS TRIGGER AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY dashboard_performance;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Trigger to refresh after new trade
CREATE TRIGGER trigger_refresh_dashboard
    AFTER INSERT OR UPDATE ON trades
    FOR EACH STATEMENT
    EXECUTE FUNCTION refresh_dashboard_performance();