"""
ML module configuration.

Centralised config for model paths, hyperparameters, feature names,
and scoring thresholds. Loaded at server startup and used by all models.
"""

from dataclasses import dataclass, field
from typing import Dict, List


@dataclass
class MLConfig:
    # ── Model paths ──────────────────────────────────────────────
    model_dir: str = "/home/team/shared/solAribot/src/ml/models"
    success_predictor_path: str = "{model_dir}/success_predictor.pkl"
    success_predictor_onnx: str = "{model_dir}/success_predictor.onnx"
    slippage_estimator_path: str = "{model_dir}/slippage_estimator.pkl"
    fake_detector_path: str = "{model_dir}/fake_detector.pkl"
    fake_detector_onnx: str = "{model_dir}/fake_detector.onnx"
    scaler_path: str = "{model_dir}/feature_scaler.pkl"

    # ── Scoring thresholds ───────────────────────────────────────
    min_actionable_score: float = 45.0       # Minimum score to execute
    fake_prob_threshold: float = 0.85        # Skip if fake probability above this
    min_success_prob: float = 0.55           # Minimum P(success) to consider
    max_slippage_penalty: float = 0.40       # Cap slippage penalty

    # ── Feature names (order matters for model input) ─────────────
    success_feature_names: List[str] = field(default_factory=lambda: [
        "congestion_level",          # Recent avg priority fee (microLamports)
        "pool_liquidity_token_a",    # Token A pool depth (USD)
        "pool_liquidity_token_b",    # Token B pool depth (USD)
        "trade_size_relative",       # Trade size / pool TVL
        "route_hist_success_rate",   # Historical success rate for this route
        "hour_sin",                  # Time-of-day cyclical (sin)
        "hour_cos",                  # Time-of-day cyclical (cos)
    ])

    slippage_feature_names: List[str] = field(default_factory=lambda: [
        "pool_depth_usd",            # Total pool liquidity (USD)
        "trade_size_usd",            # Trade size (USD)
        "order_book_imbalance",      # Buy/sell imbalance ratio
        "volatility_1min",           # 1-min price volatility
        "trade_size_relative",       # Trade / depth ratio
        "dex_type_encoded",          # DEX type one-hot encoded
    ])

    fake_detector_feature_names: List[str] = field(default_factory=lambda: [
        "price_deviation_from_oracle",  # % diff from oracle price
        "order_book_spread",            # Bid-ask spread (bps)
        "min_liquidity_path_depth",     # Thinnest leg in route (USD)
        "recent_pool_manip_events",     # Count of large swaps in last 10s
        "profit_to_liquidity_ratio",    # Expected profit / min liquidity
        "route_depth_imbalance",        # Max-min depth ratio across route
    ])

    # ── DEX types ─────────────────────────────────────────────────
    dex_types: List[str] = field(default_factory=lambda: [
        "jupiter", "raydium", "orca", "meteora",
        "lifinity", "openbook", "phoenix",
    ])

    # ── Synthetic data parameters ─────────────────────────────────
    n_synthetic_samples: int = 50_000
    synthetic_seed: int = 42

    # ── Model hyperparams ─────────────────────────────────────────
    xgboost_params: dict = field(default_factory=lambda: {
        "n_estimators": 50,
        "max_depth": 4,
        "learning_rate": 0.15,
        "subsample": 0.8,
        "colsample_bytree": 0.8,
        "min_child_weight": 3,
        "gamma": 0.1,
        "reg_alpha": 0.1,
        "reg_lambda": 1.0,
        "scale_pos_weight": 1.0,
        "eval_metric": "logloss",
        "random_state": 42,
    })

    rf_params: dict = field(default_factory=lambda: {
        "n_estimators": 20,
        "max_depth": 4,
        "min_samples_split": 50,
        "min_samples_leaf": 20,
        "max_features": "sqrt",
        "class_weight": "balanced",
        "random_state": 42,
        "n_jobs": -1,
    })

    # ── Server ────────────────────────────────────────────────────
    server_host: str = "0.0.0.0"
    server_port: int = 5000


# Singleton
config = MLConfig()
