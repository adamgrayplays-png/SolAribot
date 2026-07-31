//! Dynamic priority fee estimation.
//!
//! Analyzes recent block data to determine optimal priority fees for
//! timely transaction inclusion. Higher fees during congestion,
//! competitive but not excessive fees during normal conditions.

use std::collections::VecDeque;

/// Tracks recent priority fee data and provides fee recommendations.
pub struct PriorityFeeEstimator {
    /// Recent median priority fees per CU (micro-lamports), most recent last
    recent_fees: VecDeque<u64>,
    /// Maximum number of samples to retain
    max_samples: usize,
    /// Default fee when no data is available
    default_fee: u64,
    /// Minimum fee we're willing to pay
    min_fee: u64,
    /// Maximum fee cap
    max_fee: u64,
    /// Multiplier to stay competitive (e.g. 1.5 = 50% above median)
    competitive_multiplier: f64,
}

impl PriorityFeeEstimator {
    /// Create a new estimator.
    pub fn new() -> Self {
        Self {
            recent_fees: VecDeque::with_capacity(100),
            max_samples: 100,
            default_fee: 1_000,     // 1k micro-lamports/CU (~0.001 SOL for 1M CU)
            min_fee: 100,            // floor
            max_fee: 1_000_000,      // cap: 1 SOL/CU micro-lamports
            competitive_multiplier: 1.2,
        }
    }

    /// Set the competitive multiplier (e.g. 1.5 for 50% above median).
    pub fn with_multiplier(mut self, multiplier: f64) -> Self {
        self.competitive_multiplier = multiplier;
        self
    }

    /// Set the fee range.
    pub fn with_fee_range(mut self, min: u64, max: u64) -> Self {
        self.min_fee = min;
        self.max_fee = max;
        self
    }

    /// Record a recent observed priority fee (micro-lamports per CU).
    pub fn record_fee(&mut self, fee_micro_lamports: u64) {
        if self.recent_fees.len() >= self.max_samples {
            self.recent_fees.pop_front();
        }
        self.recent_fees.push_back(fee_micro_lamports);
    }

    /// Record multiple fees at once (e.g. from recent block).
    pub fn record_fees(&mut self, fees: &[u64]) {
        for &fee in fees {
            self.record_fee(fee);
        }
    }

    /// Get the recommended priority fee (micro-lamports per CU).
    /// Uses a percentile of recent fees multiplied by competitive factor.
    pub fn recommended_fee(&self) -> u64 {
        if self.recent_fees.is_empty() {
            return self.default_fee;
        }

        let p75 = self.percentile(75.0);
        let recommended = (p75 as f64 * self.competitive_multiplier) as u64;

        recommended.clamp(self.min_fee, self.max_fee)
    }

    /// Get the aggressive fee (higher percentile, for urgent txs).
    pub fn aggressive_fee(&self) -> u64 {
        if self.recent_fees.is_empty() {
            return self.default_fee * 2;
        }

        let p90 = self.percentile(90.0);
        let recommended = (p90 as f64 * self.competitive_multiplier * 1.5) as u64;

        recommended.clamp(self.min_fee, self.max_fee)
    }

    /// Get the economical fee (lower percentile, for non-urgent txs).
    pub fn economical_fee(&self) -> u64 {
        if self.recent_fees.is_empty() {
            return self.min_fee;
        }

        let p50 = self.percentile(50.0);
        p50.max(self.min_fee)
    }

    /// Number of samples collected.
    pub fn sample_count(&self) -> usize {
        self.recent_fees.len()
    }

    /// Compute the given percentile from recent fees.
    fn percentile(&self, pct: f64) -> u64 {
        if self.recent_fees.is_empty() {
            return self.default_fee;
        }

        let mut sorted: Vec<u64> = self.recent_fees.iter().copied().collect();
        sorted.sort_unstable();

        let idx = ((pct / 100.0) * (sorted.len() as f64 - 1.0)) as usize;
        sorted[idx.min(sorted.len() - 1)]
    }
}

impl Default for PriorityFeeEstimator {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_returns_default() {
        let est = PriorityFeeEstimator::new();
        assert_eq!(est.recommended_fee(), 1_000);
        assert_eq!(est.aggressive_fee(), 2_000);
    }

    #[test]
    fn test_with_data() {
        let mut est = PriorityFeeEstimator::new();
        // Add some fees
        for fee in &[500, 1000, 1500, 2000, 2500, 3000] {
            est.record_fee(*fee);
        }

        let rec = est.recommended_fee();
        assert!(rec >= est.min_fee);
        assert!(rec <= est.max_fee);

        let agg = est.aggressive_fee();
        assert!(agg >= rec, "Aggressive should be >= recommended");
    }

    #[test]
    fn test_clamped() {
        let mut est = PriorityFeeEstimator::new()
            .with_fee_range(100, 5000);

        // Record very high fees
        for _ in 0..50 {
            est.record_fee(10_000);
        }

        let rec = est.recommended_fee();
        assert!(rec <= 5000, "Should be capped at max_fee");
    }

    #[test]
    fn test_economical() {
        let mut est = PriorityFeeEstimator::new();
        for fee in &[1000, 2000, 3000] {
            est.record_fee(*fee);
        }
        let eco = est.economical_fee();
        assert!(eco >= est.min_fee);
        assert!(eco <= est.recommended_fee());
    }
}
