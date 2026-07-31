"""
Slippage Estimator.

Per-DEX model that estimates real slippage beyond the constant-product K curve.
Uses gradient boosted trees (XGBoost regressor) trained per DEX type.

Features: pool depth, trade size, order book imbalance, 1-min volatility,
trade size relative to pool depth, DEX type (one-hot).

Heuristic fallback when model confidence is low.
"""

from pathlib import Path
from typing import Dict, Optional

import joblib
import numpy as np
import xgboost as xgb
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

from config import config


class SlippageEstimator:
    """
    Regressor estimating real slippage fraction for a trade.

    Uses a single XGBoost regressor with DEX type as a one-hot feature.
    Falls back to a constant-product heuristic when model uncertainty is high.
    """

    def __init__(self):
        self.model: Optional[xgb.XGBRegressor] = None

    def train(self, X: np.ndarray, y: np.ndarray,
              X_val: Optional[np.ndarray] = None,
              y_val: Optional[np.ndarray] = None) -> dict:
        """
        Train the slippage regressor.

        Args:
            X: Training features
            y: Target slippage fraction
            X_val: Validation features
            y_val: Validation targets

        Returns:
            dict of training metrics
        """
        self.model = xgb.XGBRegressor(
            n_estimators=200,
            max_depth=5,
            learning_rate=0.1,
            subsample=0.8,
            colsample_bytree=0.8,
            min_child_weight=3,
            reg_alpha=0.1,
            reg_lambda=1.0,
            random_state=42,
        )

        self.model.fit(X, y, verbose=False)

        train_preds = self.model.predict(X)
        metrics = {
            "train_mae": float(mean_absolute_error(y, train_preds)),
            "train_rmse": float(np.sqrt(mean_squared_error(y, train_preds))),
            "train_r2": float(r2_score(y, train_preds)),
        }

        if X_val is not None and y_val is not None:
            val_preds = self.model.predict(X_val)
            metrics.update({
                "val_mae": float(mean_absolute_error(y_val, val_preds)),
                "val_rmse": float(np.sqrt(mean_squared_error(y_val, val_preds))),
                "val_r2": float(r2_score(y_val, val_preds)),
            })

        return metrics

    def predict(self, X: np.ndarray) -> np.ndarray:
        """Predict slippage fraction for feature matrix."""
        if self.model is None:
            raise RuntimeError("Model not trained or loaded")
        return self.model.predict(X)

    def predict_single(self, features: np.ndarray) -> float:
        """
        Predict slippage for a single opportunity (fast path).

        Falls back to heuristic if prediction seems unreliable.

        Args:
            features: 1D feature array

        Returns:
            Estimated slippage fraction (e.g. 0.005 = 0.5%)
        """
        pred = float(self.predict(features.reshape(1, -1))[0])

        # Heuristic fallback: if model prediction is extreme, use CP formula
        if pred < 0.0001 or pred > 0.10:
            # Constant-product heuristic
            trade_size = features[1]  # log trade_size
            pool_depth = features[0]  # log pool_depth
            trade_actual = 10 ** trade_size
            pool_actual = 10 ** pool_depth
            cp_slippage = (trade_actual / max(pool_actual, 1.0)) ** 1.5 * 0.01
            pred = np.clip(cp_slippage, 0.0001, 0.05)

        return float(pred)

    def save(self, path: Optional[str] = None):
        """Save model."""
        path = path or config.slippage_estimator_path.format(
            model_dir=config.model_dir)
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(self.model, path)

    def load(self, path: Optional[str] = None):
        """Load model."""
        path = path or config.slippage_estimator_path.format(
            model_dir=config.model_dir)
        self.model = joblib.load(path)