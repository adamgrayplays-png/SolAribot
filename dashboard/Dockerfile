# =============================================================================
# SolAribot Dashboard — Multi-stage Dockerfile
# Build: docker build -t solAribot/dashboard -f dashboard/Dockerfile .
# =============================================================================

# ---- Builder Stage ----
FROM node:20-slim AS builder

WORKDIR /app

# Copy root workspace config
COPY package.json ./
COPY dashboard/package.json ./dashboard/

# Install dependencies
RUN npm install

# Copy source
COPY dashboard/ ./dashboard/
COPY tsconfig.json ./

# Build
RUN cd dashboard && npm run build

# ---- Runtime Stage ----
FROM nginx:stable-alpine AS runtime

# Copy built static assets
COPY --from=builder /app/dashboard/dist /usr/share/nginx/html

# Custom nginx config for SPA routing with API proxy
RUN echo 'server { \
    listen 3000; \
    root /usr/share/nginx/html; \
    index index.html; \
    \
    # Gzip compression \
    gzip on; \
    gzip_types text/css application/javascript application/json image/svg+xml; \
    gzip_min_length 256; \
    \
    # SPA routing - serve index.html for all non-file routes \
    location / { \
        try_files $uri $uri/ /index.html; \
        add_header Cache-Control "no-cache, must-revalidate"; \
    } \
    \
    # Static assets cache \
    location /assets/ { \
        expires 1y; \
        add_header Cache-Control "public, immutable"; \
    } \
    \
    # API proxy to orchestrator \
    location /api/ { \
        proxy_pass http://orchestrator:8081; \
        proxy_http_version 1.1; \
        proxy_set_header Host $host; \
        proxy_set_header X-Real-IP $remote_addr; \
        proxy_read_timeout 30s; \
    } \
    \
    # WebSocket proxy to orchestrator \
    location /ws { \
        proxy_pass http://orchestrator:8081; \
        proxy_http_version 1.1; \
        proxy_set_header Upgrade $http_upgrade; \
        proxy_set_header Connection "upgrade"; \
        proxy_set_header Host $host; \
        proxy_read_timeout 86400s; \
    } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 3000

CMD ["nginx", "-g", "daemon off;"]