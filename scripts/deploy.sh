#!/usr/bin/env bash
# =============================================================================
# SolAribot — Production Deployment Script
# =============================================================================
# Usage: ./scripts/deploy.sh [environment]
#   environment: mainnet | devnet | test (default: mainnet)
#
# This script handles building, pushing, and deploying SolAribot
# to a production server using Docker Compose.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# --- Configuration ---
ENV="${1:-mainnet}"
COMPOSE_FILE="docker-compose.yml"
ENV_FILE=".env.${ENV}"
CONFIG_FILE="config/${ENV}.yaml"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info()  { echo -e "${GREEN}[INFO]${NC}  $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# --- Pre-flight checks ---
preflight() {
    log_info "Running pre-flight checks..."

    # Check Docker
    if ! command -v docker &>/dev/null; then
        log_error "Docker is not installed. Install it first."
        exit 1
    fi

    # Check Docker Compose
    if ! docker compose version &>/dev/null; then
        log_error "Docker Compose is not installed."
        exit 1
    fi

    # Check env file
    if [ ! -f "$ENV_FILE" ]; then
        log_warn "Environment file $ENV_FILE not found."
        log_warn "Creating from .env.example..."
        cp .env.example "$ENV_FILE"
        log_error "Please edit $ENV_FILE with your configuration and re-run."
        exit 1
    fi

    # Check config file
    if [ ! -f "$CONFIG_FILE" ]; then
        log_warn "Config file $CONFIG_FILE not found. Using default.yaml."
        CONFIG_FILE="config/default.yaml"
    fi

    log_info "Pre-flight checks passed."
}

# --- Build images ---
build() {
    log_info "Building Docker images for environment: ${ENV}..."

    docker compose \
        --env-file "$ENV_FILE" \
        -f "$COMPOSE_FILE" \
        build \
        --parallel

    log_info "Build complete."
}

# --- Deploy services ---
deploy() {
    log_info "Deploying services..."

    docker compose \
        --env-file "$ENV_FILE" \
        -f "$COMPOSE_FILE" \
        up -d \
        --remove-orphans

    log_info "Deployment complete. Checking status..."
    docker compose ps
}

# --- Health check ---
health_check() {
    log_info "Running health check..."
    sleep 5

    # Check if services are running
    local services=("engine" "orchestrator" "dashboard" "redis" "postgres")
    for svc in "${services[@]}"; do
        if docker compose ps "$svc" | grep -q "Up"; then
            log_info "  ✓ $svc is running"
        else
            log_warn "  ✗ $svc is NOT running"
        fi
    done
}

# --- Rollback ---
rollback() {
    log_warn "Rolling back to previous deployment..."
    docker compose \
        --env-file "$ENV_FILE" \
        -f "$COMPOSE_FILE" \
        down
    log_info "Rollback complete."
}

# --- Main ---
main() {
    echo ""
    echo "=============================================="
    echo "  SolAribot Deployment Script"
    echo "  Environment: ${ENV}"
    echo "=============================================="
    echo ""

    preflight
    build
    deploy
    health_check

    echo ""
    log_info "Deployment to ${ENV} completed successfully!"
    echo ""
    echo "  Dashboard: http://localhost:3000"
    echo "  API:       http://localhost:8081"
    echo "  Engine:    http://localhost:8080/health"
    echo ""
}

main