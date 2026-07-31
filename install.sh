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
SLIPWAY_BOOTSTRAP_ROUTE_CONTAINER="${SLIPWAY_BOOTSTRAP_ROUTE_CONTAINER:-slipway-route-bootstrap}"
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
REQUESTED_SLIPWAY_URL="${SLIPWAY_URL:-}"
REQUESTED_SLIPWAY_INGRESS="${SLIPWAY_INGRESS:-}"
REQUESTED_SLIPWAY_PROXY_HOST="${SLIPWAY_PROXY_HOST:-}"
REQUESTED_SLIPWAY_DASHBOARD_HOST="${SLIPWAY_DASHBOARD_HOST:-}"
REQUESTED_SLIPWAY_APP_PORT_HOST="${SLIPWAY_APP_PORT_HOST:-}"
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
        port_args=(-p "$SLIPWAY_DASHBOARD_HOST:$host_port:1337")
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
        -e SLIPWAY_INGRESS="$SLIPWAY_INGRESS" \
        -e SLIPWAY_APP_PORT_HOST="$SLIPWAY_APP_PORT_HOST" \
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

is_public_bind_host() {
    [ "$1" = "0.0.0.0" ]
}

validate_bind_host() {
    local name="$1"
    local value="$2"

    if [ "$value" != "127.0.0.1" ] && [ "$value" != "0.0.0.0" ]; then
        echo -e "${RED}$name must be 127.0.0.1 or 0.0.0.0 (received: $value).${NC}" >&2
        exit 1
    fi
}

persist_setting() {
    local key="$1"
    local value="$2"
    local temp_file="${SLIPWAY_ENV_FILE}.tmp"

    awk -v key="$key" -v value="$value" '
        BEGIN { updated = 0 }
        index($0, key "=") == 1 { print key "=" value; updated = 1; next }
        { print }
        END { if (!updated) print key "=" value }
    ' "$SLIPWAY_ENV_FILE" > "$temp_file"
    mv "$temp_file" "$SLIPWAY_ENV_FILE"
}

