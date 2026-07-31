//! Compute budget optimization for Solana transactions.
//!
//! Determines optimal compute unit limits and priority fees based on
//! transaction complexity and recent network conditions.

/// Standard compute unit estimates for common operations.
pub mod limits {
    /// Base overhead for any transaction
    pub const BASE_OVERHEAD: u32 = 1_500;

    /// Compute units for a token transfer
    pub const TOKEN_TRANSFER: u32 = 5_000;

    /// Compute units for a single swap via Jupiter aggregator
    pub const JUPITER_SWAP: u32 = 140_000;

    /// Compute units for a Raydium AMM swap
    pub const RAYDIUM_AMM_SWAP: u32 = 50_000;

    /// Compute units for a Raydium CLMM swap
    pub const RAYDIUM_CLMM_SWAP: u32 = 100_000;

    /// Compute units for an Orca Whirlpool swap
    pub const ORCA_WHIRLPOOL_SWAP: u32 = 120_000;

    /// Compute units for Meteora DLMM swap
    pub const METEORA_DLMM_SWAP: u32 = 150_000;

    /// Compute units for OpenBook place/cancel + settle
    pub const OPENBOOK_ORDER: u32 = 80_000;

    /// Compute units per additional hop in a multi-hop route
    pub const ADDITIONAL_HOP_OVERHEAD: u32 = 20_000;

    /// Safety margin multiplier (1.2 = 20% buffer)
    pub const SAFETY_MARGIN: f64 = 1.2;

    /// Maximum compute unit limit (Solana cap)
    pub const MAX_COMPUTE_UNITS: u32 = 1_400_000;
}

/// Estimate compute units needed for a given number of hops.
pub fn estimate_compute_units(num_hops: usize) -> u32 {
    let base = limits::BASE_OVERHEAD + limits::JUPITER_SWAP;
    let hop_cu = limits::ADDITIONAL_HOP_OVERHEAD * (num_hops.saturating_sub(1)) as u32;
    let estimated = (base + hop_cu) as f64;
    let with_margin = estimated * limits::SAFETY_MARGIN;

    (with_margin as u32).min(limits::MAX_COMPUTE_UNITS)
}

/// Estimate compute units for a specific DEX swap.
pub fn estimate_for_dex(dex_label: &str, num_hops: usize) -> u32 {
    let per_swap = match dex_label {
        "RaydiumAmm" => limits::RAYDIUM_AMM_SWAP,
        "RaydiumClmm" => limits::RAYDIUM_CLMM_SWAP,
        "Orca" => limits::ORCA_WHIRLPOOL_SWAP,
        "Meteora" => limits::METEORA_DLMM_SWAP,
        "OpenBook" => limits::OPENBOOK_ORDER,
        _ => limits::JUPITER_SWAP,
    };

    let estimated = (limits::BASE_OVERHEAD + per_swap * num_hops as u32) as f64;
    let with_margin = estimated * limits::SAFETY_MARGIN;

    (with_margin as u32).min(limits::MAX_COMPUTE_UNITS)
}

/// Convert micro-lamports per CU to total priority fee in lamports.
pub fn total_priority_fee(compute_units: u32, micro_lamports_per_cu: u64) -> u64 {
    (compute_units as u128 * micro_lamports_per_cu as u128 / 1_000_000) as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_estimate_single_hop() {
        let cu = estimate_compute_units(1);
        assert!(cu > 50_000);
        assert!(cu <= limits::MAX_COMPUTE_UNITS);
    }

    #[test]
    fn test_estimate_multi_hop() {
        let cu_1 = estimate_compute_units(1);
        let cu_3 = estimate_compute_units(3);
        assert!(cu_3 > cu_1, "More hops should need more CU");
    }

    #[test]
    fn test_estimate_capped_at_max() {
        let cu = estimate_compute_units(100);
        assert!(cu <= limits::MAX_COMPUTE_UNITS);
    }

    #[test]
    fn test_total_priority_fee() {
        // 200_000 CU at 10_000 micro-lamports/CU = 2_000 lamports
        let fee = total_priority_fee(200_000, 10_000);
        assert_eq!(fee, 2_000);
    }
}
