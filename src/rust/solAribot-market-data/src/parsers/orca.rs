use borsh::BorshDeserialize;
use solana_sdk::pubkey::Pubkey;
use solAribot_core::dex::PoolParser;
use solAribot_core::{
    DexLabel, PoolState, Result, SolAribotError, TokenInfo,
};

/// Orca Whirlpool account layout (simplified).
/// Reference: https://github.com/orca-so/whirlpools
#[derive(BorshDeserialize, Debug)]
struct OrcaWhirlpoolLayout {
    _discriminator: u64,
    // Whirlpool bump
    pub whirlpool_bump: [u8; 1],
    _padding1: [u8; 7],
    // Tick spacing
    pub tick_spacing: u16,
    _padding2: [u8; 6],
    // Fee rate
    pub fee_rate: u16, // basis points
    // Protocol fee rate
    pub protocol_fee_rate: u16,
    // Liquidity
    pub liquidity: u128,
    // Sqrt price
    pub sqrt_price: u128,
    // Current tick
    pub tick_current_index: i32,
    // More fields...
}

pub struct OrcaParser;

impl PoolParser for OrcaParser {
    fn dex_label(&self) -> DexLabel {
        DexLabel::Orca
    }

    fn parse_pool(&self, account_pubkey: &Pubkey, account_data: &[u8]) -> Result<PoolState> {
        if account_data.len() < 300 {
            return Err(SolAribotError::InvalidPoolData {
                dex: "Orca".into(),
                reason: format!("Data too short: {} bytes", account_data.len()),
            });
        }

        let layout = OrcaWhirlpoolLayout::try_from_slice(account_data).map_err(|e| {
            SolAribotError::DeserializationError(format!("Orca: {}", e))
        })?;

        // Token mints are read from token vault A/B accounts at runtime.
        // In a full implementation we also store the vault addresses from the
        // whirlpool account. For now, reserve amounts are 0 (filled later).

        Ok(PoolState {
            address: *account_pubkey,
            dex: DexLabel::Orca,
            token_a: TokenInfo {
                mint: Pubkey::default(), // filled from vault lookups
                symbol: String::new(),
                decimals: 0,
            },
            token_b: TokenInfo {
                mint: Pubkey::default(),
                symbol: String::new(),
                decimals: 0,
            },
            reserve_a: 0,
            reserve_b: 0,
            sqrt_price_x64: Some(layout.sqrt_price),
            tick_current: Some(layout.tick_current_index),
            fee_rate_bps: layout.fee_rate,
            last_updated_slot: 0,
            last_updated_ms: 0,
        })
    }

    fn expected_data_len(&self) -> Option<std::ops::Range<usize>> {
        Some(300..600)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_orca_label() {
        assert_eq!(OrcaParser.dex_label(), DexLabel::Orca);
    }
}
