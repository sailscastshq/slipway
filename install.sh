#!/bin/bash
# Slipway Installation Script
# Usage: curl -fsSL https://raw.githubusercontent.com/sailscastshq/slipway/main/install.sh | bash
# Pin a version: curl -fsSL https://raw.githubusercontent.com/sailscastshq/slipway/main/install.sh | bash -s -- 0.0.49

set -e

echo "Installing Slipway..."
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

SLIPWAY_ENV_FILE="${SLIPWAY_ENV_FILE:-/etc/slipway/.env}"
SLIPWAY_APPS_DIR="${SLIPWAY_APPS_DIR:-/var/slipway/apps}"
SLIPWAY_IMAGE_REPOSITORY="${SLIPWAY_IMAGE_REPOSITORY:-ghcr.io/sailscastshq/slipway}"
SLIPWAY_VERSION="${SLIPWAY_VERSION:-${1:-}}"
SLIPWAY_CONTAINER="${SLIPWAY_CONTAINER:-slipway}"
SLIPWAY_VALIDATION_CONTAINER="${SLIPWAY_VALIDATION_CONTAINER:-slipway-next}"
SLIPWAY_PREVIOUS_CONTAINER="${SLIPWAY_PREVIOUS_CONTAINER:-slipway-previous}"
SLIPWAY_PROXY_CONTAINER="${SLIPWAY_PROXY_CONTAINER:-slipway-proxy}"
SLIPWAY_NETWORK="${SLIPWAY_NETWORK:-slipway}"
SLIPWAY_DB_VOLUME="${SLIPWAY_DB_VOLUME:-slipway-db}"
SLIPWAY_CERTS_VOLUME="${SLIPWAY_CERTS_VOLUME:-slipway-certs}"
SLIPWAY_PORT="${SLIPWAY_PORT:-1337}"
SLIPWAY_HTTP_PORT="${SLIPWAY_HTTP_PORT:-80}"
SLIPWAY_HTTPS_PORT="${SLIPWAY_HTTPS_PORT:-443}"
SLIPWAY_APP_PORT_START="${SLIPWAY_APP_PORT_START:-1338}"
SLIPWAY_APP_PORT_END="${SLIPWAY_APP_PORT_END:-1500}"
SLIPWAY_CONFIGURE_FIREWALL="${SLIPWAY_CONFIGURE_FIREWALL:-true}"
SLIPWAY_HEALTH_ATTEMPTS="${SLIPWAY_HEALTH_ATTEMPTS:-30}"
SLIPWAY_SKIP_PULL="${SLIPWAY_SKIP_PULL:-false}"
IS_UPDATE=false

container_exists() {
    docker container inspect "$1" >/dev/null 2>&1
}

remove_container() {
    docker rm -f "$1" >/dev/null 2>&1 || true
}

run_slipway_container() {
    local container_name="$1"
    local host_port="${2:-}"
    local port_args=()
    local restart_args=()

    if [ -n "$host_port" ]; then
        port_args=(-p "$host_port:1337")
        restart_args=(--restart unless-stopped)
    fi

    docker run -d \
        --name "$container_name" \
        --network "$SLIPWAY_NETWORK" \
        "${restart_args[@]}" \
        "${port_args[@]}" \
        -v /var/run/docker.sock:/var/run/docker.sock \
        -v "$SLIPWAY_APPS_DIR:$SLIPWAY_APPS_DIR" \
        -v "$SLIPWAY_DB_VOLUME:/app/db" \
        -e NODE_ENV=production \
        -e PORT=1337 \
        -e SLIPWAY_URL="$SLIPWAY_URL" \
        -e SLIPWAY_APP_PORT_START="$SLIPWAY_APP_PORT_START" \
        -e SLIPWAY_APP_PORT_END="$SLIPWAY_APP_PORT_END" \
        -e SESSION_SECRET="$SESSION_SECRET" \
        -e DATA_ENCRYPTION_KEY="$DATA_ENCRYPTION_KEY" \
        "$SLIPWAY_IMAGE"
}

