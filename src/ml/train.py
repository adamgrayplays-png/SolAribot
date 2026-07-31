#!/usr/bin/env python3
"""
Offline training script for all ML models.

Generates synthetic training data, trains all three models, evaluates them,
and saves them to the models directory.

Usage:
    python train.py              # Train with default 50K samples
    python train.py --samples 100000  # Train with 100K samples
"""

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
from sklearn.model_selection import train_test_split

# Ensure we can import from the ml package
sys.path.insert(0, str(Path(__file__).parent))

from config import config
from features import FeaturePipeline
from synth_data import SyntheticDataGenerator
from models.success_predictor import ExecutionSuccessPredictor
from models.slippage_estimator import SlippageEstimator
from models.fake_detector import FakeArbitrageDetector
from models.scorer import OpportunityScorer


def train_success_predictor(feature_pipeline: FeaturePipeline) -> dict:
    """Train the Execution Success Predictor."""
    print("\n" + "=" * 60)
    print("Training Execution Success Predictor (XGBoost)")
    print("=" * 60)

    gen = SyntheticDataGenerator()
    df = gen.generate_success_samples(config.n_synthetic_samples)

    # Extract features
    X_rows = []
    for _, row in df.iterrows():
        feat = feature_pipeline.extract_success_features(row.to_dict())
        X_rows.append(feat)

    X = np.array(X_rows)
    y = df["label"].values

    print(f"  Samples: {len(df)}")
    print(f"  Class balance: {y.mean():.3f} (fraction=success)")

    # Split
    X_train, X_val, y_train, y_val = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    # Train
    predictor = ExecutionSuccessPredictor()
    metrics = predictor.train(X_train, y_train, X_val, y_val)

    print(f"  Train accuracy: {metrics['train_accuracy']:.4f}")
    print(f"  Train AUC-ROC:  {metrics['train_auc_roc']:.4f}")
    print(f"  Val accuracy:   {metrics['val_accuracy']:.4f}")
    print(f"  Val AUC-ROC:    {metrics['val_auc_roc']:.4f}")

    # Feature importance
    importance = predictor.feature_importance()
    print("\n  Feature importance:")
    for name, imp in sorted(importance.items(), key=lambda x: -x[1]):
        print(f"    {name}: {imp:.4f}")

    # Save
    predictor.save()
    print(f"\n  Model saved to: {config.success_predictor_path.format(model_dir=config.model_dir)}")

    return {"metrics": metrics, "model": predictor}


def train_slippage_estimator(feature_pipeline: FeaturePipeline) -> dict:
    """Train the Slippage Estimator."""
    print("\n" + "=" * 60)
    print("Training Slippage Estimator (XGBoost Regressor)")
    print("=" * 60)

    gen = SyntheticDataGenerator()
    df = gen.generate_slippage_samples(config.n_synthetic_samples)

    # Extract features
    X_rows = []
    for _, row in df.iterrows():
        feat = feature_pipeline.extract_slippage_features(row.to_dict())
        X_rows.append(feat)

    X = np.array(X_rows)
    y = df["label_slippage"].values

    print(f"  Samples: {len(df)}")
    print(f"  Mean slippage: {y.mean():.4f} ({y.mean()*100:.2f}%)")
    print(f"  Slippage range: [{y.min():.6f}, {y.max():.6f}]")

    X_train, X_val, y_train, y_val = train_test_split(
        X, y, test_size=0.2, random_state=42
    )

    estimator = SlippageEstimator()
    metrics = estimator.train(X_train, y_train, X_val, y_val)

    print(f"  Train MAE:  {metrics['train_mae']:.6f} ({metrics['train_mae']*100:.4f}%)")
    print(f"  Train RMSE: {metrics['train_rmse']:.6f}")
    print(f"  Train R²:   {metrics['train_r2']:.4f}")
    print(f"  Val MAE:    {metrics['val_mae']:.6f} ({metrics['val_mae']*100:.4f}%)")
    print(f"  Val R²:     {metrics['val_r2']:.4f}")

    estimator.save()
    print(f"\n  Model saved to: {config.slippage_estimator_path.format(model_dir=config.model_dir)}")

    return {"metrics": metrics, "model": estimator}


