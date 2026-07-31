use borsh::BorshDeserialize;
use solana_sdk::pubkey::Pubkey;
use solAribot_core::dex::PoolParser;
use solAribot_core::{
    DexLabel, PoolState, Result, SolAribotError, TokenInfo,
};

/// Raydium AMM v4 pool account layout (simplified).
/// Reference: https://github.com/raydium-io/raydium-sdk
///
/// Actual layout is larger; we parse the fields needed for arbitrage.
#[derive(BorshDeserialize, Debug)]
struct RaydiumAmmLayout {
    // First 8 bytes: account discriminator (anchor-style, may not apply to older accounts)
    _discriminator: u64,
    // Status (u64): 0 = uninitialized, 1 = initialized
    pub status: u64,
    // Nonce
    pub nonce: u8,
    _padding: [u8; 7],
    // Token mints
    pub coin_mint: Pubkey,  // token_a
    pub pc_mint: Pubkey,    // token_b
    // Vaults
    pub coin_vault: Pubkey,
    pub pc_vault: Pubkey,
    // ... many more fields follow, we read reserves from vaults at runtime
}

/// Simplified Raydium v4 AMM pool state.
/// In production, we'd deserialize the full Raydium AMM state struct.
pub struct RaydiumAmmParser;

impl PoolParser for RaydiumAmmParser {
    fn dex_label(&self) -> DexLabel {
        DexLabel::RaydiumAmm
    }

    fn parse_pool(&self, account_pubkey: &Pubkey, account_data: &[u8]) -> Result<PoolState> {
        if account_data.len() < 8 + 8 + 1 + 7 + 32 * 4 {
            return Err(SolAribotError::InvalidPoolData {
                dex: "RaydiumAmm".into(),
                reason: format!("Data too short: {} bytes", account_data.len()),
            });
        }

        // Try to deserialize with Borsh
        let layout = RaydiumAmmLayout::try_from_slice(account_data).map_err(|e| {
            SolAribotError::DeserializationError(format!("Raydium AMM: {}", e))
        })?;

        // In a full implementation we'd also read reserve amounts from vault accounts.
        // For the parsed-once structure, we store the addresses so the engine can
        // fetch token balances via RPC `getTokenAccountBalance`.

        Ok(PoolState {
            address: *account_pubkey,
            dex: DexLabel::RaydiumAmm,
            token_a: TokenInfo {
                mint: layout.coin_mint,
                symbol: String::new(), // populated by token registry
                decimals: 0,           // populated by token registry
            },
            token_b: TokenInfo {
                mint: layout.pc_mint,
                symbol: String::new(),
                decimals: 0,
            },
            reserve_a: 0, // filled by the engine from vault balances
            reserve_b: 0,
            sqrt_price_x64: None,
            tick_current: None,
            fee_rate_bps: 25, // Raydium v4 default: 0.25%
            last_updated_slot: 0,
            last_updated_ms: 0,
        })
    }

    fn expected_data_len(&self) -> Option<std::ops::Range<usize>> {
        // Raydium v4 AMM accounts are typically 752 bytes
        Some(600..800)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_raydium_amm_too_short() {
        let parser = RaydiumAmmParser;
        let data = vec![0u8; 10];
        let result = parser.parse_pool(&Pubkey::new_unique(), &data);
        assert!(result.is_err());
    }

    #[test]
    fn test_raydium_amm_label() {
        assert_eq!(RaydiumAmmParser.dex_label(), DexLabel::RaydiumAmm);
    }
}