wait_for_container_health() {
    local container_name="$1"
    local attempts="${2:-$SLIPWAY_HEALTH_ATTEMPTS}"

    for _ in $(seq 1 "$attempts"); do
        if docker exec "$container_name" curl -fsS http://localhost:1337/health >/dev/null 2>&1; then
            echo -e "${GREEN}${container_name} passed health check${NC}"
            return 0
        fi
        sleep 2
    done

    echo -e "${RED}${container_name} did not pass health check. Recent logs:${NC}" >&2
    docker logs --tail 200 "$container_name" >&2 || true
    return 1
}

validate_slipway_image() {
    echo "Validating Slipway image before replacing the live container..."
    remove_container "$SLIPWAY_VALIDATION_CONTAINER"

    if ! run_slipway_container "$SLIPWAY_VALIDATION_CONTAINER"; then
        echo -e "${RED}Failed to start validation container.${NC}" >&2
        remove_container "$SLIPWAY_VALIDATION_CONTAINER"
        exit 1
    fi

    if ! wait_for_container_health "$SLIPWAY_VALIDATION_CONTAINER"; then
        remove_container "$SLIPWAY_VALIDATION_CONTAINER"
        exit 1
    fi

    remove_container "$SLIPWAY_VALIDATION_CONTAINER"
    echo -e "${GREEN}Slipway image validated${NC}"
}

restore_previous_container() {
    if ! container_exists "$SLIPWAY_PREVIOUS_CONTAINER"; then
        return 1
    fi

    echo "Restoring previous Slipway container..."
    remove_container "$SLIPWAY_CONTAINER"
    docker rename "$SLIPWAY_PREVIOUS_CONTAINER" "$SLIPWAY_CONTAINER"
    docker start "$SLIPWAY_CONTAINER" >/dev/null

    if wait_for_container_health "$SLIPWAY_CONTAINER"; then
        echo -e "${GREEN}Previous Slipway container restored${NC}"
        return 0
    fi

    echo -e "${RED}Previous Slipway container was restored but did not pass health check.${NC}" >&2
    return 1
}

replace_live_container() {
    local had_previous=false

    if container_exists "$SLIPWAY_CONTAINER"; then
        had_previous=true
        echo "Preparing rollback target..."
        remove_container "$SLIPWAY_PREVIOUS_CONTAINER"
        docker rename "$SLIPWAY_CONTAINER" "$SLIPWAY_PREVIOUS_CONTAINER"
        docker stop "$SLIPWAY_PREVIOUS_CONTAINER" >/dev/null
    fi

    echo "Starting Slipway dashboard..."
    if ! run_slipway_container "$SLIPWAY_CONTAINER" "$SLIPWAY_PORT"; then
        echo -e "${RED}Failed to start Slipway dashboard.${NC}" >&2
        if [ "$had_previous" = true ]; then
            restore_previous_container || true
        fi
        exit 1
    fi

    if ! wait_for_container_health "$SLIPWAY_CONTAINER"; then
        if [ "$had_previous" = true ]; then
            restore_previous_container || true
        fi
        exit 1
    fi

    if [ "$had_previous" = true ]; then
        remove_container "$SLIPWAY_PREVIOUS_CONTAINER"
    fi
}

configure_host_firewall() {
    if [ "$SLIPWAY_CONFIGURE_FIREWALL" != true ]; then
        echo -e "${YELLOW}Host firewall configuration skipped (SLIPWAY_CONFIGURE_FIREWALL=$SLIPWAY_CONFIGURE_FIREWALL).${NC}"
        return
    fi

    if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q '^Status: active'; then
        echo "Allowing Slipway ports through UFW..."
        if ufw allow "$SLIPWAY_PORT/tcp" comment 'Slipway dashboard' >/dev/null \
            && ufw allow "$SLIPWAY_HTTP_PORT/tcp" comment 'Slipway HTTP' >/dev/null \
            && ufw allow "$SLIPWAY_HTTPS_PORT/tcp" comment 'Slipway HTTPS' >/dev/null \
            && ufw allow "$SLIPWAY_APP_PORT_START:$SLIPWAY_APP_PORT_END/tcp" comment 'Slipway direct app access' >/dev/null; then
            echo -e "${GREEN}UFW allows the dashboard, proxy, and direct app port range${NC}"
        else
            echo -e "${YELLOW}Slipway could not update every UFW rule. Review 'ufw status' before using direct app URLs.${NC}"
        fi
        return
    fi

    if command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
        echo "Allowing Slipway ports through firewalld..."
        if firewall-cmd --permanent --add-port="$SLIPWAY_PORT/tcp" >/dev/null \
            && firewall-cmd --permanent --add-port="$SLIPWAY_HTTP_PORT/tcp" >/dev/null \
            && firewall-cmd --permanent --add-port="$SLIPWAY_HTTPS_PORT/tcp" >/dev/null \
            && firewall-cmd --permanent --add-port="$SLIPWAY_APP_PORT_START-$SLIPWAY_APP_PORT_END/tcp" >/dev/null \
            && firewall-cmd --reload >/dev/null; then
            echo -e "${GREEN}firewalld allows the dashboard, proxy, and direct app port range${NC}"
        else
            echo -e "${YELLOW}Slipway could not update every firewalld rule. Review 'firewall-cmd --list-ports' before using direct app URLs.${NC}"
        fi
        return
    fi

    echo -e "${GREEN}No active UFW or firewalld host firewall detected${NC}"
}

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

