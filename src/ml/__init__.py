"""
SolAribot ML Decision Layer.

This module provides the AI-powered prediction, scoring, and filtering
layer for the Solana arbitrage bot. It includes:

- Feature pipeline for real-time feature extraction
- Execution success predictor (XGBoost)
- Slippage estimator (per-DEX models)
- Fake arbitrage detector (Random Forest)
- Opportunity scorer (combines all signals)
- Model server (FastAPI on port 5000)

All models are lightweight, trained on realistic synthetic Solana DeFi data,
and designed for <5ms inference latency.
"""

__version__ = "1.0.0"
