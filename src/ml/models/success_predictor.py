"""
Execution Success Predictor.

Lightweight XGBoost binary classifier that predicts whether a detected
arbitrage opportunity will execute successfully (vs. revert/fail).

Features:
- congestion_level (recent avg priority fee)
- pool_liquidity_token_a & b (log-scaled)
- trade_size_relative (trade size / pool TVL)
- route_hist_success_rate
- hour_sin, hour_cos (cyclical time encoding)

Export formats: pickle (for Python serving), ONNX (for cross-language).
"""

from pathlib import Path
from typing import Optional

import joblib
import numpy as np
import xgboost as xgb
from sklearn.metrics import (accuracy_score, classification_report,
                             confusion_matrix, roc_auc_score)

from config import config


class ExecutionSuccessPredictor:
    """Binary classifier for trade execution success."""

    def __init__(self):
        self.model: Optional[xgb.XGBClassifier] = None

    def train(self, X: np.ndarray, y: np.ndarray,
              X_val: Optional[np.ndarray] = None,
              y_val: Optional[np.ndarray] = None) -> dict:
        """
        Train the XGBoost model.

        Args:
            X: Training feature matrix (n_samples, n_features)
            y: Training labels (0 = fail, 1 = success)
            X_val: Validation feature matrix
            y_val: Validation labels

        Returns:
            dict of training metrics
        """
        self.model = xgb.XGBClassifier(**config.xgboost_params)

        eval_set = [(X, y)]
        eval_suffix = ["train"]
        if X_val is not None and y_val is not None:
            eval_set.append((X_val, y_val))
            eval_suffix.append("val")

        self.model.fit(
            X, y,
            eval_set=eval_set,
            verbose=False,
        )

        # Metrics
        train_preds = self.model.predict(X)
        train_probs = self.model.predict_proba(X)[:, 1]
        metrics = {
            "train_accuracy": float(accuracy_score(y, train_preds)),
            "train_auc_roc": float(roc_auc_score(y, train_probs)),
        }

        if X_val is not None:
            val_preds = self.model.predict(X_val)
            val_probs = self.model.predict_proba(X_val)[:, 1]
            metrics.update({
                "val_accuracy": float(accuracy_score(y_val, val_preds)),
                "val_auc_roc": float(roc_auc_score(y_val, val_probs)),
                "val_report": classification_report(y_val, val_preds,
                                                     output_dict=True,
                                                     zero_division=0),
            })

        return metrics

    def predict(self, X: np.ndarray) -> tuple:
        """
        Predict success probability.

        Args:
            X: Feature matrix (n_samples, n_features)

        Returns:
            (probabilities, binary_predictions)
        """
        if self.model is None:
            raise RuntimeError("Model not trained or loaded")

        probs = self.model.predict_proba(X)[:, 1]
        preds = (probs >= 0.5).astype(int)
        return probs, preds

    def predict_single(self, features: np.ndarray) -> float:
        """
        Predict success probability for a single sample (fast path).

        Args:
            features: 1D feature array of shape (n_features,)

        Returns:
            Probability of success (0.0 - 1.0)
        """
        return float(self.predict(features.reshape(1, -1))[0][0])

    def feature_importance(self) -> dict:
        """Return feature importance scores."""
        if self.model is None:
            return {}
        importance = self.model.feature_importances_
        return dict(zip(config.success_feature_names,
                        [float(v) for v in importance]))

    def save(self, path: Optional[str] = None):
        """Save model as pickle."""
        path = path or config.success_predictor_path.format(
            model_dir=config.model_dir)
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(self.model, path)

    def load(self, path: Optional[str] = None):
        """Load model from pickle."""
        path = path or config.success_predictor_path.format(
            model_dir=config.model_dir)
        self.model = joblib.load(path)