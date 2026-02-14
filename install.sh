#!/bin/bash
# Slipway Installation Script
# Usage: curl -fsSL https://raw.githubusercontent.com/sailscastshq/slipway/main/install.sh | bash

set -e

echo "Installing Slipway..."
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

SLIPWAY_ENV_FILE="/etc/slipway/.env"
IS_UPDATE=false

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo -e "${YELLOW}Warning: Not running as root. You may need sudo for Docker commands.${NC}"
fi

# 1. Check/install Docker
if ! command -v docker &> /dev/null; then
    echo "Docker not found. Installing..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker 2>/dev/null || true
    systemctl start docker 2>/dev/null || true
    echo -e "${GREEN}Docker installed${NC}"
else
    echo -e "${GREEN}Docker already installed${NC}"
fi

# 2. Create network for Slipway and apps
echo "Creating Docker network..."
docker network create slipway 2>/dev/null || true
echo -e "${GREEN}Network ready${NC}"

# 3. Detect server's public IPv4 address
echo "Detecting server IP..."
IP=$(curl -4 -s --max-time 5 ifconfig.me 2>/dev/null || curl -4 -s --max-time 5 icanhazip.com 2>/dev/null || echo "")
if [ -z "$IP" ]; then
    echo -e "${YELLOW}Could not detect public IP. Using localhost.${NC}"
    IP="localhost"
fi
SLIPWAY_URL="http://$IP:1337"
echo -e "${GREEN}Server URL: $SLIPWAY_URL${NC}"

# 4. Load or generate secrets
if [ -f "$SLIPWAY_ENV_FILE" ]; then
    # Update: reuse existing secrets
    echo -e "${GREEN}Existing installation detected — reusing secrets${NC}"
    source "$SLIPWAY_ENV_FILE"
    IS_UPDATE=true
else
    # First install: generate new secrets and persist them
    echo "Generating secrets..."
    SESSION_SECRET=$(openssl rand -hex 32)
    DATA_ENCRYPTION_KEY=$(openssl rand -base64 32)

    mkdir -p /etc/slipway
    cat > "$SLIPWAY_ENV_FILE" <<EOF
SESSION_SECRET=$SESSION_SECRET
DATA_ENCRYPTION_KEY=$DATA_ENCRYPTION_KEY
EOF
    chmod 600 "$SLIPWAY_ENV_FILE"
    echo -e "${GREEN}Secrets generated and saved to $SLIPWAY_ENV_FILE${NC}"
fi

# 5. Start Caddy (reverse proxy with automatic HTTPS)
echo "Starting Caddy proxy..."
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
echo -e "${GREEN}Caddy proxy running${NC}"

# 6. Pull latest image
echo "Pulling latest Slipway image..."
docker pull ghcr.io/sailscastshq/slipway:latest

# 7. Start Slipway dashboard
echo "Starting Slipway dashboard..."
docker rm -f slipway 2>/dev/null || true

# Check if database needs initial table creation
NEEDS_MIGRATION=$(docker run --rm \
    -v slipway-db:/app/db \
    ghcr.io/sailscastshq/slipway:latest \
    node -e "try { const D = require('better-sqlite3'); const db = new D('/app/db/app.db'); const r = db.prepare(\"SELECT count(*) as c FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'\").get(); console.log(r.c > 0 ? 'no' : 'yes'); db.close(); } catch(e) { console.log('yes'); }" 2>/dev/null)

if [ "$NEEDS_MIGRATION" = "yes" ]; then
    echo "Running database migration..."
    docker run --rm \
        -v slipway-db:/app/db \
        ghcr.io/sailscastshq/slipway:latest \
        node -e "const sails = require('sails'); sails.lift({ port: 0 }, (err) => { if (err) { console.error(err); process.exit(1); } console.log('Migration complete'); sails.lower(() => process.exit(0)); })"
    echo -e "${GREEN}Database migrated${NC}"
else
    echo -e "${GREEN}Database already initialized${NC}"
fi

docker run -d \
    --name slipway \
    --network slipway \
    --restart unless-stopped \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v slipway-db:/app/db \
    -e NODE_ENV=production \
    -e PORT=1337 \
    -e SLIPWAY_URL="$SLIPWAY_URL" \
    -e SESSION_SECRET="$SESSION_SECRET" \
    -e DATA_ENCRYPTION_KEY="$DATA_ENCRYPTION_KEY" \
    -l "caddy=:1337" \
    ghcr.io/sailscastshq/slipway:latest
echo -e "${GREEN}Slipway dashboard running${NC}"

# 8. Wait for startup
echo ""
echo "Waiting for Slipway to start..."
sleep 5

# 9. Show access info
echo ""
echo -e "${GREEN}========================================================${NC}"
if [ "$IS_UPDATE" = true ]; then
    echo -e "${GREEN}  Slipway updated successfully!${NC}"
else
    echo -e "${GREEN}  Slipway installed successfully!${NC}"
fi
echo -e "${GREEN}========================================================${NC}"
echo ""
echo "  Dashboard: $SLIPWAY_URL"
echo ""
if [ "$IS_UPDATE" = false ]; then
    echo "  Next steps:"
    echo "  1. Open the dashboard URL above to complete setup"
    echo "  2. Point a domain to this server (e.g., slipway.yourdomain.com)"
    echo "  3. SSL will be configured automatically when you add a domain"
    echo ""
    echo "  To deploy apps, install the CLI:"
    echo "    npm install -g slipway-cli"
    echo "    slipway login --server $SLIPWAY_URL"
    echo ""
fi
echo -e "${GREEN}========================================================${NC}"
