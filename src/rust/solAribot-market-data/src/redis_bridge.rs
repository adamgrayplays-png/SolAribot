//! Redis pub/sub bridge for TypeScript integration.
//!
//! Publishes pool state updates and arbitrage opportunities to Redis channels,
//! allowing the TS layer to consume real-time market data.

use redis::aio::MultiplexedConnection;
use redis::{AsyncCommands, Client};
use serde::Serialize;
use std::sync::Arc;
use tokio::sync::broadcast;

use solAribot_core::redis_channels;
use solAribot_core::{ArbitrageOpportunity, PoolState, Result, SolAribotError};

/// Bridge for publishing market data to Redis pub/sub.
pub struct RedisBridge {
    conn: MultiplexedConnection,
}

impl RedisBridge {
    /// Connect to Redis.
    pub async fn connect(redis_url: &str) -> Result<Self> {
        let client = Client::open(redis_url).map_err(|e| {
            SolAribotError::RedisError(format!("Failed to open Redis client: {}", e))
        })?;

        let conn = client.get_multiplexed_async_connection().await.map_err(|e| {
            SolAribotError::RedisError(format!("Failed to connect to Redis: {}", e))
        })?;

        Ok(Self { conn })
    }

    /// Publish a pool state update.
    pub async fn publish_pool(&self, pool: &PoolState) -> Result<()> {
        let channel = format!(
            "{}:{}",
            redis_channels::POOL_UPDATE_PREFIX,
            pool.address
        );
        let payload = serde_json::to_string(pool).map_err(|e| {
            SolAribotError::Internal(format!("JSON serialization: {}", e))
        })?;

        let mut conn = self.conn.clone();
        let _: i64 = conn.publish(&channel, &payload).await.map_err(|e| {
            SolAribotError::RedisError(format!("Publish failed: {}", e))
        })?;

        Ok(())
    }

    /// Publish an arbitrage opportunity.
    pub async fn publish_arbitrage(&self, opp: &ArbitrageOpportunity) -> Result<()> {
        let payload = serde_json::to_string(opp).map_err(|e| {
            SolAribotError::Internal(format!("JSON serialization: {}", e))
        })?;

        let mut conn = self.conn.clone();
        let _: i64 = conn.publish(redis_channels::ARB_OPPORTUNITY, &payload).await.map_err(|e| {
            SolAribotError::RedisError(format!("Publish failed: {}", e))
        })?;

        Ok(())
    }

    /// Publish an execution result.
    pub async fn publish_execution(&self, result: &serde_json::Value) -> Result<()> {
        let payload = serde_json::to_string(result).map_err(|e| {
            SolAribotError::Internal(format!("JSON serialization: {}", e))
        })?;

        let mut conn = self.conn.clone();
        let _: i64 = conn.publish(redis_channels::EXEC_RESULT, &payload).await.map_err(|e| {
            SolAribotError::RedisError(format!("Publish failed: {}", e))
        })?;

        Ok(())
    }

    /// Send a heartbeat.
    pub async fn heartbeat(&self) -> Result<()> {
        let payload = serde_json::json!({
            "timestamp_ms": std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
            "status": "alive"
        });

        let mut conn = self.conn.clone();
        let _: i64 = conn
            .publish(
                redis_channels::HEARTBEAT,
                &serde_json::to_string(&payload).unwrap(),
            )
            .await
            .map_err(|e| SolAribotError::RedisError(format!("Heartbeat failed: {}", e)))?;

        Ok(())
    }

    /// Set a key-value (for state sharing beyond pub/sub).
    pub async fn set_json<T: Serialize>(&self, key: &str, value: &T) -> Result<()> {
        let payload = serde_json::to_string(value).map_err(|e| {
            SolAribotError::Internal(format!("JSON serialization: {}", e))
        })?;

        let mut conn = self.conn.clone();
        let _: () = conn.set(key, &payload).await.map_err(|e| {
            SolAribotError::RedisError(format!("SET failed: {}", e))
        })?;

        Ok(())
    }

    /// Get a clone of the underlying connection for custom operations.
    pub fn connection(&self) -> MultiplexedConnection {
        self.conn.clone()
    }
}
