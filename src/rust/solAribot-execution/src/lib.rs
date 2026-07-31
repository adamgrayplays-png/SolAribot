//! solAribot-execution — Transaction builder and sender.
//!
//! Handles Versioned Transaction construction, Address Lookup Table integration,
//! atomic multi-hop swap bundling, compute budget optimization, dynamic priority
//! fee bidding, and automatic retry with blockhash refresh.

pub mod builder;
pub mod compute_budget;
pub mod priority_fee;
pub mod sender;

pub use builder::TransactionBuilder;
pub use sender::TransactionSender;
