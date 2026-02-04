# ── Stage 1: Build frontend assets ──
FROM node:22-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Build production assets via Shipwright (sails-hook-shipwright).
# sails.load() initializes hooks without starting the HTTP server.
# Shipwright detects NODE_ENV=production and runs rsbuild.build(),
# compiling Vue/JS/CSS into .tmp/public/.
RUN NODE_ENV=production node -e " \
  const sails = require('sails'); \
  sails.load({}, (err) => { \
    if (err) { console.error(err.message); process.exit(1); } \
    sails.lower(() => process.exit(0)); \
  });"

# ── Stage 2: Production image ──
FROM node:22-slim

WORKDIR /app

# Install tini, curl, and Docker CLI (for container management)
RUN apt-get update && \
    apt-get install -y --no-install-recommends tini curl ca-certificates gnupg && \
    install -m 0755 -d /etc/apt/keyrings && \
    curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg && \
    chmod a+r /etc/apt/keyrings/docker.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null && \
    apt-get update && \
    apt-get install -y --no-install-recommends docker-ce-cli && \
    rm -rf /var/lib/apt/lists/*

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy application code
COPY . .

# Copy pre-built assets from builder stage
COPY --from=builder /app/.tmp/public ./.tmp/public

# Data directory for SQLite, SSH keys, etc.
VOLUME /app/data

# Health check
HEALTHCHECK --interval=30s --timeout=3s \
    CMD curl -f http://localhost:1337/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npm", "start"]
