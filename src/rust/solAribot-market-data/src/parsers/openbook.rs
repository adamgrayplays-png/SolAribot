use solana_sdk::pubkey::Pubkey;
use solAribot_core::dex::{OrderBookParser, PoolParser};
use solAribot_core::{
    DexLabel, OrderBook, PoolState, Result, SolAribotError, TokenInfo,
};

/// OpenBook v2 market account parser.
/// Reference: https://github.com/openbook-dex/openbook-v2
///
/// OpenBook uses a central limit order book (CLOB) model.
/// We parse both pool-like state (token mints) and the order book.
pub struct OpenBookParser;

impl PoolParser for OpenBookParser {
    fn dex_label(&self) -> DexLabel {
        DexLabel::OpenBook
    }

    fn parse_pool(&self, account_pubkey: &Pubkey, account_data: &[u8]) -> Result<PoolState> {
        if account_data.len() < 388 {
            // OpenBook v2 market accounts are ~388 bytes minimum
            return Err(SolAribotError::InvalidPoolData {
                dex: "OpenBook".into(),
                reason: format!("Data too short: {} bytes", account_data.len()),
            });
        }

        // OpenBook market header:
        // bytes 0..8: account discriminant
        // bytes 8..40: base mint (Pubkey)
        // bytes 40..48: base decimals (u64)
        // bytes 48..56: quote decimals (u64)
        // ... more fields follow

        let base_mint = Pubkey::try_from(&account_data[8..40]).map_err(|e| {
            SolAribotError::DeserializationError(format!("OpenBook base_mint: {}", e))
        })?;

        let quote_mint_bytes: [u8; 32] = account_data[88..120].try_into().unwrap_or_default();
        let quote_mint = Pubkey::new_from_array(quote_mint_bytes);

        Ok(PoolState {
            address: *account_pubkey,
            dex: DexLabel::OpenBook,
            token_a: TokenInfo {
                mint: base_mint,
                symbol: String::new(),
                decimals: 0,
            },
            token_b: TokenInfo {
                mint: quote_mint,
                symbol: String::new(),
                decimals: 0,
            },
            reserve_a: 0, // order book; reserves don't apply
            reserve_b: 0,
            sqrt_price_x64: None,
            tick_current: None,
            fee_rate_bps: 0, // taker/maker fees are separate
            last_updated_slot: 0,
            last_updated_ms: 0,
        })
    }

    fn expected_data_len(&self) -> Option<std::ops::Range<usize>> {
        Some(388..1000)
    }
}

impl OrderBookParser for OpenBookParser {
    fn dex_label(&self) -> DexLabel {
        DexLabel::OpenBook
    }

    fn parse_order_book(
        &self,
        market_address: &Pubkey,
        account_data: &[u8],
    ) -> Result<OrderBook> {
        // In a full implementation, we'd parse bids/asks slabs from the account data.
        // For now, return an empty order book — the engine fills it via websocket updates.

        Ok(OrderBook {
            market_address: *market_address,
            dex: DexLabel::OpenBook,
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
    fn test_openbook_label() {
        assert_eq!(OpenBookParser.dex_label(), DexLabel::OpenBook);
    }

    #[test]
    fn test_openbook_too_short() {
        let parser = OpenBookParser;
        let data = vec![0u8; 10];
        assert!(parser.parse_pool(&Pubkey::new_unique(), &data).is_err());
    }
}
