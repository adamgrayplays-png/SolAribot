//! DEX-specific pool parsers.
//!
//! Each parser knows how to deserialize the on-chain account data format
//! for its specific DEX into our normalized `PoolState` representation.

use std::sync::Arc;

use solana_sdk::pubkey::Pubkey;
use solAribot_core::dex::PoolParser;
use solAribot_core::{DexLabel, Result, SolAribotError};

pub mod jupiter;
pub mod raydium_amm;
pub mod raydium_clmm;
pub mod orca;
pub mod meteora;
pub mod lifinity;
pub mod openbook;
pub mod phoenix;

/// Registry of all pool parsers, keyed by DEX label.
pub struct Registry {
    parsers: Vec<Arc<dyn PoolParser>>,
}

impl Registry {
    /// Create a new registry with all supported DEX parsers.
    pub fn new() -> Self {
        let parsers: Vec<Arc<dyn PoolParser>> = vec![
            Arc::new(jupiter::JupiterParser),
            Arc::new(raydium_amm::RaydiumAmmParser),
            Arc::new(raydium_clmm::RaydiumClmmParser),
            Arc::new(orca::OrcaParser),
            Arc::new(meteora::MeteoraParser),
            Arc::new(lifinity::LifinityParser),
            Arc::new(openbook::OpenBookParser),
            Arc::new(phoenix::PhoenixParser),
        ];
        Self { parsers }
    }

    /// Get the parser for a specific DEX label.
    pub fn get(&self, dex: DexLabel) -> Option<&Arc<dyn PoolParser>> {
        self.parsers.iter().find(|p| p.dex_label() == dex)
    }

    /// Try to parse account data with all registered parsers.
    /// Returns the first successful parse, or the last error.
    pub fn parse_any(
        &self,
        account_pubkey: &Pubkey,
        account_data: &[u8],
        owner: &Pubkey,
    ) -> Result<solAribot_core::PoolState> {
        // First try the parser whose program ID matches the owner
        let dex = match_dex_from_owner(owner);

        if let Some(label) = dex {
            if let Some(parser) = self.get(label) {
                return parser.parse_pool(account_pubkey, account_data);
            }
        }

        // Fall back to trying all parsers (slower, but handles edge cases)
        let mut last_err = None;
        for parser in &self.parsers {
            match parser.parse_pool(account_pubkey, account_data) {
                Ok(pool) => return Ok(pool),
                Err(e) => last_err = Some(e),
            }
        }

        Err(last_err.unwrap_or_else(|| {
            SolAribotError::InvalidPoolData {
                dex: owner.to_string(),
                reason: "No parser matched".into(),
            }
        }))
    }

    /// Get all parsers.
    pub fn all(&self) -> &[Arc<dyn PoolParser>] {
        &self.parsers
    }
}

/// Map a Solana program ID to a DexLabel.
pub fn match_dex_from_owner(owner: &Pubkey) -> Option<DexLabel> {
    use solAribot_core::program_ids::{resolve, JUPITER_V6, RAYDIUM_AMM, RAYDIUM_CLMM, ORCA_WHIRLPOOLS, METEORA_DLMM, LIFINITY, OPENBOOK, PHOENIX};

    if *owner == resolve(JUPITER_V6) {
        Some(DexLabel::Jupiter)
    } else if *owner == resolve(RAYDIUM_AMM) {
        Some(DexLabel::RaydiumAmm)
    } else if *owner == resolve(RAYDIUM_CLMM) {
        Some(DexLabel::RaydiumClmm)
    } else if *owner == resolve(ORCA_WHIRLPOOLS) {
        Some(DexLabel::Orca)
    } else if *owner == resolve(METEORA_DLMM) {
        Some(DexLabel::Meteora)
    } else if *owner == resolve(LIFINITY) {
        Some(DexLabel::Lifinity)
    } else if *owner == resolve(OPENBOOK) {
        Some(DexLabel::OpenBook)
    } else if *owner == resolve(PHOENIX) {
        Some(DexLabel::Phoenix)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use solAribot_core::program_ids;

    #[test]
    fn test_registry_has_all_dexes() {
        let reg = Registry::new();
        let expected = [
            DexLabel::Jupiter,
            DexLabel::RaydiumAmm,
            DexLabel::RaydiumClmm,
            DexLabel::Orca,
            DexLabel::Meteora,
            DexLabel::Lifinity,
            DexLabel::OpenBook,
            DexLabel::Phoenix,
        ];
        for label in &expected {
            assert!(reg.get(*label).is_some(), "Missing parser for {:?}", label);
        }
    }

    #[test]
    fn test_match_dex_from_owner() {
        assert_eq!(
            match_dex_from_owner(&program_ids::resolve(program_ids::JUPITER_V6)),
            Some(DexLabel::Jupiter)
        );
        assert_eq!(
            match_dex_from_owner(&Pubkey::new_unique()),
            None
        );
    }
}