configure_bootstrap_dashboard_route() {
    local authority="${SLIPWAY_URL#*://}"
    local host
    local site

    authority="${authority%%/*}"
    if [[ "$authority" == \[* ]]; then
        host="${authority%%]*}]"
    else
        host="${authority%%:*}"
    fi

    if [ "$SLIPWAY_INGRESS" = "cloudflare-tunnel" ] || [[ "$SLIPWAY_URL" == http://* ]]; then
        site="http://$host"
    else
        site="$host"
    fi

    echo "Preparing initial dashboard route..."
    remove_container "$SLIPWAY_BOOTSTRAP_ROUTE_CONTAINER"
    docker run -d \
        --name "$SLIPWAY_BOOTSTRAP_ROUTE_CONTAINER" \
        --network "$SLIPWAY_NETWORK" \
        --restart unless-stopped \
        --label "caddy=$site" \
        --label "caddy.reverse_proxy=$SLIPWAY_CONTAINER:1337" \
        alpine sleep infinity >/dev/null
    echo -e "${GREEN}Initial dashboard route ready${NC}"
}

sync_ufw_port() {
    local host="$1"
    local port="$2"
    local comment="$3"

    if is_public_bind_host "$host"; then
        ufw allow "$port/tcp" comment "$comment" >/dev/null
    else
        ufw --force delete allow "$port/tcp" >/dev/null 2>&1 || true
    fi
}

sync_firewalld_port() {
    local host="$1"
    local port="$2"

    if is_public_bind_host "$host"; then
        firewall-cmd --permanent --add-port="$port/tcp" >/dev/null
    else
        firewall-cmd --permanent --remove-port="$port/tcp" >/dev/null 2>&1 || true
    fi
}

allow_ufw_ports() {
    local status=0
    sync_ufw_port "$SLIPWAY_PROXY_HOST" "$SLIPWAY_HTTP_PORT" 'Slipway HTTP' || status=1
    sync_ufw_port "$SLIPWAY_PROXY_HOST" "$SLIPWAY_HTTPS_PORT" 'Slipway HTTPS' || status=1
    sync_ufw_port "$SLIPWAY_DASHBOARD_HOST" "$SLIPWAY_PORT" 'Slipway dashboard' || status=1
    sync_ufw_port "$SLIPWAY_APP_PORT_HOST" "$SLIPWAY_APP_PORT_START:$SLIPWAY_APP_PORT_END" 'Slipway direct app access' || status=1
    return "$status"
}

allow_firewalld_ports() {
    local status=0
    sync_firewalld_port "$SLIPWAY_PROXY_HOST" "$SLIPWAY_HTTP_PORT" || status=1
    sync_firewalld_port "$SLIPWAY_PROXY_HOST" "$SLIPWAY_HTTPS_PORT" || status=1
    sync_firewalld_port "$SLIPWAY_DASHBOARD_HOST" "$SLIPWAY_PORT" || status=1
    sync_firewalld_port "$SLIPWAY_APP_PORT_HOST" "$SLIPWAY_APP_PORT_START-$SLIPWAY_APP_PORT_END" || status=1
    firewall-cmd --reload >/dev/null || status=1
    return "$status"
}

configure_host_firewall() {
    if [ "$SLIPWAY_CONFIGURE_FIREWALL" != true ]; then
        echo -e "${YELLOW}Host firewall configuration skipped (SLIPWAY_CONFIGURE_FIREWALL=$SLIPWAY_CONFIGURE_FIREWALL).${NC}"
        return
    fi

    if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q '^Status: active'; then
        echo "Aligning UFW with Slipway's public bindings..."
        if allow_ufw_ports; then
            echo -e "${GREEN}UFW matches Slipway's public bindings${NC}"
        else
            echo -e "${YELLOW}Slipway could not update every UFW rule. Review 'ufw status'.${NC}"
        fi
        return
    fi

    if command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
        echo "Aligning firewalld with Slipway's public bindings..."
        if allow_firewalld_ports; then
            echo -e "${GREEN}firewalld matches Slipway's public bindings${NC}"
        else
            echo -e "${YELLOW}Slipway could not update every firewalld rule. Review 'firewall-cmd --list-ports'.${NC}"
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
fi

SLIPWAY_INGRESS="${REQUESTED_SLIPWAY_INGRESS:-${SLIPWAY_INGRESS:-public}}"
if [ "$SLIPWAY_INGRESS" != "public" ] && [ "$SLIPWAY_INGRESS" != "cloudflare-tunnel" ]; then
    echo -e "${RED}SLIPWAY_INGRESS must be public or cloudflare-tunnel.${NC}" >&2
    exit 1
fi

if [ "$IS_UPDATE" = true ]; then
    DEFAULT_DASHBOARD_HOST="0.0.0.0"
    DEFAULT_APP_PORT_HOST="0.0.0.0"
else
    DEFAULT_DASHBOARD_HOST="127.0.0.1"
    DEFAULT_APP_PORT_HOST="127.0.0.1"
fi

DEFAULT_PROXY_HOST="0.0.0.0"
if [ "$SLIPWAY_INGRESS" = "cloudflare-tunnel" ]; then
    DEFAULT_PROXY_HOST="127.0.0.1"
fi

SLIPWAY_PROXY_HOST="${REQUESTED_SLIPWAY_PROXY_HOST:-${SLIPWAY_PROXY_HOST:-$DEFAULT_PROXY_HOST}}"
SLIPWAY_DASHBOARD_HOST="${REQUESTED_SLIPWAY_DASHBOARD_HOST:-${SLIPWAY_DASHBOARD_HOST:-$DEFAULT_DASHBOARD_HOST}}"
SLIPWAY_APP_PORT_HOST="${REQUESTED_SLIPWAY_APP_PORT_HOST:-${SLIPWAY_APP_PORT_HOST:-$DEFAULT_APP_PORT_HOST}}"

validate_bind_host SLIPWAY_PROXY_HOST "$SLIPWAY_PROXY_HOST"
validate_bind_host SLIPWAY_DASHBOARD_HOST "$SLIPWAY_DASHBOARD_HOST"
validate_bind_host SLIPWAY_APP_PORT_HOST "$SLIPWAY_APP_PORT_HOST"

if [ "$SLIPWAY_INGRESS" = "cloudflare-tunnel" ] && [ -z "$REQUESTED_SLIPWAY_URL" ] && [ -z "${SLIPWAY_URL:-}" ]; then
    echo -e "${RED}Cloudflare Tunnel mode requires SLIPWAY_URL (for example, https://slipway.example.com).${NC}" >&2
    exit 1
fi

if [ -n "$REQUESTED_SLIPWAY_URL" ]; then
    SLIPWAY_URL="$REQUESTED_SLIPWAY_URL"
elif [ -z "${SLIPWAY_URL:-}" ]; then
    if is_public_bind_host "$SLIPWAY_DASHBOARD_HOST"; then
        SLIPWAY_URL="http://$IP:$SLIPWAY_PORT"
    else
        SLIPWAY_URL="http://$IP"
    fi
fi

if [ "$IS_UPDATE" = false ]; then
    mkdir -p "$(dirname "$SLIPWAY_ENV_FILE")"
    cat > "$SLIPWAY_ENV_FILE" <<EOF
SESSION_SECRET=$SESSION_SECRET
DATA_ENCRYPTION_KEY=$DATA_ENCRYPTION_KEY
SLIPWAY_URL=$SLIPWAY_URL
SLIPWAY_INGRESS=$SLIPWAY_INGRESS
SLIPWAY_PROXY_HOST=$SLIPWAY_PROXY_HOST
SLIPWAY_DASHBOARD_HOST=$SLIPWAY_DASHBOARD_HOST
SLIPWAY_APP_PORT_HOST=$SLIPWAY_APP_PORT_HOST
SLIPWAY_APP_PORT_START=$SLIPWAY_APP_PORT_START
SLIPWAY_APP_PORT_END=$SLIPWAY_APP_PORT_END
EOF
else
    persist_setting SLIPWAY_URL "$SLIPWAY_URL"
    persist_setting SLIPWAY_INGRESS "$SLIPWAY_INGRESS"
    persist_setting SLIPWAY_PROXY_HOST "$SLIPWAY_PROXY_HOST"
    persist_setting SLIPWAY_DASHBOARD_HOST "$SLIPWAY_DASHBOARD_HOST"
    persist_setting SLIPWAY_APP_PORT_HOST "$SLIPWAY_APP_PORT_HOST"
fi
chmod 600 "$SLIPWAY_ENV_FILE"
echo -e "${GREEN}Configuration saved to $SLIPWAY_ENV_FILE${NC}"
echo -e "${GREEN}Server URL: $SLIPWAY_URL${NC}"

# 6. Start Caddy (reverse proxy with automatic HTTPS)
echo "Starting Caddy proxy..."
remove_container "$SLIPWAY_PROXY_CONTAINER"
docker run -d \
    --name "$SLIPWAY_PROXY_CONTAINER" \
    --network "$SLIPWAY_NETWORK" \
    --restart unless-stopped \
    -p "$SLIPWAY_PROXY_HOST:$SLIPWAY_HTTP_PORT:80" \
    -p "$SLIPWAY_PROXY_HOST:$SLIPWAY_HTTPS_PORT:443" \
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

# 10. Route initial setup through Caddy before making the dashboard live
configure_bootstrap_dashboard_route

# 11. Replace the live dashboard only after validation succeeds
replace_live_container
echo -e "${GREEN}Slipway dashboard running${NC}"

# 12. Keep host firewall rules aligned with Slipway's published ports
configure_host_firewall

# 13. Show access info
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
if [ "$SLIPWAY_INGRESS" = "cloudflare-tunnel" ]; then
    echo "  Public ingress: Cloudflare Tunnel (Caddy listens on loopback)"
elif is_public_bind_host "$SLIPWAY_PROXY_HOST"; then
    echo "  Public ingress: TCP $SLIPWAY_HTTP_PORT and $SLIPWAY_HTTPS_PORT through Caddy"
else
    echo "  Public ingress: none (Caddy listens on loopback)"
fi
if is_public_bind_host "$SLIPWAY_APP_PORT_HOST"; then
    echo "  Direct app ports: TCP $SLIPWAY_APP_PORT_START-$SLIPWAY_APP_PORT_END (explicitly public)"
    echo "  Allow that range in your VPS provider firewall before using raw IP:port URLs."
else
    echo "  Direct app ports: private (set SLIPWAY_APP_PORT_HOST=0.0.0.0 to opt in)"
fi
if is_public_bind_host "$SLIPWAY_DASHBOARD_HOST"; then
    echo "  Dashboard port: TCP $SLIPWAY_PORT (legacy or explicitly public binding)"
fi
echo ""
if [ "$IS_UPDATE" = false ]; then
    echo "  Next steps:"
    if [ "$SLIPWAY_INGRESS" = "cloudflare-tunnel" ]; then
        echo "  1. Route $SLIPWAY_URL through Cloudflare Tunnel to http://127.0.0.1:$SLIPWAY_HTTP_PORT"
        echo "  2. Open the dashboard URL above to complete setup"
        echo "  3. Add generated and custom app hostnames to the tunnel"
    else
        echo "  1. Open the dashboard URL above to complete setup"
        echo "  2. Point a domain to this server (e.g., slipway.yourdomain.com)"
        echo "  3. SSL will be configured automatically when you add a domain"
    fi
    echo ""
    echo "  To deploy apps, install the CLI:"
    echo "    npm install -g slipway-cli"
    echo "    slipway login --server $SLIPWAY_URL"
    echo ""
fi
echo -e "${GREEN}========================================================${NC}"
