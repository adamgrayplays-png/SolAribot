use borsh::BorshDeserialize;
use solana_sdk::pubkey::Pubkey;
use solAribot_core::dex::PoolParser;
use solAribot_core::{
    DexLabel, PoolState, Result, SolAribotError, TokenInfo,
};

/// Raydium CLMM pool account layout (simplified).
/// Reference: https://github.com/raydium-io/raydium-clmm
#[derive(BorshDeserialize, Debug)]
struct RaydiumClmmLayout {
    _discriminator: u64,
    // Bump
    pub bump: u8,
    _padding: [u8; 7],
    // Token mints
    pub mint_a: Pubkey,
    pub mint_b: Pubkey,
    // Vaults
    pub vault_a: Pubkey,
    pub vault_b: Pubkey,
    // Observation state
    pub observation_key: Pubkey,
    // Current state
    pub sqrt_price_x64: u128,
    pub tick_current: i32,
    // More fields follow...
}

pub struct RaydiumClmmParser;

impl PoolParser for RaydiumClmmParser {
    fn dex_label(&self) -> DexLabel {
        DexLabel::RaydiumClmm
    }

    fn parse_pool(&self, account_pubkey: &Pubkey, account_data: &[u8]) -> Result<PoolState> {
        if account_data.len() < 250 {
            return Err(SolAribotError::InvalidPoolData {
                dex: "RaydiumClmm".into(),
                reason: format!("Data too short: {} bytes", account_data.len()),
            });
        }

        let layout = RaydiumClmmLayout::try_from_slice(account_data).map_err(|e| {
            SolAribotError::DeserializationError(format!("Raydium CLMM: {}", e))
        })?;

        Ok(PoolState {
            address: *account_pubkey,
            dex: DexLabel::RaydiumClmm,
            token_a: TokenInfo {
                mint: layout.mint_a,
                symbol: String::new(),
                decimals: 0,
            },
            token_b: TokenInfo {
                mint: layout.mint_b,
                symbol: String::new(),
                decimals: 0,
            },
            reserve_a: 0, // Filled from vault balances
            reserve_b: 0,
            sqrt_price_x64: Some(layout.sqrt_price_x64),
            tick_current: Some(layout.tick_current),
            fee_rate_bps: 0, // Varies per pool; set by pool config
            last_updated_slot: 0,
            last_updated_ms: 0,
        })
    }

    fn expected_data_len(&self) -> Option<std::ops::Range<usize>> {
        Some(800..1600)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_clmm_label() {
        assert_eq!(RaydiumClmmParser.dex_label(), DexLabel::RaydiumClmm);
    }

    #[test]
    fn test_clmm_too_short() {
        let parser = RaydiumClmmParser;
        let data = vec![0u8; 10];
        assert!(parser.parse_pool(&Pubkey::new_unique(), &data).is_err());
    }
}
