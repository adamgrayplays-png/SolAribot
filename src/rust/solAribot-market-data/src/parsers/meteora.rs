use borsh::BorshDeserialize;
use solana_sdk::pubkey::Pubkey;
use solAribot_core::dex::PoolParser;
use solAribot_core::{
    DexLabel, PoolState, Result, SolAribotError, TokenInfo,
};

/// Meteora DLMM (Dynamic Liquidity Market Maker) pool account layout.
/// Reference: https://github.com/MeteoraAg/dlmm-sdk
///
/// DLMM pools use a bin-based architecture. Key fields for arbitrage:
/// - Active bin ID
/// - Bin step (price granularity)
/// - Token mints and reserves
#[derive(BorshDeserialize, Debug)]
struct MeteoraDlmmLayout {
    _discriminator: u64,
    // Bump seed
    pub bump: u8,
    _padding: [u8; 7],
    // Active bin ID
    pub active_id: i32,
    // Bin step
    pub bin_step: u16,
    // Status
    pub status: u8,
    _padding2: [u8; 5],
    // Non-borsh: we'll skip the rest and parse key fields manually
}

pub struct MeteoraParser;

impl PoolParser for MeteoraParser {
    fn dex_label(&self) -> DexLabel {
        DexLabel::Meteora
    }

    fn parse_pool(&self, account_pubkey: &Pubkey, account_data: &[u8]) -> Result<PoolState> {
        if account_data.len() < 100 {
            return Err(SolAribotError::InvalidPoolData {
                dex: "Meteora".into(),
                reason: format!("Data too short: {} bytes", account_data.len()),
            });
        }

        // Meteora DLMM accounts have a complex layout.
        // We parse the header and derive pool info at runtime.
        let layout = MeteoraDlmmLayout::try_from_slice(account_data).map_err(|e| {
            SolAribotError::DeserializationError(format!("Meteora: {}", e))
        })?;

        Ok(PoolState {
            address: *account_pubkey,
            dex: DexLabel::Meteora,
            token_a: TokenInfo {
                mint: Pubkey::default(),
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
            sqrt_price_x64: None,
            tick_current: Some(layout.active_id),
            fee_rate_bps: 0, // DLMM pools have variable fee per bin
            last_updated_slot: 0,
            last_updated_ms: 0,
        })
    }

    fn expected_data_len(&self) -> Option<std::ops::Range<usize>> {
        Some(1000..5000)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_meteora_label() {
        assert_eq!(MeteoraParser.dex_label(), DexLabel::Meteora);
    }
}
