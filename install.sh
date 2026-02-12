#!/bin/bash
# Slipway Installation Script
# Usage: curl -fsSL https://raw.githubusercontent.com/sailscastshq/slipway/main/install.sh | bash

set -e

echo "🚀 Installing Slipway..."
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo -e "${YELLOW}Warning: Not running as root. You may need sudo for Docker commands.${NC}"
fi

# 1. Check/install Docker
if ! command -v docker &> /dev/null; then
    echo "📦 Docker not found. Installing..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker 2>/dev/null || true
    systemctl start docker 2>/dev/null || true
    echo -e "${GREEN}✓ Docker installed${NC}"
else
    echo -e "${GREEN}✓ Docker already installed${NC}"
fi

# 2. Create network for Slipway and apps
echo "🌐 Creating Docker network..."
docker network create slipway 2>/dev/null || true
echo -e "${GREEN}✓ Network ready${NC}"

# 3. Detect server's public IP
echo "🔍 Detecting server IP..."
IP=$(curl -s ifconfig.me 2>/dev/null || curl -s icanhazip.com 2>/dev/null || echo "")
if [ -z "$IP" ]; then
    echo -e "${YELLOW}Could not detect public IP. Using localhost.${NC}"
    IP="localhost"
fi
SLIPWAY_URL="http://$IP:1337"
echo -e "${GREEN}✓ Server URL: $SLIPWAY_URL${NC}"

# 4. Generate secret
SLIPWAY_SECRET=$(openssl rand -hex 32)

# 6. Start Caddy (reverse proxy with automatic HTTPS)
echo "🔒 Starting Caddy proxy..."
docker rm -f slipway-proxy 2>/dev/null || true
docker run -d \
    --name slipway-proxy \
    --network slipway \
    --restart unless-stopped \
    -p 80:80 \
    -p 443:443 \
    -p 1337:1337 \
    -v /var/run/docker.sock:/var/run/docker.sock:ro \
    -v slipway-certs:/data \
    -e CADDY_INGRESS_NETWORKS=slipway \
    lucaslorentz/caddy-docker-proxy:latest
echo -e "${GREEN}✓ Caddy proxy running${NC}"

# 7. Start Slipway dashboard
echo "🚀 Starting Slipway dashboard..."
docker rm -f slipway 2>/dev/null || true
docker run -d \
    --name slipway \
    --network slipway \
    --restart unless-stopped \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v slipway-data:/app/data \
    -e NODE_ENV=production \
    -e PORT=1337 \
    -e SLIPWAY_URL="$SLIPWAY_URL" \
    -e SLIPWAY_SECRET="$SLIPWAY_SECRET" \
    -l "caddy=:1337" \
    ghcr.io/sailscastshq/slipway:latest
echo -e "${GREEN}✓ Slipway dashboard running${NC}"

# 9. Wait for startup
echo ""
echo "⏳ Waiting for Slipway to start..."
sleep 5

# 10. Show access info
echo ""
echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅ Slipway installed successfully!${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
echo ""
echo "  Dashboard: $SLIPWAY_URL"
echo ""
echo "  Next steps:"
echo "  1. Open the dashboard URL above to complete setup"
echo "  2. Point a domain to this server (e.g., slipway.yourdomain.com)"
echo "  3. SSL will be configured automatically when you add a domain"
echo ""
echo "  To deploy apps, install the CLI:"
echo "    npm install -g slipway-cli"
echo "    slipway login --server $SLIPWAY_URL"
echo ""
echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
