use serde::{Deserialize, Serialize};
use solana_sdk::pubkey::Pubkey;
use std::collections::HashMap;

use crate::program_ids;

// ---------------------------------------------------------------------------
// Core domain types
// ---------------------------------------------------------------------------

/// Identifies a token by its mint address and symbol.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct TokenInfo {
    pub mint: Pubkey,
    pub symbol: String,
    pub decimals: u8,
}

impl TokenInfo {
    pub fn wsol() -> Self {
        Self {
            mint: program_ids::resolve(program_ids::WSOL_MINT),
            symbol: "SOL".into(),
            decimals: 9,
        }
    }

    pub fn usdc() -> Self {
        Self {
            mint: program_ids::resolve(program_ids::USDC_MINT),
            symbol: "USDC".into(),
            decimals: 6,
        }
    }

    pub fn usdt() -> Self {
        Self {
            mint: program_ids::resolve(program_ids::USDT_MINT),
            symbol: "USDT".into(),
            decimals: 6,
        }
    }
}

/// A price quote for a token pair, denominated as `price = base_amount / quote_amount`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriceQuote {
    pub base_token: TokenInfo,
    pub quote_token: TokenInfo,
    /// Price of 1 base token in quote units (e.g. 1 SOL = X USDC)
    pub price: f64,
    /// The DEX / source this quote came from
    pub source: DexLabel,
    /// Timestamp (unix milliseconds) when this quote was observed
    pub timestamp_ms: u64,
    /// The pool address this quote was derived from
    pub pool_address: Pubkey,
}

/// Identifies which DEX a piece of data belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum DexLabel {
    Jupiter,
    RaydiumAmm,
    RaydiumClmm,
    Orca,
    Meteora,
    Lifinity,
    OpenBook,
    Phoenix,
}

impl std::fmt::Display for DexLabel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}", self)
    }
}

/// Represents the on-chain state of a liquidity pool.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PoolState {
    pub address: Pubkey,
    pub dex: DexLabel,
    pub token_a: TokenInfo,
    pub token_b: TokenInfo,
    /// Token A reserve (in smallest units)
    pub reserve_a: u64,
    /// Token B reserve (in smallest units)
    pub reserve_b: u64,
    /// Current sqrt price (X64 fixed-point), when available (CLMM / concentrated pools)
    pub sqrt_price_x64: Option<u128>,
    /// Current tick index, when available
    pub tick_current: Option<i32>,
    /// Fee rate in basis points (e.g. 30 = 0.30%)
    pub fee_rate_bps: u16,
    /// Last slot this pool was updated at
    pub last_updated_slot: u64,
    /// Unix timestamp (ms) of last update
    pub last_updated_ms: u64,
}

impl PoolState {
    /// Compute the simple constant-product price: reserve_b / reserve_a
    /// Returns price of token_a in terms of token_b.
    pub fn constant_product_price(&self) -> Option<f64> {
        if self.reserve_a == 0 || self.reserve_b == 0 {
            return None;
        }
        let ra = self.reserve_a as f64 / 10f64.powi(self.token_a.decimals as i32);
        let rb = self.reserve_b as f64 / 10f64.powi(self.token_b.decimals as i32);
        Some(rb / ra)
    }

    /// Derive a PriceQuote from this pool state.
    pub fn to_quote(&self) -> PriceQuote {
        PriceQuote {
            base_token: self.token_a.clone(),
            quote_token: self.token_b.clone(),
            price: self.constant_product_price().unwrap_or(0.0),
            source: self.dex,
            timestamp_ms: self.last_updated_ms,
            pool_address: self.address,
        }
    }
}

/// A simplified order-book representation (for OpenBook / Phoenix).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderBook {
    pub market_address: Pubkey,
    pub dex: DexLabel,
    pub base_token: TokenInfo,
    pub quote_token: TokenInfo,
    /// Aggregated bids: (price, cumulative size in base units)
    pub bids: Vec<(f64, u64)>,
    /// Aggregated asks: (price, cumulative size in base units)
    pub asks: Vec<(f64, u64)>,
    pub last_updated_slot: u64,
    pub last_updated_ms: u64,
}

