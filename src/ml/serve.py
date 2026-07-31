#!/usr/bin/env python3
"""
Model Server — FastAPI HTTP endpoint for ML inference.

Provides a REST API for the TS orchestrator to score arbitrage opportunities.

Endpoints:
    POST /score          — Score a single opportunity
    POST /score/batch    — Score multiple opportunities
    GET  /health         — Health check
    GET  /models/info    — Model metadata & feature importance

Designed for <5ms inference on a single opportunity.
Port: 5000
"""

import json
import sys
import time
from pathlib import Path
from typing import List, Optional

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

# Ensure we can import from the ml package
sys.path.insert(0, str(Path(__file__).parent))

from config import config
from features import FeaturePipeline
from models.success_predictor import ExecutionSuccessPredictor
from models.slippage_estimator import SlippageEstimator
from models.fake_detector import FakeArbitrageDetector
from models.scorer import OpportunityScorer

# ── Pydantic schemas ─────────────────────────────────────────────

class OpportunityData(BaseModel):
    """Raw opportunity data from the orchestrator/engine."""
    expected_profit_usd: float = Field(..., description="Expected arbitrage profit in USD")
    congestion_level: float = Field(1_000, description="Recent avg priority fee (microLamports)")
    pool_liquidity_token_a: float = Field(100_000, description="Token A pool depth (USD)")
    pool_liquidity_token_b: float = Field(100_000, description="Token B pool depth (USD)")
    trade_size_usd: float = Field(1_000, description="Trade size in USD")
    route_hist_success_rate: float = Field(0.5, description="Historical success rate for this route")
    pool_depth_usd: float = Field(100_000, description="Total pool liquidity (USD)")
    order_book_imbalance: float = Field(1.0, description="Buy/sell volume ratio")
    volatility_1min: float = Field(0.001, description="1-min price volatility (fractional)")
    dex_type: str = Field("jupiter", description="DEX type (jupiter, raydium, orca, etc.)")
    price_deviation_from_oracle: float = Field(0.0, description="% diff from oracle price")
    order_book_spread: float = Field(0.001, description="Bid-ask spread (fractional)")
    min_liquidity_path_depth: float = Field(10_000, description="Thinnest leg in route (USD)")
    recent_pool_manip_events: int = Field(0, description="Large swaps in last 10s")
    hour: int = Field(12, description="Hour of day (UTC, 0-23)")


class ScoreResponse(BaseModel):
    """Response from the /score endpoint."""
    score: float = Field(..., description="Normalised opportunity score (0-100)")
    success_probability: float = Field(..., description="Estimated P(success)")
    slippage_estimate: float = Field(..., description="Estimated slippage fraction")
    fake_probability: float = Field(..., description="Estimated P(opportunity is fake)")
    actionable: bool = Field(..., description="Whether this opportunity should be executed")
    inference_time_ms: float = Field(..., description="Inference time in milliseconds")
    details: Optional[dict] = Field(None, description="Full scoring details")


class BatchScoreRequest(BaseModel):
    opportunities: List[OpportunityData]


class BatchScoreResponse(BaseModel):
    scores: List[ScoreResponse]
    total_inference_time_ms: float


class HealthResponse(BaseModel):
    status: str = "ok"
    models_loaded: bool = False
    uptime_seconds: float = 0.0


class ModelInfoResponse(BaseModel):
    success_predictor: dict
    fake_detector: dict
    config: dict


# ── App setup ────────────────────────────────────────────────────

app = FastAPI(
    title="SolAribot ML Decision Layer",
    description="ML-powered scoring API for Solana arbitrage opportunities",
    version="1.0.0",
)

# Global state
_start_time = time.time()
_feature_pipeline: Optional[FeaturePipeline] = None
_success_predictor: Optional[ExecutionSuccessPredictor] = None
_slippage_estimator: Optional[SlippageEstimator] = None
_fake_detector: Optional[FakeArbitrageDetector] = None
_scorer: Optional[OpportunityScorer] = None


# ── Lifecycle ────────────────────────────────────────────────────

@app.on_event("startup")
async def load_models():
    """Load all trained models at startup."""
    global _feature_pipeline, _success_predictor, _slippage_estimator
    global _fake_detector, _scorer

    try:
        _success_predictor = ExecutionSuccessPredictor()
        _success_predictor.load()

        _slippage_estimator = SlippageEstimator()
        _slippage_estimator.load()

        _fake_detector = FakeArbitrageDetector()
        _fake_detector.load()

        _scorer = OpportunityScorer()
        _feature_pipeline = FeaturePipeline()

        print(f"[ML Server] All 3 models loaded successfully from {config.model_dir}")
    except FileNotFoundError as e:
        print(f"[ML Server] WARNING: Model file not found: {e}")
        print("[ML Server] Run `python train.py` first to train models.")
        print("[ML Server] Server will return 503 until models are trained.")
    except Exception as e:
        print(f"[ML Server] ERROR loading models: {e}")


