use solana_sdk::pubkey::Pubkey;
use solAribot_core::dex::PoolParser;
use solAribot_core::{
    DexLabel, PoolState, Result, SolAribotError, TokenInfo,
};

/// Jupiter v6 aggregator pool parser.
///
/// Jupiter v6 does not maintain traditional AMM pools — it's an aggregator
/// that routes swaps through multiple DEXes. On-chain accounts are primarily
/// for route validation and fee collection.
///
/// This parser extracts available metadata from Jupiter-owned accounts.
/// For actual price discovery, use the Jupiter Quote API rather than
/// on-chain pool parsing.
pub struct JupiterParser;

impl PoolParser for JupiterParser {
    fn dex_label(&self) -> DexLabel {
        DexLabel::Jupiter
    }

    fn parse_pool(&self, account_pubkey: &Pubkey, account_data: &[u8]) -> Result<PoolState> {
        // Jupiter v6 accounts vary in size and layout depending on type.
        // We attempt to extract what we can.

        if account_data.len() < 8 {
            return Err(SolAribotError::InvalidPoolData {
                dex: "Jupiter".into(),
                reason: format!("Data too short: {} bytes", account_data.len()),
            });
        }

        // Jupiter uses anchor-style discriminators (8 bytes).
        // Different account types have different discriminators.
        // For now, we return a minimal PoolState that marks this as a Jupiter pool.
        // Token mints are typically at known offsets depending on account type.

        // Try to read token mints at common offset positions.
        // For route plan / limit order accounts, token info may be at offset 8+
        let token_a_mint = if account_data.len() >= 40 {
            // Attempt to parse a Pubkey at offset 8
            Pubkey::try_from(&account_data[8..40]).unwrap_or_default()
        } else {
            Pubkey::default()
        };

        let token_b_mint = if account_data.len() >= 104 {
            // Attempt to parse a Pubkey at offset 72
            Pubkey::try_from(&account_data[72..104]).unwrap_or_default()
        } else if account_data.len() >= 72 {
            Pubkey::try_from(&account_data[40..72]).unwrap_or_default()
        } else {
            Pubkey::default()
        };

        Ok(PoolState {
            address: *account_pubkey,
            dex: DexLabel::Jupiter,
            token_a: TokenInfo {
                mint: token_a_mint,
                symbol: String::new(),
                decimals: 0,
            },
            token_b: TokenInfo {
                mint: token_b_mint,
                symbol: String::new(),
                decimals: 0,
            },
            reserve_a: 0, // Jupiter aggregator — prices from Quote API, not reserves
            reserve_b: 0,
            sqrt_price_x64: None,
            tick_current: None,
            fee_rate_bps: 0, // Jupiter fees are per-route, not per-pool
            last_updated_slot: 0,
            last_updated_ms: 0,
        })
    }

    fn expected_data_len(&self) -> Option<std::ops::Range<usize>> {
        // Jupiter accounts vary widely
        Some(8..10_000)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_jupiter_parser_label() {
        let parser = JupiterParser;
        assert_eq!(parser.dex_label(), DexLabel::Jupiter);
    }

    #[test]
    fn test_jupiter_parse_minimal_data() {
        let parser = JupiterParser;
        // Create a minimal account data with a Jupiter-like layout (anchor discriminator + some data)
        let mut data = vec![0u8; 104];
        // Put a recognizable pubkey at offset 8 (token A)
        let pk_a = Pubkey::new_unique();
        data[8..40].copy_from_slice(&pk_a.to_bytes());

        let result = parser.parse_pool(&Pubkey::new_unique(), &data);
        assert!(result.is_ok(), "Jupiter parser should return Ok for valid-length data");
        let pool = result.unwrap();
        assert_eq!(pool.dex, DexLabel::Jupiter);
        assert_eq!(pool.token_a.mint, pk_a);
    }

    #[test]
    fn test_jupiter_parse_too_short() {
        let parser = JupiterParser;
        let data = vec![0u8; 3];
        assert!(parser.parse_pool(&Pubkey::new_unique(), &data).is_err());
    }
}
