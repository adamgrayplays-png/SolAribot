use borsh::BorshDeserialize;
use solana_sdk::pubkey::Pubkey;
use solAribot_core::dex::PoolParser;
use solAribot_core::{
    DexLabel, PoolState, Result, SolAribotError, TokenInfo,
};

/// Lifinity pool account layout.
/// Reference: https://github.com/Lifinity-Exchange
///
/// Lifinity uses an oracle-based AMM with concentrated liquidity.
#[derive(BorshDeserialize, Debug)]
struct LifinityLayout {
    _discriminator: u64,
    // Initialized flag
    pub initialized: bool,
    _padding: [u8; 7],
    // Token mints
    pub mint_a: Pubkey,
    pub mint_b: Pubkey,
    // Vaults
    pub vault_a: Pubkey,
    pub vault_b: Pubkey,
    // Fee config
    pub fee_numerator: u64,
    pub fee_denominator: u64,
}

pub struct LifinityParser;

impl PoolParser for LifinityParser {
    fn dex_label(&self) -> DexLabel {
        DexLabel::Lifinity
    }

    fn parse_pool(&self, account_pubkey: &Pubkey, account_data: &[u8]) -> Result<PoolState> {
        if account_data.len() < 200 {
            return Err(SolAribotError::InvalidPoolData {
                dex: "Lifinity".into(),
                reason: format!("Data too short: {} bytes", account_data.len()),
            });
        }

        let layout = LifinityLayout::try_from_slice(account_data).map_err(|e| {
            SolAribotError::DeserializationError(format!("Lifinity: {}", e))
        })?;

        let fee_rate_bps = if layout.fee_denominator > 0 {
            ((layout.fee_numerator as f64 / layout.fee_denominator as f64) * 10000.0) as u16
        } else {
            0
        };

        Ok(PoolState {
            address: *account_pubkey,
            dex: DexLabel::Lifinity,
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
            reserve_a: 0,
            reserve_b: 0,
            sqrt_price_x64: None,
            tick_current: None,
            fee_rate_bps,
            last_updated_slot: 0,
            last_updated_ms: 0,
        })
    }

    fn expected_data_len(&self) -> Option<std::ops::Range<usize>> {
        Some(200..500)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_lifinity_label() {
        assert_eq!(LifinityParser.dex_label(), DexLabel::Lifinity);
    }
}