def train_fake_detector(feature_pipeline: FeaturePipeline) -> dict:
    """Train the Fake Arbitrage Detector."""
    print("\n" + "=" * 60)
    print("Training Fake Arbitrage Detector (Random Forest)")
    print("=" * 60)

    gen = SyntheticDataGenerator()
    df = gen.generate_fake_samples(config.n_synthetic_samples)

    X_rows = []
    for _, row in df.iterrows():
        feat = feature_pipeline.extract_fake_detector_features(row.to_dict())
        X_rows.append(feat)

    X = np.array(X_rows)
    y = df["label"].values

    print(f"  Samples: {len(df)}")
    print(f"  Class balance: {y.mean():.3f} (fraction=fake)")

    X_train, X_val, y_train, y_val = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    detector = FakeArbitrageDetector()
    metrics = detector.train(X_train, y_train, X_val, y_val)

    print(f"  Train accuracy:   {metrics['train_accuracy']:.4f}")
    print(f"  Train precision:  {metrics['train_precision']:.4f}")
    print(f"  Train recall:     {metrics['train_recall']:.4f}")
    print(f"  Train F1:         {metrics['train_f1']:.4f}")
    print(f"  Train AUC-ROC:    {metrics['train_auc_roc']:.4f}")
    print(f"  Val accuracy:     {metrics['val_accuracy']:.4f}")
    print(f"  Val precision:    {metrics['val_precision']:.4f}")
    print(f"  Val recall:       {metrics['val_recall']:.4f}")
    print(f"  Val F1:           {metrics['val_f1']:.4f}")
    print(f"  Val AUC-ROC:      {metrics['val_auc_roc']:.4f}")

    importance = detector.feature_importance()
    print("\n  Feature importance:")
    for name, imp in sorted(importance.items(), key=lambda x: -x[1]):
        print(f"    {name}: {imp:.4f}")

    detector.save()
    print(f"\n  Model saved to: {config.fake_detector_path.format(model_dir=config.model_dir)}")

    return {"metrics": metrics, "model": detector}


def compute_scoring_benchmark(scorer: OpportunityScorer):
    """Run a quick benchmark of the scoring function."""
    print("\n" + "=" * 60)
    print("Opportunity Scorer — Sample Scores")
    print("=" * 60)

    test_cases = [
        # (profit, success_prob, slippage, fake_prob, congestion, volatility)
        ("Strong opportunity", 50.0, 0.85, 0.003, 0.05, 10_000, 0.002),
        ("Marginal", 15.0, 0.60, 0.01, 0.20, 50_000, 0.01),
        ("High fake prob", 80.0, 0.90, 0.002, 0.90, 20_000, 0.005),
        ("High slippage", 100.0, 0.70, 0.08, 0.10, 15_000, 0.03),
        ("Congested market", 30.0, 0.65, 0.005, 0.15, 250_000, 0.015),
        ("Low quality", 5.0, 0.40, 0.02, 0.30, 80_000, 0.008),
    ]

    for label, profit, sp, slip, fake, cong, vol in test_cases:
        result = scorer.compute(profit, sp, slip, fake, cong, vol)
        status = "✅ ACTION" if result["actionable"] else "⏭️  SKIP"
        print(f"\n  {status} | {label}")
        print(f"    Score: {result['score']:.1f} / thresh={result['threshold']:.1f}")
        print(f"    Components: P(success)={sp:.2f}, slip_pen={result['slippage_penalty']:.3f}, fake={fake:.2f}")


def main():
    parser = argparse.ArgumentParser(description="Train SolAribot ML models")
    parser.add_argument("--samples", type=int, default=config.n_synthetic_samples,
                        help=f"Number of synthetic samples (default: {config.n_synthetic_samples})")
    parser.add_argument("--seed", type=int, default=config.synthetic_seed,
                        help="Random seed")
    args = parser.parse_args()

    config.n_synthetic_samples = args.samples
    config.synthetic_seed = args.seed
    np.random.seed(args.seed)

    # Ensure model directory exists
    Path(config.model_dir).mkdir(parents=True, exist_ok=True)

    print(f"SolAribot ML Training Pipeline")
    print(f"  Samples per model: {config.n_synthetic_samples}")
    print(f"  Seed: {config.synthetic_seed}")
    print(f"  Model dir: {config.model_dir}")

    # Feature pipeline (scaler fitted on combined data)
    feature_pipeline = FeaturePipeline()

    start = time.time()

    # Train all models
    success_result = train_success_predictor(feature_pipeline)
    slippage_result = train_slippage_estimator(feature_pipeline)
    fake_result = train_fake_detector(feature_pipeline)

    # Test scorer
    scorer = OpportunityScorer()
    compute_scoring_benchmark(scorer)

    elapsed = time.time() - start
    print(f"\n{'=' * 60}")
    print(f"✅ Training complete in {elapsed:.1f}s")
    print(f"{'=' * 60}")

    # Save metrics summary
    summary = {
        "training_samples": config.n_synthetic_samples,
        "seed": config.synthetic_seed,
        "elapsed_seconds": round(elapsed, 1),
        "success_predictor": success_result["metrics"],
        "slippage_estimator": slippage_result["metrics"],
        "fake_detector": fake_result["metrics"],
    }
    summary_path = Path(config.model_dir) / "training_summary.json"
    with open(summary_path, "w") as f:
        json.dump(summary, f, indent=2)
    print(f"  Summary saved to: {summary_path}")


if __name__ == "__main__":
    main()
