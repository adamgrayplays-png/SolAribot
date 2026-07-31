"""
Synthetic data generator for offline model training.

Generates realistic Solana DeFi arbitrage scenarios with known ground-truth
labels for:
- Execution success (whether a trade would succeed)
- Realised slippage (beyond constant-product K)
- Fake arbitrage (opportunities that look profitable but aren't)

Parameters are calibrated to approximate real Solana DEX conditions.
"""

import math
import random
from typing import Dict, List, Tuple

import numpy as np
import pandas as pd

from config import config


class SyntheticDataGenerator:
    """Generates synthetic training data for all three ML models."""

    def __init__(self, seed: int = 42):
        self.rng = np.random.default_rng(seed)
        random.seed(seed)

    def _random_dex_type(self) -> str:
        return self.rng.choice(config.dex_types)

    def _sample_congestion(self) -> float:
        """Priority fee in microLamports — typical range 1_000–500_000."""
        # Log-normal: mostly low, occasional spikes
        return float(self.rng.lognormal(mean=10.0, sigma=1.2))

    def _sample_pool_liquidity(self) -> Tuple[float, float]:
        """Token A and B liquidity in USD. Typical pools: $10K–$50M."""
        tvl = float(self.rng.lognormal(mean=14.0, sigma=1.5))  # ~$1.2M median
        ratio = float(self.rng.uniform(0.1, 0.9))
        return tvl * ratio, tvl * (1 - ratio)

    def _sample_trade_size(self, pool_tvl: float) -> float:
        """Trade size relative to pool. Most trades 0.1%–10% of pool."""
        rel = float(self.rng.lognormal(mean=-3.0, sigma=1.2))
        return max(pool_tvl * rel, 10.0)  # min $10

    def _sample_volatility(self) -> float:
        """1-min price volatility (fractional). Solana: 0.05%–2% typical."""
        return float(self.rng.lognormal(mean=-4.5, sigma=0.8))

    def _sample_order_book_imbalance(self) -> float:
        """Ratio of buy to sell volume. 0.5–2.0 typical."""
        return float(self.rng.uniform(0.3, 3.0))

    def _sample_price_deviation(self) -> float:
        """% deviation from oracle price. Most <1%, some fake ones >5%."""
        return float(self.rng.lognormal(mean=-3.0, sigma=1.5))

    def _sample_spread(self) -> float:
        """Bid-ask spread in bps. Tight pools: 1–10 bps, thin: 50+."""
        return float(self.rng.lognormal(mean=2.5, sigma=1.0))

    def _sample_manip_events(self) -> int:
        """Count of large swaps in last 10 seconds."""
        return int(self.rng.poisson(lam=0.5))

    def _hour_bias(self, hour: int) -> float:
        """Trading activity multiplier by hour of day (UTC)."""
        # Peak during US/EU overlap hours (12-20 UTC)
        activity = {
            0: 0.4, 1: 0.3, 2: 0.25, 3: 0.25, 4: 0.3,
            5: 0.4, 6: 0.5, 7: 0.6, 8: 0.7, 9: 0.8,
            10: 0.9, 11: 1.0, 12: 1.0, 13: 1.0, 14: 1.0,
            15: 0.95, 16: 0.9, 17: 0.85, 18: 0.8, 19: 0.75,
            20: 0.7, 21: 0.6, 22: 0.5, 23: 0.45,
        }
        return activity.get(hour, 0.5)

    def generate_success_samples(self, n: int) -> pd.DataFrame:
        """
        Generate training data for Execution Success Predictor.

        Label: 1 = trade would succeed, 0 = trade would revert/fail.
        """
        rows = []
        for _ in range(n):
            hour = self.rng.integers(0, 24)
            congestion = self._sample_congestion()
            pool_a, pool_b = self._sample_pool_liquidity()
            total_tvl = pool_a + pool_b
            trade_size = self._sample_trade_size(total_tvl)
            trade_size_relative = trade_size / max(total_tvl, 1.0)
            route_hist_success = float(self.rng.uniform(0.3, 0.95))
            hour_activity = self._hour_bias(hour)
            dex = self._random_dex_type()

            # Ground-truth: probability of success based on realistic factors
            # High congestion → lower success
            # Large trade relative to pool → lower success
            # Good historical route success → higher success
            # Busy hours → more competition but also more liquidity
            log_cong = math.log10(max(congestion, 1.0))

            success_prob = (
                + 0.35  # baseline
                - 0.08 * min(log_cong / 5.0, 1.0)  # congestion penalty
                - 0.30 * min(trade_size_relative * 10, 1.0)  # size penalty
                + 0.25 * route_hist_success  # historical edge
                + 0.10 * hour_activity  # time-of-day boost
                - 0.05 * (1.0 if dex in ("openbook", "phoenix") else 0.0)  # thin order books
                + float(self.rng.normal(0, 0.08))  # noise
            )
            success_prob = np.clip(success_prob, 0.01, 0.99)
            label = 1 if self.rng.random() < success_prob else 0

            rows.append({
                "congestion_level": congestion,
                "pool_liquidity_token_a": pool_a,
                "pool_liquidity_token_b": pool_b,
                "trade_size_usd": trade_size,
                "trade_size_relative": trade_size_relative,
                "route_hist_success_rate": route_hist_success,
                "hour": hour,
                "dex_type": dex,
                "label": label,
                "success_prob": success_prob,
            })

        return pd.DataFrame(rows)

    def generate_slippage_samples(self, n: int) -> pd.DataFrame:
        """
        Generate training data for Slippage Estimator.

        Label: realised slippage fraction (e.g. 0.005 = 0.5%).
        Models slippage BEYOND the constant-product K formula.
        """
        rows = []
        for _ in range(n):
            dex = self._random_dex_type()
            pool_depth = float(self.rng.lognormal(mean=14.0, sigma=1.5))
            trade_size = self._sample_trade_size(pool_depth)
            imbalance = self._sample_order_book_imbalance()
            volatility = self._sample_volatility()
            trade_size_relative = trade_size / max(pool_depth, 1.0)

            # Ground-truth: slippage increases with:
            # - Larger trade relative to pool
            # - Higher volatility
            # - Order book imbalance away from 1.0
            # - Thinner DEX types (openbook, phoenix)
            dex_slippage_mult = {
                "jupiter": 1.0, "raydium": 1.1, "orca": 1.2,
                "meteora": 1.3, "lifinity": 0.9,  # Lifinity uses oracles
                "openbook": 2.0, "phoenix": 2.5,
            }

            base_slippage = (
                0.0005  # constant-product baseline
                + 0.02 * (trade_size_relative ** 1.5)  # size impact
                + 0.005 * volatility  # volatility impact
                + 0.001 * abs(math.log2(imbalance))  # imbalance impact
            )
            base_slippage *= dex_slippage_mult.get(dex, 1.0)
            base_slippage += float(self.rng.exponential(scale=0.001))  # noise
            base_slippage = np.clip(base_slippage, 0.0001, 0.10)

            rows.append({
                "pool_depth_usd": pool_depth,
                "trade_size_usd": trade_size,
                "order_book_imbalance": imbalance,
                "volatility_1min": volatility,
                "trade_size_relative": trade_size_relative,
                "dex_type": dex,
                "label_slippage": base_slippage,
            })

        return pd.DataFrame(rows)

    def generate_fake_samples(self, n: int) -> pd.DataFrame:
        """
        Generate training data for Fake Arbitrage Detector.

        Label: 1 = fake (not profitable), 0 = genuine opportunity.
        """
        rows = []
        for _ in range(n):
            is_fake = 1 if self.rng.random() < 0.35 else 0  # 35% fake rate

            if is_fake:
                # Fake opportunities: high deviation, thin liquidity, manip events
                price_dev = float(self.rng.lognormal(mean=-1.5, sigma=1.0))
                spread = float(self.rng.lognormal(mean=3.5, sigma=0.8))
                min_liq = float(self.rng.lognormal(mean=10.0, sigma=2.0))
                manip_events = int(self.rng.poisson(lam=2.0))
                expected_profit = float(self.rng.lognormal(mean=5.0, sigma=1.5))
            else:
                # Real opportunities: tighter, more liquid
                price_dev = float(self.rng.lognormal(mean=-4.0, sigma=1.0))
                spread = float(self.rng.lognormal(mean=2.0, sigma=0.7))
                min_liq = float(self.rng.lognormal(mean=14.0, sigma=1.2))
                manip_events = int(self.rng.poisson(lam=0.2))
                expected_profit = float(self.rng.lognormal(mean=6.0, sigma=1.2))

            expected_profit = max(expected_profit, 0.01)

            rows.append({
                "price_deviation_from_oracle": price_dev,
                "order_book_spread": spread,
                "min_liquidity_path_depth": min_liq,
                "recent_pool_manip_events": manip_events,
                "expected_profit_usd": expected_profit,
                "label": is_fake,
            })

        return pd.DataFrame(rows)

    def generate_all(self) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
        """Generate all three training datasets."""
        n = config.n_synthetic_samples
        return (
            self.generate_success_samples(n),
            self.generate_slippage_samples(n),
            self.generate_fake_samples(n),
        )
