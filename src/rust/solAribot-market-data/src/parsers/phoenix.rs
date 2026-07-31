use borsh::BorshDeserialize;
use solana_sdk::pubkey::Pubkey;
use solAribot_core::dex::{OrderBookParser, PoolParser};
use solAribot_core::{
    DexLabel, OrderBook, PoolState, Result, SolAribotError, TokenInfo,
};

/// Phoenix DEX market account parser.
/// Reference: https://github.com/Ellipsis-Labs/phoenix-v1
///
/// Phoenix is a fully on-chain CLOB with instant settlement.
#[derive(BorshDeserialize, Debug)]
struct PhoenixMarketHeader {
    _discriminator: u64,
    // Market status flags
    pub status: u64,
    // Base token mint
    pub base_mint: Pubkey,
    // Quote token mint
    pub quote_mint: Pubkey,
}

pub struct PhoenixParser;

impl PoolParser for PhoenixParser {
    fn dex_label(&self) -> DexLabel {
        DexLabel::Phoenix
    }

    fn parse_pool(&self, account_pubkey: &Pubkey, account_data: &[u8]) -> Result<PoolState> {
        if account_data.len() < 100 {
            return Err(SolAribotError::InvalidPoolData {
                dex: "Phoenix".into(),
                reason: format!("Data too short: {} bytes", account_data.len()),
            });
        }

        // Phoenix market accounts are large; we parse just the header
        let header = PhoenixMarketHeader::try_from_slice(&account_data[..100]).map_err(|e| {
            SolAribotError::DeserializationError(format!("Phoenix: {}", e))
        })?;

        Ok(PoolState {
            address: *account_pubkey,
            dex: DexLabel::Phoenix,
            token_a: TokenInfo {
                mint: header.base_mint,
                symbol: String::new(),
                decimals: 0,
            },
            token_b: TokenInfo {
                mint: header.quote_mint,
                symbol: String::new(),
                decimals: 0,
            },
            reserve_a: 0,
            reserve_b: 0,
            sqrt_price_x64: None,
            tick_current: None,
            fee_rate_bps: 0, // Phoenix has taker/maker fee model
            last_updated_slot: 0,
            last_updated_ms: 0,
        })
    }

    fn expected_data_len(&self) -> Option<std::ops::Range<usize>> {
        // Phoenix accounts are very large (can be several KB to MB)
        Some(1000..10_000_000)
    }
}

impl OrderBookParser for PhoenixParser {
    fn dex_label(&self) -> DexLabel {
        DexLabel::Phoenix
    }

    fn parse_order_book(
        &self,
        market_address: &Pubkey,
        _account_data: &[u8],
    ) -> Result<OrderBook> {
        Ok(OrderBook {
            market_address: *market_address,
            dex: DexLabel::Phoenix,
            base_token: TokenInfo {
                mint: Pubkey::default(),
                symbol: String::new(),
                decimals: 0,
            },
            quote_token: TokenInfo {
                mint: Pubkey::default(),
                symbol: String::new(),
                decimals: 0,
            },
            bids: Vec::new(),
            asks: Vec::new(),
            last_updated_slot: 0,
            last_updated_ms: 0,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_phoenix_label() {
        assert_eq!(PhoenixParser.dex_label(), DexLabel::Phoenix);
    }
}
