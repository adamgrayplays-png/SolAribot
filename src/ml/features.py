"""
Feature pipeline for the ML decision layer.

Transforms raw opportunity data (from the TS orchestrator/Rust engine)
into feature vectors for model inference.

Handles:
- Numeric feature standardisation (z-score via fitted scaler)
- Cyclical time encoding (sin/cos of hour)
- DEX type one-hot encoding
- Feature ordering consistent with training
"""

import math
from typing import Dict, List, Optional

import numpy as np
import joblib
from sklearn.preprocessing import StandardScaler

from config import config


class FeaturePipeline:
    """Transforms raw opportunity dicts into model-ready feature vectors."""

    def __init__(self, scaler: Optional[StandardScaler] = None):
        self.scaler = scaler
        self._fitted = scaler is not None

    def fit_scaler(self, X: np.ndarray):
        """Fit the standard scaler on training data."""
        self.scaler = StandardScaler().fit(X)
        self._fitted = True

    def _encode_hour(self, hour: int) -> tuple:
        """Cyclical encoding of hour of day."""
        radians = 2 * math.pi * hour / 24.0
        return (math.sin(radians), math.cos(radians))

    def _encode_dex_type(self, dex: str) -> List[float]:
        """One-hot encode DEX type."""
        return [1.0 if dex == d else 0.0 for d in config.dex_types]

    def extract_success_features(self, opportunity: dict) -> np.ndarray:
        """
        Extract features for the Execution Success Predictor.

        Expected opportunity keys:
            congestion_level, pool_liquidity_token_a, pool_liquidity_token_b,
            trade_size, route_hist_success_rate, hour
        """
        trade_size = float(opportunity.get("trade_size_usd", 0))
        pool_a = float(opportunity.get("pool_liquidity_token_a", 0))
        pool_b = float(opportunity.get("pool_liquidity_token_b", 0))
        total_tvl = pool_a + pool_b

        trade_size_relative = trade_size / max(total_tvl, 1.0)
        hour = int(opportunity.get("hour", 12))
        hour_sin, hour_cos = self._encode_hour(hour)

        row = [
            float(opportunity.get("congestion_level", 0)),
            math.log10(max(pool_a, 1.0)),
            math.log10(max(pool_b, 1.0)),
            min(trade_size_relative, 1.0),  # cap at 100%
            float(opportunity.get("route_hist_success_rate", 0.5)),
            hour_sin,
            hour_cos,
        ]
        return np.array(row, dtype=np.float32)

    def extract_slippage_features(self, opportunity: dict) -> np.ndarray:
        """
        Extract features for the Slippage Estimator.

        Expected keys: pool_depth_usd, trade_size_usd, order_book_imbalance,
                       volatility_1min, dex_type
        """
        pool_depth = float(opportunity.get("pool_depth_usd", 0))
        trade_size = float(opportunity.get("trade_size_usd", 0))
        dex = opportunity.get("dex_type", "jupiter")

        trade_size_relative = trade_size / max(pool_depth, 1.0)
        dex_encoded = self._encode_dex_type(dex)

        row = [
            math.log10(max(pool_depth, 1.0)),
            math.log10(max(trade_size, 1.0)),
            float(opportunity.get("order_book_imbalance", 0.0)),
            float(opportunity.get("volatility_1min", 0.001)),
            min(trade_size_relative, 1.0),
        ] + dex_encoded
        return np.array(row, dtype=np.float32)

    def extract_fake_detector_features(self, opportunity: dict) -> np.ndarray:
        """
        Extract features for the Fake Arbitrage Detector.

        Expected keys: price_deviation_from_oracle, order_book_spread,
                       min_liquidity_path_depth, recent_pool_manip_events,
                       expected_profit_usd
        """
        profit = float(opportunity.get("expected_profit_usd", 0))
        min_liq = float(opportunity.get("min_liquidity_path_depth", 1.0))

        row = [
            float(opportunity.get("price_deviation_from_oracle", 0.0)),
            float(opportunity.get("order_book_spread", 0.0)),
            math.log10(max(min_liq, 1.0)),
            float(opportunity.get("recent_pool_manip_events", 0)),
            profit / max(min_liq, 1.0),
            1.0 - (min_liq / max(profit + min_liq, 1.0)),  # depth imbalance
        ]
        return np.array(row, dtype=np.float32)

    def scale(self, X: np.ndarray) -> np.ndarray:
        """Apply standard scaling if fitted."""
        if self._fitted and self.scaler is not None:
            return self.scaler.transform(X.reshape(1, -1)).flatten()
        return X

    def save_scaler(self, path: str):
        """Persist the fitted scaler."""
        if self.scaler is not None:
            joblib.dump(self.scaler, path)

    @classmethod
    def load_scaler(cls, path: str) -> "FeaturePipeline":
        """Load a persisted scaler."""
        scaler = joblib.load(path)
        return cls(scaler=scaler)
