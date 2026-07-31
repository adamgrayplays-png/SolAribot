//! solAribot-core — Shared types, DEX program IDs, error types, and parsing traits.
//!
//! This crate is the foundation for all Rust components of SolAribot.

pub mod dex;
pub mod error;
pub mod program_ids;
pub mod types;

// Re-export commonly used items
pub use dex::{PoolParser, OrderBookParser, redis_channels, MAX_CACHED_POOLS, MAX_STALENESS_MS};
pub use error::{Result, SolAribotError};
// program_ids items are accessible via solAribot_core::program_ids::*
pub use types::*;
