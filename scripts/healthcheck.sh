#!/usr/bin/env bash
# =============================================================================
# SolAribot — RPC Health Checker & Failover
# =============================================================================
# Monitors Solana RPC endpoints and triggers failover when a primary RPC
# becomes unhealthy. Designed to run as a sidecar container.
# =============================================================================

set -euo pipefail

# Configuration
RPC_URL="${SOLANA_RPC_URL:-https://api.mainnet-beta.solana.com}"
FALLBACKS="${SOLANA_RPC_FALLBACKS:-}"
HEALTH_FILE="/tmp/rpc_health.json"
FAILOVER_FILE="/tmp/rpc_failover.json"
TIMEOUT_SECS=10
CONSECUTIVE_FAILURES_THRESHOLD=3

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[$(date +%H:%M:%S)]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[$(date +%H:%M:%S)]${NC} $1"; }
log_error() { echo -e "${RED}[$(date +%H:%M:%S)]${NC} $1"; }

# Parse comma-separated fallbacks into array
IFS=',' read -ra FALLBACK_URLS <<< "$FALLBACKS"

# Health check function for a single RPC endpoint
check_rpc() {
    local url="$1"
    local result

    result=$(curl -s -m "$TIMEOUT_SECS" -X POST "$url" \
        -H "Content-Type: application/json" \
        -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' 2>/dev/null)

    if echo "$result" | jq -e '.result == "ok"' &>/dev/null; then
        echo "healthy"
    elif echo "$result" | jq -e '.error' &>/dev/null; then
        echo "error: $(echo "$result" | jq -r '.error.message')"
    else
        echo "unreachable"
    fi
}

# Get slot number (for deeper health check)
get_slot() {
    local url="$1"
    curl -s -m "$TIMEOUT_SECS" -X POST "$url" \
        -H "Content-Type: application/json" \
        -d '{"jsonrpc":"2.0","id":1,"method":"getSlot"}' 2>/dev/null | \
        jq -r '.result // empty'
}

# Main health check loop
main() {
    log_info "RPC Health Checker started"
    log_info "Primary: $RPC_URL"
    log_info "Fallbacks: ${FALLBACKS:-none}"
    echo ""

    local primary_failures=0
    local current_primary="$RPC_URL"

    while true; do
        echo "--- Health Check at $(date -u +%Y-%m-%dT%H:%M:%SZ) ---"

        # Check primary
        local status
        status=$(check_rpc "$current_primary")
        local slot
        slot=$(get_slot "$current_primary")

        if [ "$status" = "healthy" ]; then
            log_info "✓ Primary ($current_primary): HEALTHY (slot: $slot)"
            primary_failures=0
            echo "{\"status\":\"healthy\",\"url\":\"$current_primary\",\"slot\":$slot,\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > "$HEALTH_FILE"
        else
            primary_failures=$((primary_failures + 1))
            log_warn "⚠ Primary ($current_primary): $status (failure #$primary_failures)"

            if [ "$primary_failures" -ge "$CONSECUTIVE_FAILURES_THRESHOLD" ]; then
                log_error "✗ Primary failed $primary_failures consecutive times. Triggering failover..."

                # Try fallbacks
                local failed=true
                for fb_url in "${FALLBACK_URLS[@]}"; do
                    fb_url=$(echo "$fb_url" | xargs)  # trim whitespace
                    [ -z "$fb_url" ] && continue

                    local fb_status
                    fb_status=$(check_rpc "$fb_url")
                    if [ "$fb_status" = "healthy" ]; then
                        log_info "✓ Failover to $fb_url: HEALTHY"
                        current_primary="$fb_url"
                        primary_failures=0
                        failed=false
                        echo "{\"status\":\"failover\",\"url\":\"$fb_url\",\"previous\":\"$RPC_URL\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > "$FAILOVER_FILE"
                        break
                    else
                        log_warn "  Fallback $fb_url: $fb_status"
                    fi
                done

                if [ "$failed" = true ]; then
                    log_error "All RPC endpoints unavailable!"
                    echo "{\"status\":\"all_down\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > "$HEALTH_FILE"
                fi
            fi
        fi

        echo ""
        sleep 30
    done
}

main