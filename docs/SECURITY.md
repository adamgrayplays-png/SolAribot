# Security Guide

## Key Management

### Private Key Storage

**NEVER** store private keys in:
- Source code (including test files)
- Configuration files (YAML, JSON, TOML)
- Database records (unless encrypted)
- Log files
- Environment variable dumps

**Recommended approach:**
1. **Environment variables**: Loaded at runtime from `.env` files (outside version control)
2. **Hardware Security Module (HSM)**: For institutional deployments
3. **Encrypted keystore**: AES-256-GCM encrypted wallet file with strong passphrase
4. **Secret manager**: Use HashiCorp Vault, AWS Secrets Manager, or similar

### Key Generation

```bash
# Generate a dedicated trading key
solana-keygen grind --starts-with arb:1 --output ~/.config/solana/solAribot.json

# Export the key (for use in .env — handle with care!)
solana-keygen pubkey ~/.config/solana/solAribot.json
```

### Wallet Security Checklist

- [ ] Use a dedicated wallet for trading (not your main wallet)
- [ ] Keep minimal SOL in the trading wallet (replenish as needed)
- [ ] Set up multi-signature for fund withdrawals
- [ ] Monitor wallet activity with alerts
- [ ] Rotate keys periodically
- [ ] Never share the private key over unencrypted channels

## Environment Variable Security

### Required `.env` file checklist

```bash
# Verify permissions
chmod 600 .env
chmod 600 .env.mainnet

# Never commit to git
echo ".env" >> .gitignore
echo ".env.*" >> .gitignore
```

### Environment Variable Audit

| Variable | Sensitivity | Storage | Rotation |
|----------|-------------|---------|----------|
| `WALLET_PRIVATE_KEY` | Critical | Encrypted env | Monthly |
| `DATABASE_URL` | High | Env file | Quarterly |
| `REDIS_URL` | High | Env file | Quarterly |
| `DISCORD_WEBHOOK_URL` | Medium | Env file | As needed |
| `SOLANA_RPC_URL` | Low | Env file | As needed |
| `DASHBOARD_PASSWORD` | Medium | Env file | Monthly |

## Network Security

### Firewall Configuration

```bash
# Only expose necessary ports
# Dashboard (web UI)
iptables -A INPUT -p tcp --dport 3000 -j ACCEPT

# Orchestrator API
iptables -A INPUT -p tcp --dport 8081 -j ACCEPT

# Block all other inbound traffic
iptables -A INPUT -j DROP
```

### TLS/SSL

Configure the dashboard with HTTPS:

```nginx
# nginx configuration
server {
    listen 443 ssl;
    server_name dashboard.solAribot.com;

    ssl_certificate /etc/letsencrypt/live/dashboard.solAribot.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/dashboard.solAribot.com/privkey.pem;

    location / {
        proxy_pass http://localhost:3000;
    }
}
```

## Rate Limiting

Protect the API and dashboard from abuse:

```typescript
// Rate limiting configuration
const rateLimitConfig = {
    // Dashboard API: 100 requests per minute
    dashboard: { windowMs: 60000, max: 100 },
    // WebSocket: 1 connection per IP per second
    websocket: { windowMs: 1000, max: 1 },
    // Trade execution: 10 per minute
    trade: { windowMs: 60000, max: 10 }
};
```

## Security Monitoring

### Alerting

Configure alerts for:
- Failed login attempts (dashboard)
- Unexpected large trades
- Private key access anomalies
- RPC endpoint compromise
- Database connection failures

### Logging

```yaml
# Do NOT log sensitive data
logging:
  redact:
    - "WALLET_PRIVATE_KEY"
    - "password"
    - "secret"
    - "token"
```

## Docker Security

```dockerfile
# Use non-root user
RUN groupadd -r solAribot && useradd -r -g solAribot solAribot
USER solAribot

# Use read-only root filesystem
# docker run --read-only ...
```

## Regular Security Tasks

- [ ] **Daily**: Check for unauthorized access attempts
- [ ] **Weekly**: Review trade logs for anomalies
- [ ] **Monthly**: Rotate API keys and review access
- [ ] **Quarterly**: Update dependencies and security patches
- [ ] **Annually**: Full security audit and penetration testing

## Incident Response

1. **Immediate**: Stop the bot (`docker compose down`)
2. **Assess**: Determine scope of breach
3. **Contain**: Rotate all keys and credentials
4. **Recover**: Restore from clean backup
5. **Report**: Document incident and lessons learned