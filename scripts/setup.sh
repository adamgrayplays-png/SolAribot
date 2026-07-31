#!/usr/bin/env bash
# =============================================================================
# SolAribot — First-Time Setup Script
# =============================================================================
# Usage: ./scripts/setup.sh [environment]
#   environment: mainnet | devnet | test (default: devnet)
#
# Installs dependencies, initializes DB schema, creates tables.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

ENV="${1:-devnet}"
ENV_FILE=".env.${ENV}"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC}  $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }

echo ""
echo "=============================================="
echo "  SolAribot — First-Time Setup"
echo "  Environment: ${ENV}"
echo "=============================================="
echo ""

# --- 1. Create environment file ---
if [ ! -f "$ENV_FILE" ]; then
    log_info "Creating $ENV_FILE from .env.example..."
    cp .env.example "$ENV_FILE"
    log_warn "Please edit $ENV_FILE with your RPC endpoints and wallet keys."
    log_warn "Then re-run this script."
fi

# --- 2. Install Rust toolchain ---
if ! command -v rustc &>/dev/null; then
    log_info "Installing Rust toolchain..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
    log_info "Rust installed: $(rustc --version)"
else
    log_info "Rust already installed: $(rustc --version)"
fi

# --- 3. Install Node.js dependencies ---
if [ -f "package.json" ]; then
    log_info "Installing Node.js dependencies..."
    npm install
    log_info "Node.js dependencies installed."
fi

# --- 4. Install Rust engine dependencies ---
if [ -f "engine/Cargo.toml" ]; then
    log_info "Building Rust engine (this may take a while)..."
    cd engine
    cargo build --release 2>/dev/null || cargo build
    cd ..
    log_info "Rust engine built."
fi

# --- 5. Create DB schema (PostgreSQL) ---
if [ -f "scripts/init-db.sql" ]; then
    log_info "Database initialization script found at scripts/init-db.sql"
    log_info "Run manually with: psql -U solAribot -d solAribot -f scripts/init-db.sql"
fi

# --- 6. Docker setup check ---
if command -v docker &>/dev/null; then
    log_info "Docker available: $(docker --version)"
    log_info "Docker Compose available: $(docker compose version)"
else
    log_warn "Docker not found. Install Docker for containerized deployment."
fi

# --- 7. Create data directories ---
mkdir -p data logs

echo ""
log_info "Setup complete!"
echo ""
echo "  Next steps:"
echo "    1. Edit $ENV_FILE with your configuration"
echo "    2. Run: docker compose --env-file $ENV_FILE up -d"
echo "    3. Or run locally: npm run dev"
echo "    4. Dashboard: http://localhost:3000"
echo ""