//! solAribot-market-data — Real-time market data engine.
//!
//! Subscribes to Solana RPC WebSocket feeds, parses pool states for all 7 DEXes,
//! maintains an in-memory cache with concurrent reads, and publishes updates
//! to Redis pub/sub for the TypeScript layer.

pub mod cache;
pub mod parsers;
pub mod redis_bridge;
pub mod subscription;

pub use cache::PoolCache;
pub use parsers::Registry;
pub use subscription::MarketDataEngine;
