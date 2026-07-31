# Deployment Guide

## Prerequisites

- **Hardware**: 4+ CPU cores, 8GB+ RAM, 50GB+ SSD
- **Software**: Docker 24+, Docker Compose v2, Git
- **Network**: Low-latency connection to Solana RPC endpoints (< 50ms)
- **Wallet**: Funded Solana wallet (SOL for gas fees)

## Quick Deploy

```bash
# 1. Clone the repository
git clone https://github.com/your-org/solAribot.git
cd solAribot

# 2. Configure environment
cp .env.example .env.mainnet
# Edit .env.mainnet with your RPC endpoints and wallet key

# 3. Deploy
chmod +x scripts/deploy.sh
./scripts/deploy.sh mainnet
```

## Manual Deployment

### Using Docker Compose

```bash
# Build and start all services
docker compose --env-file .env.mainnet build
docker compose --env-file .env.mainnet up -d

# Check status
docker compose ps

# View logs
docker compose logs -f engine orchestrator dashboard
```

### Custom Configuration

Create environment-specific configs:

```bash
# config/mainnet.yaml — overrides default.yaml
network:
  rpc:
    url: "https://your-private-rpc.com"
    rate_limit: 200
```

## Production Checklist

- [ ] Use private RPC endpoints (Alchemy, Helius, or self-hosted)
- [ ] Set up monitoring and alerting (Discord webhook configured)
- [ ] Configure proper logging (json format, log rotation)
- [ ] Set up database backups (PostgreSQL WAL archiving)
- [ ] Enable firewall (only expose ports 3000 and 8081)
- [ ] Use environment-specific `.env` files (never commit secrets)
- [ ] Set up SSL/TLS for the dashboard
- [ ] Configure rate limiting on the API
- [ ] Set up automated health checks
- [ ] Create a dedicated system user for the bot

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SOLANA_RPC_URL` | Yes | Primary Solana RPC endpoint |
| `SOLANA_RPC_FALLBACKS` | No | Comma-separated fallback RPCs |
| `WALLET_PRIVATE_KEY` | Yes | Base58-encoded private key |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | Yes | Redis connection string |
| `MIN_PROFIT_THRESHOLD` | No | Min profit in SOL (default: 0.001) |
| `MAX_POSITION_SIZE` | No | Max position in SOL (default: 10.0) |
| `DAILY_LOSS_LIMIT` | No | Daily loss limit in SOL (default: 1.0) |
| `SLIPPAGE_BPS` | No | Max slippage in bps (default: 50) |
| `DISCORD_WEBHOOK_URL` | No | Discord alerting webhook |

## Database Setup

```bash
# Initialize the database schema
docker compose exec postgres psql -U solAribot -d solAribot -f /docker-entrypoint-initdb.d/init.sql
```

## Updating

```bash
# Pull latest changes
git pull

# Rebuild and restart
docker compose build --no-cache
docker compose up -d

# Or use the deploy script
./scripts/deploy.sh mainnet
```

## Rollback

```bash
# Stop services
docker compose down

# Revert to previous version
git checkout <previous-tag>

# Rebuild and deploy
./scripts/deploy.sh mainnet
```