# 2. Ensure Docker BuildKit (buildx) is available
if docker buildx version &> /dev/null; then
    echo -e "${GREEN}Docker BuildKit already installed${NC}"
else
    echo "Installing Docker BuildKit..."
    apt-get update -qq && apt-get install -y -qq docker-buildx-plugin 2>/dev/null || {
        # Manual install if package not available
        mkdir -p ~/.docker/cli-plugins
        BUILDX_URL="https://github.com/docker/buildx/releases/latest/download/buildx-$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m)"
        curl -fsSL "$BUILDX_URL" -o ~/.docker/cli-plugins/docker-buildx && chmod +x ~/.docker/cli-plugins/docker-buildx
    }
    echo -e "${GREEN}Docker BuildKit installed${NC}"
fi

# 3. Create network for Slipway and apps
echo "Creating Docker network..."
docker network create "$SLIPWAY_NETWORK" 2>/dev/null || true
echo -e "${GREEN}Network ready${NC}"

# 4. Detect server's public IPv4 address
echo "Detecting server IP..."
IP=$(curl -4 -s --max-time 5 ifconfig.me 2>/dev/null || curl -4 -s --max-time 5 icanhazip.com 2>/dev/null || echo "")
if [ -z "$IP" ]; then
    echo -e "${YELLOW}Could not detect public IP. Using localhost.${NC}"
    IP="localhost"
fi
SLIPWAY_URL="${SLIPWAY_URL:-http://$IP:$SLIPWAY_PORT}"
echo -e "${GREEN}Server URL: $SLIPWAY_URL${NC}"

# 5. Load or generate secrets
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

    mkdir -p "$(dirname "$SLIPWAY_ENV_FILE")"
    cat > "$SLIPWAY_ENV_FILE" <<EOF
SESSION_SECRET=$SESSION_SECRET
DATA_ENCRYPTION_KEY=$DATA_ENCRYPTION_KEY
SLIPWAY_APP_PORT_START=$SLIPWAY_APP_PORT_START
SLIPWAY_APP_PORT_END=$SLIPWAY_APP_PORT_END
EOF
    chmod 600 "$SLIPWAY_ENV_FILE"
    echo -e "${GREEN}Secrets generated and saved to $SLIPWAY_ENV_FILE${NC}"
fi

# 6. Start Caddy (reverse proxy with automatic HTTPS)
echo "Starting Caddy proxy..."
remove_container "$SLIPWAY_PROXY_CONTAINER"
docker run -d \
    --name "$SLIPWAY_PROXY_CONTAINER" \
    --network "$SLIPWAY_NETWORK" \
    --restart unless-stopped \
    -p "$SLIPWAY_HTTP_PORT:80" \
    -p "$SLIPWAY_HTTPS_PORT:443" \
    -v /var/run/docker.sock:/var/run/docker.sock:ro \
    -v "$SLIPWAY_CERTS_VOLUME:/data" \
    -e CADDY_INGRESS_NETWORKS="$SLIPWAY_NETWORK" \
    lucaslorentz/caddy-docker-proxy:latest
echo -e "${GREEN}Caddy proxy running${NC}"

