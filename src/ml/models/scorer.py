"""
Opportunity Scorer.

Combines all ML signals into a single actionable score:

score = expected_profit × P(success) × (1 - slippage_penalty) × (1 - fake_flag)

Normalised to 0–100 range. Only score > dynamic threshold is actionable.
"""

from typing import Optional

import numpy as np

from config import config


class OpportunityScorer:
    """
    Combines model predictions into a single actionable score.

    The score formula:
        score = expected_profit × P(success) × (1 - slippage_penalty) × (1 - fake_prob)

    Normalised to [0, 100] via min-max scaling with adaptive bounds.

    Dynamic threshold tuning based on market conditions (volatility, congestion).
    """

    def __init__(self):
        # Adaptive normalisation bounds (warm-start from expected ranges)
        self._profit_bounds = [0.0, 100.0]       # [min_observed, max_observed]
        self._score_decay = 0.95                   # EMA decay for bound updates

    def compute(self,
                expected_profit_usd: float,
                success_prob: float,
                slippage_estimate: float,
                fake_prob: float,
                congestion_level: Optional[float] = None,
                volatility_1min: Optional[float] = None,
                ) -> dict:
        """
        Compute the opportunity score and all components.

        Args:
            expected_profit_usd: Expected profit from the arbitrage (USD)
            success_prob: P(success) from ExecutionSuccessPredictor
            slippage_estimate: Expected slippage fraction
            fake_prob: P(fake) from FakeArbitrageDetector
            congestion_level: Current network congestion (priority fee)
            volatility_1min: Current 1-min price volatility

        Returns:
            dict with score, components, and decision flags
        """
        # Input validation & clamping
        success_prob = np.clip(success_prob, 0.0, 1.0)
        slippage_estimate = np.clip(slippage_estimate, 0.0,
                                    config.max_slippage_penalty)
        fake_prob = np.clip(fake_prob, 0.0, 1.0)

        # Slippage penalty: quadratic to penalise large slippage more
        slippage_penalty = slippage_estimate * 10  # scale to 0-1 range
        slippage_penalty = min(slippage_penalty ** 1.5, 1.0)

        # Fake penalty: soft threshold around the config threshold
        fake_penalty = fake_prob
        if fake_prob >= config.fake_prob_threshold:
            fake_penalty = 1.0  # hard reject

        # Raw score
        raw_score = (
            max(expected_profit_usd, 0.0)
            * success_prob
            * (1.0 - slippage_penalty)
            * (1.0 - fake_penalty)
        )

        # Update adaptive bounds
        self._profit_bounds[0] = min(self._profit_bounds[0], expected_profit_usd)
        self._profit_bounds[1] = max(self._profit_bounds[1], expected_profit_usd)

        # Normalise to 0-100
        # Use a dynamic ceiling that adapts to observed profits
        profit_range = max(self._profit_bounds[1] - self._profit_bounds[0], 1.0)
        normalised = (raw_score / profit_range) * 100.0
        normalised = np.clip(normalised, 0.0, 100.0)

        # Dynamic threshold based on market conditions
        threshold = self._compute_threshold(congestion_level, volatility_1min)

        # Decision
        is_actionable = (
            normalised >= threshold
            and success_prob >= config.min_success_prob
            and fake_prob < config.fake_prob_threshold
        )

        return {
            "score": float(normalised),
            "raw_score": float(raw_score),
            "success_probability": float(success_prob),
            "slippage_estimate": float(slippage_estimate),
            "slippage_penalty": float(slippage_penalty),
            "fake_probability": float(fake_prob),
            "fake_rejected": fake_prob >= config.fake_prob_threshold,
            "threshold": float(threshold),
            "actionable": bool(is_actionable),
        }

    def _compute_threshold(self,
                           congestion: Optional[float],
                           volatility: Optional[float]) -> float:
        """
        Dynamically adjust the minimum score threshold.

        In high volatility / high congestion (more competition):
        → raise threshold to avoid marginal trades.

        In low volatility / low congestion:
        → lower threshold to capture more opportunities.
        """
        base = config.min_actionable_score

        # Congestion adjustment (log-scale: 1K-500K microLamports)
        if congestion is not None and congestion > 0:
            congestion_factor = np.clip(np.log10(congestion) / 6.0, 0.0, 1.0)
            base += congestion_factor * 20.0  # up to +20 points when congested

        # Volatility adjustment (0.001 = 0.1%, 0.05 = 5%)
        if volatility is not None and volatility > 0:
            vol_factor = np.clip(volatility * 100, 0.0, 2.0)  # 0-2x
            base += (vol_factor - 1.0) * 10.0  # -10 to +10 adjustment

        # Competition proxy: higher threshold during busy hours
        # (simplified — real implementation would use live bot count)
        base = np.clip(base, 20.0, 80.0)  # keep within sensible range
        return float(base)