impl OrderBook {
    /// Best bid price (highest buy).
    pub fn best_bid(&self) -> Option<f64> {
        self.bids.first().map(|(p, _)| *p)
    }

    /// Best ask price (lowest sell).
    pub fn best_ask(&self) -> Option<f64> {
        self.asks.first().map(|(p, _)| *p)
    }

    /// Mid price.
    pub fn mid_price(&self) -> Option<f64> {
        match (self.best_bid(), self.best_ask()) {
            (Some(bid), Some(ask)) => Some((bid + ask) / 2.0),
            _ => None,
        }
    }
}

/// A detected arbitrage opportunity across one or more DEXes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArbitrageOpportunity {
    /// Unique opportunity ID (timestamp + hash)
    pub id: String,
    /// The route: list of (pool_address, dex, direction) tuples
    pub route: Vec<TradeHop>,
    /// Expected profit in quote units (USDC)
    pub expected_profit_usdc: f64,
    /// Expected profit in basis points of trade size
    pub profit_bps: f64,
    /// Recommended trade size in USDC
    pub trade_size_usdc: f64,
    /// Input token for the arbitrage
    pub input_token: TokenInfo,
    /// Timestamp (ms) when opportunity was detected
    pub detected_at_ms: u64,
    /// Estimated net profit after all fees and slippage
    pub net_profit_estimate: f64,
    /// Confidence score 0.0–1.0 from ML layer
    pub confidence: f64,
}

/// A single hop in an arbitrage route.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TradeHop {
    pub pool_address: Pubkey,
    pub dex: DexLabel,
    pub token_in: TokenInfo,
    pub token_out: TokenInfo,
    /// Amount of token_in to swap
    pub amount_in: u64,
    /// Expected minimum amount of token_out
    pub min_amount_out: u64,
}

/// A full trade route consisting of one or more hops.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TradeRoute {
    pub hops: Vec<TradeHop>,
    pub expected_output: u64,
    pub worst_case_output: u64,
}

/// Token balance snapshot for a wallet.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalletBalance {
    pub token: TokenInfo,
    pub balance: u64,
}

/// Snapshot of all relevant token balances for a trader.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BalanceSnapshot {
    pub wallet: Pubkey,
    pub balances: HashMap<Pubkey, u64>,
    pub slot: u64,
    pub timestamp_ms: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_constant_product_price() {
        let pool = PoolState {
            address: Pubkey::new_unique(),
            dex: DexLabel::RaydiumAmm,
            token_a: TokenInfo::wsol(),
            token_b: TokenInfo::usdc(),
            reserve_a: 100_000_000_000, // 100 SOL (9 decimals)
            reserve_b: 2_500_000_000,   // 2500 USDC (6 decimals)
            sqrt_price_x64: None,
            tick_current: None,
            fee_rate_bps: 30,
            last_updated_slot: 0,
            last_updated_ms: 0,
        };
        let price = pool.constant_product_price().unwrap();
        // 2500 USDC / 100 SOL = 25
        assert!((price - 25.0).abs() < 0.01, "expected ~25, got {}", price);
    }

    #[test]
    fn test_order_book_mid_price() {
        let ob = OrderBook {
            market_address: Pubkey::new_unique(),
            dex: DexLabel::OpenBook,
            base_token: TokenInfo::wsol(),
            quote_token: TokenInfo::usdc(),
            bids: vec![(24.99, 1_000_000_000), (24.98, 2_000_000_000)],
            asks: vec![(25.01, 1_000_000_000), (25.02, 2_000_000_000)],
            last_updated_slot: 0,
            last_updated_ms: 0,
        };
        let mid = ob.mid_price().unwrap();
        assert!((mid - 25.0).abs() < 0.01);
    }
}
