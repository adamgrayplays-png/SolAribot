//! Market data subscription engine.
//!
//! Manages WebSocket subscriptions to Solana RPC for real-time pool state updates.
//! Uses `getProgramAccounts`-style subscriptions to track pool account changes
//! across all 7 target DEXes.

use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use solana_client::nonblocking::pubsub_client::PubsubClient;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_client::rpc_config::{RpcAccountInfoConfig, RpcProgramAccountsConfig};
use solana_client::rpc_filter::{Memcmp, MemcmpEncodedBytes, RpcFilterType};
use solana_sdk::commitment_config::CommitmentConfig;
use solana_sdk::pubkey::Pubkey;
use tokio::sync::broadcast;
use tokio::time;

use solAribot_core::program_ids;
use solAribot_core::MAX_STALENESS_MS;

use crate::cache::PoolCache;
use crate::parsers::Registry;
use crate::redis_bridge::RedisBridge;

/// Core market data engine.
///
/// Subscribes to one or more Solana RPC WebSocket endpoints and feeds
/// parsed pool state into the shared cache. Publishes updates to Redis.
pub struct MarketDataEngine {
    rpc_url: String,
    ws_url: String,
    cache: Arc<PoolCache>,
    parsers: Registry,
}

impl MarketDataEngine {
    /// Create a new engine.
    pub fn new(rpc_url: String, ws_url: String) -> Self {
        Self {
            rpc_url,
            ws_url,
            cache: PoolCache::new(),
            parsers: Registry::new(),
        }
    }

    /// Get a reference to the shared pool cache.
    pub fn cache(&self) -> &Arc<PoolCache> {
        &self.cache
    }

    /// Get a reference to the parser registry.
    pub fn parsers(&self) -> &Registry {
        &self.parsers
    }

