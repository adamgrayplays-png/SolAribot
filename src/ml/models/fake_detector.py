"""
Fake Arbitrage Detector.

Binary classifier (Random Forest) that flags opportunities which look
profitable on paper but are actually fake/unexecutable due to:
- Stale/or manipulated price quotes
- Sandwichable routes
- Extremely thin liquidity paths
- Oracle price deviations

If probability(fake) > threshold → skip opportunity.
"""

from pathlib import Path
from typing import Optional

import joblib
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (accuracy_score, classification_report,
                             f1_score, precision_score, recall_score,
                             roc_auc_score)
import xgboost as xgb

from config import config


class FakeArbitrageDetector:
    """
    Binary classifier detecting fake/unexecutable arbitrage opportunities.

    Uses XGBoost for fast inference (<0.5ms).

    Features:
    - price_deviation_from_oracle (% diff from reference oracle price)
    - order_book_spread (bid-ask spread in bps)
    - min_liquidity_path_depth (thinnest leg in route, USD)
    - recent_pool_manip_events (count of large swaps in last 10s)
    - profit_to_liquidity_ratio (expected profit / min liquidity)
    - route_depth_imbalance (max/min depth ratio across route)
    """

    def __init__(self):
        self.model: Optional[RandomForestClassifier] = None

    def train(self, X: np.ndarray, y: np.ndarray,
              X_val: Optional[np.ndarray] = None,
              y_val: Optional[np.ndarray] = None) -> dict:
        """
        Train the Random Forest classifier.

        Args:
            X: Training features (n_samples, n_features)
            y: Training labels (0 = genuine, 1 = fake)
            X_val: Validation features
            y_val: Validation labels

        Returns:
            dict of training metrics
        """
        self.model = xgb.XGBClassifier(
            n_estimators=30,
            max_depth=4,
            learning_rate=0.15,
            subsample=0.8,
            colsample_bytree=0.8,
            min_child_weight=3,
            reg_alpha=0.1,
            reg_lambda=1.0,
            eval_metric="logloss",
            random_state=42,
        )
        self.model.fit(X, y)

        train_preds = self.model.predict(X)
        train_probs = self.model.predict_proba(X)[:, 1]

        metrics = {
            "train_accuracy": float(accuracy_score(y, train_preds)),
            "train_precision": float(precision_score(y, train_preds, zero_division=0)),
            "train_recall": float(recall_score(y, train_preds, zero_division=0)),
            "train_f1": float(f1_score(y, train_preds, zero_division=0)),
            "train_auc_roc": float(roc_auc_score(y, train_probs)),
        }

        if X_val is not None and y_val is not None:
            val_preds = self.model.predict(X_val)
            val_probs = self.model.predict_proba(X_val)[:, 1]
            metrics.update({
                "val_accuracy": float(accuracy_score(y_val, val_preds)),
                "val_precision": float(precision_score(y_val, val_preds, zero_division=0)),
                "val_recall": float(recall_score(y_val, val_preds, zero_division=0)),
                "val_f1": float(f1_score(y_val, val_preds, zero_division=0)),
                "val_auc_roc": float(roc_auc_score(y_val, val_probs)),
                "val_report": classification_report(y_val, val_preds,
                                                     output_dict=True,
                                                     zero_division=0),
            })

        return metrics

    def predict(self, X: np.ndarray) -> tuple:
        """
        Predict fake probability.

        Args:
            X: Feature matrix

        Returns:
            (fake_probabilities, binary_predictions)
        """
        if self.model is None:
            raise RuntimeError("Model not trained or loaded")

        probs = self.model.predict_proba(X)[:, 1]
        preds = (probs >= 0.5).astype(int)
        return probs, preds

    def predict_single(self, features: np.ndarray) -> float:
        """
        Predict fake probability for a single opportunity (fast path).

        Args:
            features: 1D feature array

        Returns:
            Probability that opportunity is fake (0.0 - 1.0)
        """
        return float(self.predict(features.reshape(1, -1))[0][0])

    def is_fake(self, features: np.ndarray) -> tuple:
        """
        High-level check: is this opportunity likely fake?

        Returns:
            (is_fake: bool, probability: float)
        """
        prob = self.predict_single(features)
        return prob >= config.fake_prob_threshold, prob

    def feature_importance(self) -> dict:
        """Return feature importance scores."""
        if self.model is None:
            return {}
        return dict(zip(
            config.fake_detector_feature_names,
            [float(v) for v in self.model.feature_importances_]
        ))

    def save(self, path: Optional[str] = None):
        """Save model."""
        path = path or config.fake_detector_path.format(
            model_dir=config.model_dir)
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(self.model, path)

    def load(self, path: Optional[str] = None):
        """Load model."""
        path = path or config.fake_detector_path.format(
            model_dir=config.model_dir)
        self.model = joblib.load(path)