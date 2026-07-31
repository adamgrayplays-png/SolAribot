use thiserror::Error;

#[derive(Error, Debug)]
pub enum SolAribotError {
    #[error("RPC error: {0}")]
    RpcError(String),

    #[error("WebSocket error: {0}")]
    WsError(String),

    #[error("Invalid pool data for DEX {dex}: {reason}")]
    InvalidPoolData { dex: String, reason: String },

    #[error("Deserialization error: {0}")]
    DeserializationError(String),

    #[error("Transaction error: {0}")]
    TransactionError(String),

    #[error("Simulation failed: {0}")]
    SimulationFailed(String),

    #[error("Insufficient balance: needed {needed} {token}, have {have}")]
    InsufficientBalance {
        token: String,
        needed: u64,
        have: u64,
    },

    #[error("No arbitrage route found")]
    NoRouteFound,

    #[error("Slippage exceeded: max {max_bps} bps, actual {actual_bps} bps")]
    SlippageExceeded { max_bps: u16, actual_bps: u16 },

    #[error("Timeout: {0}")]
    Timeout(String),

    #[error("Redis error: {0}")]
    RedisError(String),

    #[error("Configuration error: {0}")]
    ConfigError(String),

    #[error("Unsupported DEX: {0}")]
    UnsupportedDex(String),

    #[error("Internal error: {0}")]
    Internal(String),

    #[error("Blockhash expired")]
    BlockhashExpired,

    #[error("Account not found: {0}")]
    AccountNotFound(String),

    #[error("{0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, SolAribotError>;