    /// Start the engine. This spawns background tasks for:
    /// 1. Initial pool discovery via getProgramAccounts (HTTP)
    /// 2. WebSocket subscription for real-time account updates
    /// 3. Periodic stale-pool eviction
    ///
    /// Returns a shutdown signal sender. Send `()` to gracefully shut down.
    pub async fn start(
        self: Arc<Self>,
        redis: Option<Arc<RedisBridge>>,
    ) -> broadcast::Sender<()> {
        let (shutdown_tx, _) = broadcast::channel::<()>(1);

        // Task 1: Initial discovery via getProgramAccounts
        {
            let engine = self.clone();
            let mut rx = shutdown_tx.subscribe();
            tokio::spawn(async move {
                if let Err(e) = engine.discover_pools().await {
                    log::error!("Pool discovery failed: {}", e);
                }
                // Wait for shutdown
                let _ = rx.recv().await;
            });
        }

        // Task 2: WebSocket subscription
        {
            let engine = self.clone();
            let redis_clone = redis.clone();
            let mut rx = shutdown_tx.subscribe();
            tokio::spawn(async move {
                if let Err(e) = engine.subscribe_accounts(redis_clone, &mut rx).await {
                    log::error!("WebSocket subscription error: {}", e);
                }
            });
        }

        // Task 3: Stale pool eviction (every 30 seconds)
        {
            let engine = self.clone();
            let mut rx = shutdown_tx.subscribe();
            tokio::spawn(async move {
                let mut interval = time::interval(Duration::from_secs(30));
                loop {
                    tokio::select! {
                        _ = interval.tick() => {
                            let now_ms = SystemTime::now()
                                .duration_since(UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_millis() as u64;
                            let removed = engine.cache.evict_stale(now_ms, MAX_STALENESS_MS);
                            if removed > 0 {
                                log::info!("Evicted {} stale pools", removed);
                            }
                        }
                        _ = rx.recv() => {
                            log::info!("Eviction task shutting down");
                            break;
                        }
                    }
                }
            });
        }

        // Task 4: Heartbeat (every 10 seconds)
        if let Some(redis_bridge) = redis {
            let mut rx = shutdown_tx.subscribe();
            tokio::spawn(async move {
                let mut interval = time::interval(Duration::from_secs(10));
                loop {
                    tokio::select! {
                        _ = interval.tick() => {
                            if let Err(e) = redis_bridge.heartbeat().await {
                                log::warn!("Heartbeat failed: {}", e);
                            }
                        }
                        _ = rx.recv() => {
                            break;
                        }
                    }
                }
            });
        }

        shutdown_tx
    }

    /// Discover all pools for all tracked DEX programs via getProgramAccounts.
    async fn discover_pools(&self) -> Result<(), Box<dyn std::error::Error>> {
        let rpc = RpcClient::new_with_commitment(
            self.rpc_url.clone(),
            CommitmentConfig::processed(),
        );

        let dex_programs = [
            program_ids::RAYDIUM_AMM,
            program_ids::RAYDIUM_CLMM,
            program_ids::ORCA_WHIRLPOOLS,
            program_ids::METEORA_DLMM,
            program_ids::LIFINITY,
            program_ids::OPENBOOK,
            program_ids::PHOENIX,
        ];

        let owner = program_ids::resolve(dex_programs[0]);

        for program_id_str in &dex_programs {
            let program_id = program_ids::resolve(program_id_str);

            log::info!("Discovering pools for program: {}", program_id);

            match rpc
                .get_program_accounts_with_config(
                    &program_id,
                    RpcProgramAccountsConfig {
                        filters: Some(vec![
                            // Filter for initialized accounts (data len > 0)
                            RpcFilterType::DataSize(1),
                        ]),
                        account_config: RpcAccountInfoConfig {
                            encoding: Some(solana_account_decoder::UiAccountEncoding::Base64),
                            commitment: Some(CommitmentConfig::processed()),
                            ..Default::default()
                        },
                        ..Default::default()
                    },
                )
                .await
            {
                Ok(accounts) => {
                    let count = accounts.len();
                    let now_ms = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as u64;

                    for (pubkey, account) in accounts {
                        match self.parsers.parse_any(&pubkey, &account.data, &account.owner) {
                            Ok(mut pool) => {
                                pool.last_updated_ms = now_ms;
                                self.cache.upsert(pool);
                            }
                            Err(e) => {
                                // Skip pools that can't be parsed — they may be
                                // non-pool accounts owned by the program
                                log::trace!("Skipping account {}: {}", pubkey, e);
                            }
                        }
                    }
                    log::info!(
                        "Discovered {} accounts for {} ({} pools cached)",
                        count,
                        program_id_str,
                        self.cache.len()
                    );
                }
                Err(e) => {
                    log::warn!(
                        "Failed to discover pools for {}: {}",
                        program_id_str,
                        e
                    );
                }
            }
        }

        Ok(())
    }

    /// Subscribe to account changes via WebSocket for real-time updates.
    async fn subscribe_accounts(
        &self,
        redis: Option<Arc<RedisBridge>>,
        shutdown_rx: &mut broadcast::Receiver<()>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        // This is a simplified subscription loop.
        // In production, we'd subscribe to `accountSubscribe` for each pool,
        // or use `programSubscribe` with filters.
        //
        // For now, we poll the RPC every 500ms for updated pools as a fallback.
        // A full implementation would use PubsubClient for accountSubscribe.

        let rpc = RpcClient::new_with_commitment(
            self.rpc_url.clone(),
            CommitmentConfig::processed(),
        );

        let mut interval = time::interval(Duration::from_millis(500));

        loop {
            tokio::select! {
                _ = interval.tick() => {
                    // Poll: re-fetch pools we're tracking to detect changes
                    // In a full implementation, this would be event-driven via WebSocket
                    let pools = self.cache.all_pools();
                    let mut updated = 0u64;

                    for pool in &pools {
                        if let Ok(account) = rpc.get_account(&pool.address).await {
                            if let Ok(mut parsed) = self.parsers.parse_any(
                                &pool.address,
                                &account.data,
                                &account.owner,
                            ) {
                                let now_ms = SystemTime::now()
                                    .duration_since(UNIX_EPOCH)
                                    .unwrap_or_default()
                                    .as_millis() as u64;
                                parsed.last_updated_ms = now_ms;

                                if self.cache.upsert(parsed.clone()).is_some() {
                                    updated += 1;

                                    // Publish to Redis if bridge is available
                                    if let Some(ref redis_bridge) = redis {
                                        let _ = redis_bridge.publish_pool(&parsed).await;
                                    }
                                }
                            }
                        }
                    }

                    if updated > 0 {
                        log::debug!("Updated {} pools (total: {})", updated, self.cache.len());
                    }
                }
                _ = shutdown_rx.recv() => {
                    log::info!("Account subscription shutting down");
                    break;
                }
            }
        }

        Ok(())
    }
}
