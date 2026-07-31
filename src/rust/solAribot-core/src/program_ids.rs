/// DEX program IDs as string literals for all 7 supported DEXes.
use solana_sdk::pubkey::Pubkey;

/// Jupiter v6 Aggregator
pub const JUPITER_V6: &str = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNPU2MqG";

/// Raydium AMM v4
pub const RAYDIUM_AMM: &str = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";
/// Raydium CLMM (Concentrated Liquidity)
pub const RAYDIUM_CLMM: &str = "routeUGWgWzqBWFcrCfv8tritsqukccJPu3q5GPP3xS";

/// Orca Whirlpools
pub const ORCA_WHIRLPOOLS: &str = "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc";

/// Meteora DLMM
pub const METEORA_DLMM: &str = "Eo7WjKq67rjJ8Z2k6tRkQ5LcN7sr6wBAqP6YKhWxqmy9";

/// Lifinity
pub const LIFINITY: &str = "2wT8Yq49kHgDzGxGS1e5C9A5X9qBuJfY6F1J6TzuqLkD";

/// OpenBook v2
pub const OPENBOOK: &str = "opnb2LAfJYbRMAHHvqjCwQxLZn8zPfd6QZcC6Y4QFn";

/// Phoenix DEX
pub const PHOENIX: &str = "PhoeNiXZ8ByJGL1JCUZ4em4M1EVfBK2MkC4W3Tq6C3G";

// --- SOL / USDC mint addresses ---
pub const WSOL_MINT: &str = "So11111111111111111111111111111111111111112";
pub const USDC_MINT: &str = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
pub const USDT_MINT: &str = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

/// Resolve a program ID string to a Pubkey. Panics if the string is not a valid base58 pubkey.
pub fn resolve(id: &str) -> Pubkey {
    id.parse().expect("Invalid program ID string")
}

pub fn jupiter_v6() -> Pubkey {
    resolve(JUPITER_V6)
}
pub fn raydium_amm() -> Pubkey {
    resolve(RAYDIUM_AMM)
}
pub fn raydium_clmm() -> Pubkey {
    resolve(RAYDIUM_CLMM)
}
pub fn orca_whirlpools() -> Pubkey {
    resolve(ORCA_WHIRLPOOLS)
}
pub fn meteora_dlmm() -> Pubkey {
    resolve(METEORA_DLMM)
}
pub fn lifinity() -> Pubkey {
    resolve(LIFINITY)
}
pub fn openbook() -> Pubkey {
    resolve(OPENBOOK)
}
pub fn phoenix() -> Pubkey {
    resolve(PHOENIX)
}

/// Helper: returns true if the given program ID matches any known DEX program.
pub fn is_known_dex(program_id: &Pubkey) -> bool {
    let known: &[&str] = &[
        JUPITER_V6,
        RAYDIUM_AMM,
        RAYDIUM_CLMM,
        ORCA_WHIRLPOOLS,
        METEORA_DLMM,
        LIFINITY,
        OPENBOOK,
        PHOENIX,
    ];
    known.iter().any(|s| resolve(s) == *program_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_all_ids() {
        for id in &[
            JUPITER_V6,
            RAYDIUM_AMM,
            RAYDIUM_CLMM,
            ORCA_WHIRLPOOLS,
            METEORA_DLMM,
            LIFINITY,
            OPENBOOK,
            PHOENIX,
            WSOL_MINT,
            USDC_MINT,
            USDT_MINT,
        ] {
            let _pk = resolve(id);
        }
    }

    #[test]
    fn test_is_known_dex() {
        assert!(is_known_dex(&resolve(JUPITER_V6)));
        assert!(is_known_dex(&resolve(RAYDIUM_AMM)));
        assert!(is_known_dex(&resolve(ORCA_WHIRLPOOLS)));
        // A random pubkey should NOT be known
        let random = solana_sdk::pubkey::Pubkey::new_unique();
        assert!(!is_known_dex(&random));
    }
}
