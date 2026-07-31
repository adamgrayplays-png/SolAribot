# Performance Optimization Guide

## Overview

SolAribot is designed for sub-100ms end-to-end latency. This guide covers optimization strategies for each component.

## Target Metrics

| Metric | Target | Notes |
|--------|--------|-------|
| End-to-end latency | < 100ms | Scan → execution |
| DEX polling | > 200 pairs/3ms | Concurrent polling |
| Transaction confirmation | < 5s | With priority fees |
| Dashboard refresh | < 100ms | WebSocket push |
| Memory usage | < 500MB | Per container |

## Rust Engine Optimization

### Multi-threading

```rust
// Use tokio for async I/O
#[tokio::main(flavor = "multi_thread", worker_threads = 8)]
async fn main() {
    // ...
}

// Use rayon for CPU-bound tasks
use rayon::prelude::*;

fn process_pools(pools: Vec<Pool>) -> Vec<Price> {
    pools.par_iter()
        .map(|pool| parse_pool(pool))
        .collect()
}
```

### Memory Efficiency

```rust
// Pre-allocate with known capacity
let mut prices = Vec::with_capacity(10_000);

// Use stack-allocated types where possible
#[repr(C, packed)]
struct PoolKey {
    dex: [u8; 4],
    address: [u8; 32],
}

// Use Arc for shared data instead of cloning
let shared_prices: Arc<RwLock<HashMap<PoolKey, Price>>> = Arc::new(RwLock::new(HashMap::new()));
```

### Async Patterns

```rust
// Use tokio::spawn for concurrent tasks
let handles: Vec<_> = dexes.iter()
    .map(|dex| {
        tokio::spawn(async move {
            monitor_dex(dex).await
        })
    })
    .collect();

// Use select! for timeout handling
tokio::select! {
    result = execute_trade(tx) => {
        handle_result(result);
    }
    _ = tokio::time::sleep(Duration::from_millis(100)) => {
        handle_timeout();
    }
}
```

### RPC Optimization

```rust
// Use WebSocket subscriptions for real-time updates
let ws_url = "wss://api.mainnet-beta.solana.com";
let subscription = client.program_subscribe(
    &program_id,
    RpcProgramAccountsConfig {
        filters: Some(filters),
        commitment: Some(CommitmentConfig::confirmed()),
    },
);

// Batch requests where possible
let batch = client.send_batch(requests).await?;

// Use connection pooling
let pool = ConnectionPool::new(rpc_urls, 10);
```

## TypeScript Orchestrator Optimization

### Async Patterns

```typescript
// Use Promise.all for concurrent operations
const prices = await Promise.all(
    dexes.map(dex => fetchPrice(dex))
);

// Use AbortController for timeouts
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 100);
const result = await fetch(url, { signal: controller.signal });
clearTimeout(timeout);
```

### Memory Efficiency

```typescript
// Use typed arrays for numerical data
const prices = new Float64Array(10000);

// Use Object pools to reduce GC pressure
class PricePool {
    private pool: Price[] = [];
    
    acquire(): Price {
        return this.pool.pop() ?? new Price();
    }
    
    release(price: Price): void {
        this.pool.push(price);
    }
}

// Use Map instead of Object for dynamic keys
const priceMap = new Map<string, Price>();
```

### WebSocket Optimization

```typescript
// Use binary framing for efficiency
const ws = new WebSocket('ws://localhost:8081');
ws.binaryType = 'arraybuffer';

// Batch small updates
let batch: Price[] = [];
let batchTimer: NodeJS.Timeout;

function pushPrice(price: Price) {
    batch.push(price);
    if (!batchTimer) {
        batchTimer = setTimeout(() => flushBatch(), 10);
    }
}

function flushBatch() {
    ws.send(encodeBatch(batch));
    batch = [];
    batchTimer = null;
}
```

## Dashboard Optimization

### React Optimizations

```typescript
// Use React.memo for expensive components
const TradeRow = React.memo(({ trade }: { trade: Trade }) => {
    return <div>{/* ... */}</div>;
});

// Use useMemo for computed values
const profitColor = useMemo(() => {
    return profit > 0 ? 'text-green' : 'text-red';
}, [profit]);

// Use useCallback for event handlers
const handleThresholdChange = useCallback((value: number) => {
    setThreshold(value);
}, []);
```

### WebSocket Updates

```typescript
// Use requestAnimationFrame for smooth rendering
const updateQueue: Update[] = [];

ws.onmessage = (event) => {
    updateQueue.push(parseUpdate(event.data));
    requestAnimationFrame(processUpdates);
};

function processUpdates() {
    const updates = updateQueue.splice(0);
    setState(prev => applyUpdates(prev, updates));
}
```

## Database Optimization

### Indexing

```sql
-- Create indexes for common queries
CREATE INDEX CONCURRENTLY idx_trades_executed_at ON trades(executed_at DESC);
CREATE INDEX CONCURRENTLY idx_opportunities_profit ON opportunities(expected_profit DESC);
CREATE INDEX CONCURRENTLY idx_dex_latency_recent ON dex_latency(dex_name, recorded_at DESC);
```

### Connection Pooling

```typescript
// Use pg-pool for PostgreSQL
const pool = new Pool({
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

// Use ioredis for Redis
const redis = new Redis({
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => Math.min(times * 50, 2000),
});
```

## Docker Optimization

### Container Resource Limits

```yaml
services:
  engine:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 512M
        reservations:
          cpus: '1'
          memory: 256M
```

### Image Size Optimization

```dockerfile
# Use multi-stage builds (already done)
# Use slim base images
# Clean up package manager caches
RUN apt-get update && apt-get install -y --no-install-recommends \
    package \
    && rm -rf /var/lib/apt/lists/*
```

## Monitoring Performance

### Prometheus Metrics

```typescript
// Export metrics for monitoring
const latencyHistogram = new Histogram({
    name: 'solAribot_trade_latency_ms',
    help: 'Trade execution latency in ms',
    buckets: [10, 25, 50, 75, 100, 150, 200, 500],
});

const errorCounter = new Counter({
    name: 'solAribot_errors_total',
    help: 'Total number of errors',
    labelNames: ['type'],
});
```

## Profiling

### Rust

```bash
# CPU profiling
perf record -g ./target/release/solAribot-engine
perf report

# Memory profiling
valgrind --tool=massif ./target/release/solAribot-engine
```

### TypeScript

```bash
# CPU profiling
node --cpu-prof --cpu-prof-dir=./profiles dist/index.js

# Memory profiling
node --heap-prof --heap-prof-dir=./profiles dist/index.js
```

## Benchmarking

```bash
# Engine benchmark
cargo bench

# API benchmark
wrk -t12 -c100 -d30s http://localhost:8081/api/opportunities
```