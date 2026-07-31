use solana_sdk::pubkey::Pubkey;

use crate::error::Result;
use crate::types::{DexLabel, OrderBook, PoolState};

// ---------------------------------------------------------------------------
// DEX-specific pool layout / parsing trait
// ---------------------------------------------------------------------------

/// A trait for parsing raw on-chain account data into a [PoolState].
/// Each DEX implements this trait for its specific pool account layout.
pub trait PoolParser: Send + Sync {
    /// The DEX label this parser handles.
    fn dex_label(&self) -> DexLabel;

    /// Try to parse raw account data into a [PoolState].
    /// `account_data` is the full account data bytes.
    /// `account_pubkey` is the address of the pool account.
    fn parse_pool(&self, account_pubkey: &Pubkey, account_data: &[u8]) -> Result<PoolState>;

    /// Return the expected data length (or a range) for pool accounts of this DEX.
    /// Used for pre-filtering accounts before attempting deserialization.
    fn expected_data_len(&self) -> Option<std::ops::Range<usize>> {
        None
    }
}

/// A trait for parsing raw on-chain account data into an [OrderBook].
/// Relevant for order-book-based DEXes (OpenBook, Phoenix).
pub trait OrderBookParser: Send + Sync {
    fn dex_label(&self) -> DexLabel;

    fn parse_order_book(
        &self,
        market_address: &Pubkey,
        account_data: &[u8],
    ) -> Result<OrderBook>;
}

// ---------------------------------------------------------------------------
// Market-data-related shared constants
// ---------------------------------------------------------------------------

/// The maximum number of pools we track in-memory simultaneously.
pub const MAX_CACHED_POOLS: usize = 10_000;

/// How stale (in ms) a pool state can be before it's considered unreliable.
pub const MAX_STALENESS_MS: u64 = 5_000;

/// Redis channels used for pub/sub communication with the TS layer.
pub mod redis_channels {
    /// Pool state updates are published as JSON on `<prefix>:pool:<pool_address>`.
    pub const POOL_UPDATE_PREFIX: &str = "solAribot:pool";

    /// Arbitrage opportunities are published as JSON on `<prefix>:arb`.
    pub const ARB_OPPORTUNITY: &str = "solAribot:arb";

    /// Execution results are published as JSON on `<prefix>:exec`.
    pub const EXEC_RESULT: &str = "solAribot:exec";

    /// Health / heartbeat channel.
    pub const HEARTBEAT: &str = "solAribot:heartbeat";
}
