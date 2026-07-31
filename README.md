# SolAribot

**AI-powered Solana Arbitrage Trading Bot**

SolAribot is a production-grade, high-frequency arbitrage bot that continuously monitors 7+ Solana DEXs, detects cross-exchange price discrepancies, and executes atomic multi-hop trades with sub-100ms latency. Powered by machine learning for execution prediction and dynamic threshold adjustment.

## Features

- **Multi-DEX Monitoring**: Jupiter, Raydium, Orca, Meteora, Lifinity, OpenBook, Phoenix
- **Atomic Arbitrage**: Triangular, multi-hop, and circular route detection
- **ML-Powered Execution**: Predicts trade success probability and filters fake arbitrage
- **Sub-100ms Latency**: Optimized Rust engine with WebSocket streaming
- **Real-Time Dashboard**: React-based UI with live opportunity feed, P&L tracking, and system health
- **Risk Management**: Configurable position sizing, daily loss limits, slippage protection
- **Multi-Wallet Support**: Manage multiple trading wallets with isolated risk profiles
- **Enterprise Ready**: Docker deployment, RPC failover, monitoring, and alerting

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  Dashboard  │────▶│ Orchestrator │◀───▶│    Engine   │
│ (React/TS)  │     │  (TS/Node)   │     │  (Rust)     │
└─────────────┘     └──────┬───────┘     └──────┬──────┘
                           │                     │
                    ┌──────▼───────┐     ┌──────▼──────┐
                    │    Redis     │     │  PostgreSQL  │
                    │  (Cache/Pub) │     │   (Store)    │
                    └──────────────┘     └─────────────┘
```

## Quick Start

### Prerequisites

- Docker & Docker Compose
- Solana CLI wallet with funds
- RPC endpoint (Alchemy, Helius, or public)

### Setup

```bash
# 1. Clone and setup
git clone https://github.com/your-org/solAribot.git
cd solAribot
cp .env.example .env

# 2. Edit .env with your RPC endpoints and wallet
# 3. Run setup script
chmod +x scripts/setup.sh
./scripts/setup.sh

# 4. Deploy with Docker
docker compose --env-file .env up -d
```

### Development

```bash
# Install dependencies
npm install
cd engine && cargo build && cd ..

# Run in dev mode
npm run dev
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — System design and component interactions
- [Deployment](docs/DEPLOYMENT.md) — Production deployment guide
- [Security](docs/SECURITY.md) — Security best practices
- [Performance](docs/PERFORMANCE.md) — Optimization guide

## Configuration

See [config/default.yaml](config/default.yaml) for all configuration options.
Override with environment-specific configs:

```bash
# Mainnet
docker compose --env-file .env.mainnet -f docker-compose.yml up -d

# Devnet
docker compose --env-file .env.devnet -f docker-compose.yml up -d
```

## Monitoring

- Dashboard: http://localhost:3000
- Engine Health: http://localhost:8080/health
- Orchestrator API: http://localhost:8081/api

## License

MIT