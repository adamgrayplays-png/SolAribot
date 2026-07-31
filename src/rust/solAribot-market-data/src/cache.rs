use parking_lot::RwLock;
use solana_sdk::pubkey::Pubkey;
use std::collections::HashMap;
use std::sync::Arc;

use solAribot_core::{DexLabel, PoolState, MAX_CACHED_POOLS, MAX_STALENESS_MS};

/// Thread-safe, concurrent in-memory cache of pool states.
///
/// Designed for sub-millisecond reads under heavy concurrent access.
/// Uses `parking_lot::RwLock` which is significantly faster than std's RwLock.
pub struct PoolCache {
    /// pool_address → PoolState
    pools: RwLock<HashMap<Pubkey, PoolState>>,
    /// (token_a_mint, token_b_mint) → set of pool addresses (for pair lookup)
    pair_index: RwLock<HashMap<(Pubkey, Pubkey), Vec<Pubkey>>>,
    stats: RwLock<CacheStats>,
}

#[derive(Debug, Clone, Default)]
pub struct CacheStats {
    pub total_pools: usize,
    pub pools_by_dex: HashMap<DexLabel, usize>,
    pub updates_since_start: u64,
    pub last_update_ms: u64,
}

impl PoolCache {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            pools: RwLock::new(HashMap::with_capacity(MAX_CACHED_POOLS)),
            pair_index: RwLock::new(HashMap::with_capacity(MAX_CACHED_POOLS)),
            stats: RwLock::new(CacheStats::default()),
        })
    }

    /// Insert or update a pool state. Returns the old state if it existed.
    pub fn upsert(&self, pool: PoolState) -> Option<PoolState> {
        let pair = (pool.token_a.mint, pool.token_b.mint);
        let address = pool.address;

        // Update pair index
        {
            let mut idx = self.pair_index.write();
            idx.entry(pair).or_default();
            let addrs = idx.get_mut(&pair).unwrap();
            if !addrs.contains(&address) {
                addrs.push(address);
            }
        }

        // Update pools
        let old = {
            let mut p = self.pools.write();
            p.insert(address, pool)
        };

        // Update stats
        {
            let mut stats = self.stats.write();
            stats.updates_since_start += 1;
            stats.total_pools = self.pools.read().len();
            self.rebuild_dex_stats(&mut stats);
        }

        old
    }

    /// Get a pool state by address.
    pub fn get(&self, address: &Pubkey) -> Option<PoolState> {
        let pools = self.pools.read();
        pools.get(address).cloned()
    }

    /// Get all pools for a given token pair.
    pub fn get_by_pair(&self, token_a: &Pubkey, token_b: &Pubkey) -> Vec<PoolState> {
        let idx = self.pair_index.read();
        let pools = self.pools.read();
        let key = (*token_a, *token_b);
        let reverse_key = (*token_b, *token_a);

        let mut results = Vec::new();
        for pair_key in &[key, reverse_key] {
            if let Some(addrs) = idx.get(pair_key) {
                for addr in addrs {
                    if let Some(pool) = pools.get(addr) {
                        results.push(pool.clone());
                    }
                }
            }
        }
        results
    }

    /// Get all pools from a specific DEX.
    pub fn get_by_dex(&self, dex: DexLabel) -> Vec<PoolState> {
        let pools = self.pools.read();
        pools.values().filter(|p| p.dex == dex).cloned().collect()
    }

    /// Remove stale pools (not updated within `max_staleness_ms`).
    /// Returns the number of pools removed.
    pub fn evict_stale(&self, now_ms: u64, max_staleness_ms: u64) -> usize {
        let threshold = now_ms.saturating_sub(max_staleness_ms);
        let mut pools = self.pools.write();
        let mut idx = self.pair_index.write();

        let stale_keys: Vec<Pubkey> = pools
            .iter()
            .filter(|(_, p)| p.last_updated_ms < threshold)
            .map(|(k, _)| *k)
            .collect();

        for key in &stale_keys {
            if let Some(pool) = pools.remove(key) {
                let pair_key = (pool.token_a.mint, pool.token_b.mint);
                if let Some(addrs) = idx.get_mut(&pair_key) {
                    addrs.retain(|a| a != key);
                }
            }
        }

        let count = stale_keys.len();
        if count > 0 {
            let mut stats = self.stats.write();
            stats.total_pools = pools.len();
            self.rebuild_dex_stats(&mut stats);
        }
        count
    }

    /// Return the number of pools currently cached.
    pub fn len(&self) -> usize {
        self.pools.read().len()
    }

    /// Check if the cache is empty.
    pub fn is_empty(&self) -> bool {
        self.pools.read().is_empty()
    }

    /// Get current cache stats.
    pub fn stats(&self) -> CacheStats {
        self.stats.read().clone()
    }

    /// Get all pools currently cached (snapshot copy).
    pub fn all_pools(&self) -> Vec<PoolState> {
        self.pools.read().values().cloned().collect()
    }

    fn rebuild_dex_stats(&self, stats: &mut CacheStats) {
        let pools = self.pools.read();
        stats.pools_by_dex.clear();
        for pool in pools.values() {
            *stats.pools_by_dex.entry(pool.dex).or_insert(0) += 1;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use solAribot_core::TokenInfo;

    fn make_pool(address: Pubkey, dex: DexLabel, reserve_a: u64, reserve_b: u64) -> PoolState {
        PoolState {
            address,
            dex,
            token_a: TokenInfo::wsol(),
            token_b: TokenInfo::usdc(),
            reserve_a,
            reserve_b,
            sqrt_price_x64: None,
            tick_current: None,
            fee_rate_bps: 30,
            last_updated_slot: 0,
            last_updated_ms: 1000,
        }
    }

    #[test]
    fn test_upsert_and_get() {
        let cache = PoolCache::new();
        let addr = Pubkey::new_unique();
        let pool = make_pool(addr, DexLabel::RaydiumAmm, 100, 200);

        assert!(cache.upsert(pool.clone()).is_none());
        assert_eq!(cache.len(), 1);

        let fetched = cache.get(&addr).unwrap();
        assert_eq!(fetched.address, addr);

        // Upsert again with updated data
        let mut updated = pool.clone();
        updated.reserve_a = 150;
        let old = cache.upsert(updated).unwrap();
        assert_eq!(old.reserve_a, 100);

        let fetched2 = cache.get(&addr).unwrap();
        assert_eq!(fetched2.reserve_a, 150);
    }

    #[test]
    fn test_get_by_pair() {
        let cache = PoolCache::new();
        let addr1 = Pubkey::new_unique();
        let addr2 = Pubkey::new_unique();

        cache.upsert(make_pool(addr1, DexLabel::Orca, 100, 200));
        cache.upsert(make_pool(addr2, DexLabel::RaydiumAmm, 300, 400));

        let wsol = TokenInfo::wsol().mint;
        let usdc = TokenInfo::usdc().mint;

        let pools = cache.get_by_pair(&wsol, &usdc);
        assert_eq!(pools.len(), 2);
    }

    #[test]
    fn test_evict_stale() {
        let cache = PoolCache::new();
        let addr = Pubkey::new_unique();
        cache.upsert(make_pool(addr, DexLabel::RaydiumAmm, 100, 200));

        // Now evict with threshold that's passed
        let removed = cache.evict_stale(10000, MAX_STALENESS_MS);
        assert_eq!(removed, 1);
        assert!(cache.is_empty());
    }

    #[test]
    fn test_stats() {
        let cache = PoolCache::new();
        cache.upsert(make_pool(Pubkey::new_unique(), DexLabel::Orca, 100, 200));
        cache.upsert(make_pool(Pubkey::new_unique(), DexLabel::RaydiumAmm, 100, 200));

        let stats = cache.stats();
        assert_eq!(stats.total_pools, 2);
        assert_eq!(stats.updates_since_start, 2);
    }
}