# 7. Resolve and pull the target Slipway image
if [ -z "$SLIPWAY_VERSION" ]; then
    echo "Resolving latest Slipway release..."
    RELEASE_JSON=$(curl -fsSL https://api.github.com/repos/sailscastshq/slipway/releases/latest 2>/dev/null || true)
    SLIPWAY_VERSION=$(printf '%s' "$RELEASE_JSON" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)

    if [ -z "$SLIPWAY_VERSION" ]; then
        echo -e "${RED}Could not resolve the latest Slipway release.${NC}"
        echo "Pass an explicit version, for example: bash install.sh 0.0.49"
        echo "To intentionally use the moving tag, pass: bash install.sh latest"
        exit 1
    fi
fi

if [ "$SLIPWAY_VERSION" != "latest" ]; then
    SLIPWAY_VERSION="${SLIPWAY_VERSION#v}"
fi

SLIPWAY_IMAGE="$SLIPWAY_IMAGE_REPOSITORY:$SLIPWAY_VERSION"
if [ "$SLIPWAY_SKIP_PULL" = true ]; then
    echo "Using local Slipway image $SLIPWAY_IMAGE"
else
    echo "Pulling Slipway image $SLIPWAY_IMAGE..."
    docker pull "$SLIPWAY_IMAGE"
fi
docker pull alpine

# 7b. Ensure deployed app source survives container replacement
mkdir -p "$SLIPWAY_APPS_DIR"
if container_exists "$SLIPWAY_CONTAINER"; then
    HAS_APPS_MOUNT=$(docker inspect "$SLIPWAY_CONTAINER" --format '{{range .Mounts}}{{if eq .Destination "/var/slipway/apps"}}yes{{end}}{{end}}' 2>/dev/null || true)
    if [ "$HAS_APPS_MOUNT" != "yes" ]; then
        if docker exec "$SLIPWAY_CONTAINER" sh -lc 'test -d /var/slipway/apps && [ "$(ls -A /var/slipway/apps 2>/dev/null)" ]' >/dev/null 2>&1; then
            echo "Migrating deployed source into persistent storage..."
            docker exec "$SLIPWAY_CONTAINER" tar cf - -C /var/slipway/apps . \
                | docker run --rm -i -v "$SLIPWAY_APPS_DIR:$SLIPWAY_APPS_DIR" alpine sh -lc 'mkdir -p /var/slipway/apps && tar xf - -C /var/slipway/apps'
            echo -e "${GREEN}Source cache migrated${NC}"
        fi
    fi
fi

# 8. Prepare the database before validating a fresh first install
NEEDS_MIGRATION=$(docker run --rm \
    -v "$SLIPWAY_DB_VOLUME:/app/db" \
    "$SLIPWAY_IMAGE" \
    node -e "try { const D = require('better-sqlite3'); const db = new D('/app/db/app.db'); const r = db.prepare(\"SELECT count(*) as c FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'\").get(); console.log(r.c > 0 ? 'no' : 'yes'); db.close(); } catch(e) { console.log('yes'); }" 2>/dev/null)

if [ "$NEEDS_MIGRATION" = "yes" ]; then
    echo "Running database migration..."
    docker run --rm \
        -v "$SLIPWAY_DB_VOLUME:/app/db" \
        "$SLIPWAY_IMAGE" \
        node -e "const sails = require('sails'); sails.lift({ port: 0 }, (err) => { if (err) { console.error(err); process.exit(1); } console.log('Migration complete'); sails.lower(() => process.exit(0)); })"
    echo -e "${GREEN}Database migrated${NC}"
else
    echo -e "${GREEN}Database already initialized${NC}"
fi

# 9. Validate target image before touching the live dashboard
validate_slipway_image

# 10. Replace the live dashboard only after validation succeeds
replace_live_container
echo -e "${GREEN}Slipway dashboard running${NC}"

# 11. Keep host firewall rules aligned with Slipway's published ports
configure_host_firewall

# 12. Show access info
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
echo "  Direct app ports: TCP $SLIPWAY_APP_PORT_START-$SLIPWAY_APP_PORT_END"
echo "  If your VPS provider has a network firewall, allow inbound TCP $SLIPWAY_APP_PORT_START-$SLIPWAY_APP_PORT_END for direct app URLs."
echo "  Domains proxied through Caddy only require TCP $SLIPWAY_HTTP_PORT and $SLIPWAY_HTTPS_PORT."
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