# ── Helper ───────────────────────────────────────────────────────

def _check_models():
    """Verify all models are loaded."""
    if any(m is None for m in [_success_predictor, _slippage_estimator,
                                 _fake_detector, _scorer, _feature_pipeline]):
        raise HTTPException(
            status_code=503,
            detail="Models not loaded. Run `python train.py` first."
        )


def _score_single(opp: OpportunityData) -> ScoreResponse:
    """Score a single opportunity."""
    opp_dict = opp.model_dump()
    start = time.perf_counter()

    # 1. Extract features
    success_features = _feature_pipeline.extract_success_features(opp_dict)
    slippage_features = _feature_pipeline.extract_slippage_features(opp_dict)
    fake_features = _feature_pipeline.extract_fake_detector_features(opp_dict)

    # 2. Run predictions
    success_prob = _success_predictor.predict_single(success_features)
    slippage_est = _slippage_estimator.predict_single(slippage_features)
    fake_prob = _fake_detector.predict_single(fake_features)

    # 3. Compute score
    result = _scorer.compute(
        expected_profit_usd=opp.expected_profit_usd,
        success_prob=success_prob,
        slippage_estimate=slippage_est,
        fake_prob=fake_prob,
        congestion_level=opp.congestion_level,
        volatility_1min=opp.volatility_1min,
    )

    elapsed = (time.perf_counter() - start) * 1000  # ms

    # Convert numpy types to native Python for serialization
    clean_result = {
        k: bool(v) if isinstance(v, (np.bool_, bool)) else
           float(v) if isinstance(v, (np.floating, float)) else
           int(v) if isinstance(v, (np.integer, int)) else v
        for k, v in result.items()
    }

    return ScoreResponse(
        score=clean_result["score"],
        success_probability=clean_result["success_probability"],
        slippage_estimate=clean_result["slippage_estimate"],
        fake_probability=clean_result["fake_probability"],
        actionable=clean_result["actionable"],
        inference_time_ms=round(elapsed, 3),
        details=clean_result,
    )


# ── Endpoints ────────────────────────────────────────────────────

@app.get("/health", response_model=HealthResponse)
async def health():
    """Health check endpoint."""
    models_loaded = all(m is not None for m in [
        _success_predictor, _slippage_estimator,
        _fake_detector, _scorer, _feature_pipeline
    ])
    return HealthResponse(
        status="ok" if models_loaded else "degraded",
        models_loaded=models_loaded,
        uptime_seconds=round(time.time() - _start_time, 1),
    )


@app.post("/score", response_model=ScoreResponse)
async def score_opportunity(opportunity: OpportunityData):
    """Score a single arbitrage opportunity."""
    _check_models()
    return _score_single(opportunity)


@app.post("/score/batch", response_model=BatchScoreResponse)
async def score_batch(request: BatchScoreRequest):
    """Score multiple opportunities in batch."""
    _check_models()
    start = time.perf_counter()

    scores = [_score_single(opp) for opp in request.opportunities]

    total_elapsed = (time.perf_counter() - start) * 1000

    return BatchScoreResponse(
        scores=scores,
        total_inference_time_ms=round(total_elapsed, 2),
    )


@app.get("/models/info", response_model=ModelInfoResponse)
async def model_info():
    """Return model metadata and feature importance."""
    _check_models()

    return ModelInfoResponse(
        success_predictor={
            "type": "XGBoost Binary Classifier",
            "features": config.success_feature_names,
            "importance": _success_predictor.feature_importance(),
        },
        fake_detector={
            "type": "Random Forest Binary Classifier",
            "features": config.fake_detector_feature_names,
            "importance": _fake_detector.feature_importance(),
        },
        config={
            "min_actionable_score": config.min_actionable_score,
            "fake_prob_threshold": config.fake_prob_threshold,
            "min_success_prob": config.min_success_prob,
            "max_slippage_penalty": config.max_slippage_penalty,
        },
    )


# ── Main ─────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    print(f"Starting SolAribot ML Server on {config.server_host}:{config.server_port}")
    uvicorn.run(
        "serve:app",
        host=config.server_host,
        port=config.server_port,
        log_level="info",
    )
