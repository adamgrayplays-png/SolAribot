# Architecture

## Overview

SolAribot follows a modular, microservices-based architecture with three core components communicating via Redis pub/sub and a REST/WebSocket API.

```
                     ┌─────────────────────────────────────┐
                     │         External World              │
                     │  Solana RPCs, DEX Programs, Users   │
                     └──────────┬──────────────┬───────────┘
                                │              │
                ┌───────────────▼──────────────▼───────────┐
                │           Orchestrator (TS)              │
                │  • Price monitoring & aggregation        │
                │  • Arbitrage opportunity detection       │
                │  • Route optimization                    │
                │  • Risk management                       │
                │  • REST/WS API for dashboard             │
                └──────┬───────────────────┬───────────────┘
                       │                   │
              ┌────────▼────────┐  ┌───────▼────────┐
              │  Engine (Rust)  │  │  Dashboard     │
              │  • DEX parsing  │  │  (React/TS)    │
              │  • TX execution │  │  • Real-time UI │
              │  • Compute budget│  │  • Charts      │
              │  • Priority fees│  │  • Config mgmt │
              └────────┬────────┘  └───────▲────────┘
                       │                   │
              ┌────────▼───────────────────┴────────┐
              │         Data Layer                   │
              │  ┌──────────┐  ┌──────────────┐     │
              │  │  Redis   │  │  PostgreSQL  │     │
              │  │ • Cache  │  │ • Trades     │     │
              │  │ • Pub/Sub│  │ • P&L        │     │
              │  │ • Queue  │  │ • Config     │     │
              │  └──────────┘  └──────────────┘     │
              └─────────────────────────────────────┘
```

## Component Details

### 1. Rust Engine (`engine/`)

The core execution engine, written in Rust for maximum performance.

**Responsibilities:**
- Connect to Solana RPC via WebSocket for real-time account updates
- Parse DEX pool states (Jupiter, Raydium, Orca, Meteora, Lifinity, OpenBook, Phoenix)
- Execute atomic transactions with Versioned Transactions and Address Lookup Tables
- Manage Compute Budget and priority fees
- Handle transaction retry and confirmation

**Key technologies:**
- `solana-sdk`, `solana-client`, `solana-program`
- `tokio` for async runtime
- `tracing` for structured logging

### 2. TypeScript Orchestrator (`orchestrator/`)

The central coordination layer, written in TypeScript.

**Responsibilities:**
- Aggregate price data from all DEXs
- Detect arbitrage opportunities (triangular, multi-hop, circular)
- Optimize trade routes for maximum profit
- Manage risk (position sizing, daily loss limits, slippage)
- Serve REST and WebSocket API for the dashboard
- Coordinate with ML model for execution prediction

**Key technologies:**
- `@solana/web3.js` for Solana interaction
- `ws` for WebSocket communication
- `express` or `fastify` for API server
- `redis` for caching and pub/sub

### 3. Dashboard (`dashboard/`)

React-based real-time trading dashboard.

**Responsibilities:**
- Display current balance and portfolio
- Show live arbitrage opportunity feed
- Track P&L and performance metrics
- Monitor DEX latency and system health
- Provide configuration controls

**Key technologies:**
- React + TypeScript
- Vite for build tooling
- Tailwind CSS for styling
- Recharts for charting
- WebSocket for real-time updates

## Data Flow

1. **Price Collection**: Engine polls DEX pools → publishes price updates to Redis
2. **Opportunity Detection**: Orchestrator reads prices from Redis → detects arbitrage → scores opportunities
3. **ML Prediction**: Orchestrator queries ML model → filters low-confidence opportunities
4. **Execution**: Orchestrator sends trade command to Engine → Engine executes atomic transaction
5. **Dashboard**: Orchestrator pushes updates via WebSocket → Dashboard renders in real-time

## Communication Patterns

| Pattern | Technology | Usage |
|---------|-----------|-------|
| Pub/Sub | Redis | Price updates, trade events |
| RPC | HTTP/gRPC | Engine ↔ Orchestrator commands |
| WebSocket | ws | Dashboard real-time updates |
| REST | HTTP | Dashboard CRUD operations |