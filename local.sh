#!/bin/bash
# Slipway local installer
# Usage: bash ./local.sh [install|rebuild|upgrade-check|stop|down|destroy|logs|status|shell]

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMMAND="${1:-install}"
PREVIOUS_VERSION="${2:-}"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

LOCAL_ROOT="${SLIPWAY_LOCAL_ROOT:-$ROOT_DIR/.tmp/local}"
SLIPWAY_ENV_FILE="${SLIPWAY_LOCAL_ENV_FILE:-$LOCAL_ROOT/.env}"
SLIPWAY_APPS_DIR="${SLIPWAY_LOCAL_APPS_DIR:-$LOCAL_ROOT/apps}"
SLIPWAY_DB_DIR="${SLIPWAY_LOCAL_DB_DIR:-$LOCAL_ROOT/db}"
CONTAINER_NAME="${SLIPWAY_LOCAL_CONTAINER:-slipway-local}"
IMAGE_NAME="${SLIPWAY_LOCAL_IMAGE:-slipway-local:latest}"
NETWORK_NAME="${SLIPWAY_LOCAL_NETWORK:-slipway}"
NODE_MODULES_VOLUME="${SLIPWAY_LOCAL_NODE_MODULES_VOLUME:-slipway-local-node-modules}"
NPM_CACHE_VOLUME="${SLIPWAY_LOCAL_NPM_CACHE_VOLUME:-slipway-local-npm-cache}"
PORT="${SLIPWAY_LOCAL_PORT:-1337}"
HOST="${SLIPWAY_LOCAL_HOST:-127.0.0.1}"
SLIPWAY_URL="${SLIPWAY_LOCAL_URL:-http://${HOST}:${PORT}}"

usage() {
  cat <<EOF
Usage: bash ./local.sh [install|rebuild|upgrade-check|stop|down|destroy|logs|status|shell]

Commands:
  install   Build the current checkout and run Slipway locally in Docker
  rebuild   Same as install, but forces a no-cache Docker build
  upgrade-check <version>
            Boot the current checkout in production against the previous
            release's database shape (for example: upgrade-check 0.0.57)
  stop      Stop the local Slipway container, but keep it for restart/debugging
  down      Stop and remove the local Slipway container
  destroy   Remove the local container, cached volumes, and .tmp/local state
  logs      Tail logs from the local Slipway container
  status    Show the local Slipway container status
  shell     Open a shell inside the local Slipway container
EOF
}

ensure_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "Docker is required for local.sh." >&2
    exit 1
  fi

  if ! docker info >/dev/null 2>&1; then
    echo "Docker is installed but not running." >&2
    exit 1
  fi
}

ensure_local_directories() {
  mkdir -p "$LOCAL_ROOT" "$SLIPWAY_APPS_DIR" "$SLIPWAY_DB_DIR"
}

generate_hex_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
    return
  fi

  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
}

generate_base64_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 32
    return
  fi

  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
}

load_or_generate_secrets() {
  if [ -f "$SLIPWAY_ENV_FILE" ]; then
    # shellcheck disable=SC1090
    source "$SLIPWAY_ENV_FILE"
    echo -e "${GREEN}Reusing local Slipway secrets${NC}"
    return
  fi

  local session_secret data_encryption_key
  session_secret="$(generate_hex_secret)"
  data_encryption_key="$(generate_base64_secret)"

  cat > "$SLIPWAY_ENV_FILE" <<EOF
SESSION_SECRET=$session_secret
DATA_ENCRYPTION_KEY=$data_encryption_key
EOF
  chmod 600 "$SLIPWAY_ENV_FILE"

  SESSION_SECRET="$session_secret"
  DATA_ENCRYPTION_KEY="$data_encryption_key"

  echo -e "${GREEN}Generated local Slipway secrets${NC}"
}

ensure_network() {
  echo "Creating Docker network..."
  docker network create "$NETWORK_NAME" >/dev/null 2>&1 || true
  echo -e "${GREEN}Network ready${NC}"
}

ensure_volumes() {
  docker volume create "$NODE_MODULES_VOLUME" >/dev/null
  docker volume create "$NPM_CACHE_VOLUME" >/dev/null
}

hash_files() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$@" | shasum -a 256 | awk '{ print $1 }'
    return
  fi

  sha256sum "$@" | sha256sum | awk '{ print $1 }'
}

build_local_image() {
  echo "Building local Slipway image..."

  if [ "$COMMAND" = "rebuild" ]; then
    docker build --no-cache -t "$IMAGE_NAME" "$ROOT_DIR"
    return
  fi

  docker build -t "$IMAGE_NAME" "$ROOT_DIR"
}

ensure_container_dependencies() {
  local checksum_files lock_hash
  checksum_files=("$ROOT_DIR/package.json")

  if [ -f "$ROOT_DIR/package-lock.json" ]; then
    checksum_files+=("$ROOT_DIR/package-lock.json")
  fi

  if [ -f "$ROOT_DIR/.npmrc" ]; then
    checksum_files+=("$ROOT_DIR/.npmrc")
  fi

  lock_hash="$(hash_files "${checksum_files[@]}")"

  echo "Ensuring local container dependencies..."
  docker run --rm \
    -v "$ROOT_DIR:/app" \
    -v "$NODE_MODULES_VOLUME:/app/node_modules" \
    -v "$NPM_CACHE_VOLUME:/root/.npm" \
    -w /app \
    -e SLIPWAY_LOCAL_DEP_HASH="$lock_hash" \
    "$IMAGE_NAME" \
    bash -lc '
      current_hash=""
      if [ -f /app/node_modules/.slipway-local-lock ]; then
        current_hash="$(cat /app/node_modules/.slipway-local-lock)"
      fi

      if [ "$current_hash" = "$SLIPWAY_LOCAL_DEP_HASH" ]; then
        echo "Local dependencies already match the current lockfile."
        exit 0
      fi

      npm ci
      printf "%s" "$SLIPWAY_LOCAL_DEP_HASH" > /app/node_modules/.slipway-local-lock
    '
}

stop_container() {
  docker stop "$CONTAINER_NAME" >/dev/null 2>&1 || true
}

remove_container() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
}

run_local_slipway() {
  echo "Starting local Slipway at ${SLIPWAY_URL}..."
  docker run -d \
    --name "$CONTAINER_NAME" \
    --network "$NETWORK_NAME" \
    -p "${PORT}:1337" \
    -v "$ROOT_DIR:/app" \
    -v "$NODE_MODULES_VOLUME:/app/node_modules" \
    -v "$NPM_CACHE_VOLUME:/root/.npm" \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v "$SLIPWAY_APPS_DIR:/var/slipway/apps" \
    -v "$SLIPWAY_DB_DIR:/app/db" \
    -w /app \
    -e NODE_ENV=development \
    -e PORT=1337 \
    -e SLIPWAY_URL="$SLIPWAY_URL" \
    -e SESSION_SECRET="$SESSION_SECRET" \
    -e DATA_ENCRYPTION_KEY="$DATA_ENCRYPTION_KEY" \
    "$IMAGE_NAME" \
    bash -lc "npm run dev" >/dev/null

  echo -e "${GREEN}Slipway local container started${NC}"
}

wait_for_health() {
  local url attempts
  url="${SLIPWAY_URL%/}/health"
  attempts=45

  echo "Waiting for Slipway to start..."
  for _ in $(seq 1 "$attempts"); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo -e "${GREEN}Slipway local is healthy at ${SLIPWAY_URL}${NC}"
      return 0
    fi
    sleep 2
  done

  echo "Health check failed for ${CONTAINER_NAME}. Recent logs:" >&2
  docker logs --tail 200 "$CONTAINER_NAME" || true
  exit 1
}

wait_for_container_health() {
  local container_name="$1"
  local attempts="${2:-45}"

  for _ in $(seq 1 "$attempts"); do
    if docker exec "$container_name" \
      curl -fsS http://localhost:1337/health >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done

  echo "Health check failed for ${container_name}. Recent logs:" >&2
  docker logs --tail 200 "$container_name" >&2 || true
  return 1
}

check_upgrade_from_previous_release() {
  if [ -z "$PREVIOUS_VERSION" ]; then
    echo "Pass the previous release version, for example:" >&2
    echo "  npm run local:upgrade-check -- 0.0.57" >&2
    exit 1
  fi

  local suffix previous_image seed_container current_container
  local candidate_container db_volume apps_volume session_secret
  local data_encryption_key
  suffix="$$"
  previous_image="ghcr.io/sailscastshq/slipway:${PREVIOUS_VERSION#v}"
  seed_container="slipway-upgrade-seed-${suffix}"
  current_container="slipway-upgrade-current-${suffix}"
  candidate_container="slipway-upgrade-candidate-${suffix}"
  db_volume="slipway-upgrade-db-${suffix}"
  apps_volume="slipway-upgrade-apps-${suffix}"
  session_secret="$(generate_hex_secret)"
  data_encryption_key="$(generate_base64_secret)"

  cleanup_upgrade_check() {
    docker rm -f \
      "$seed_container" \
      "$current_container" \
      "$candidate_container" >/dev/null 2>&1 || true
    docker volume rm -f "$db_volume" "$apps_volume" >/dev/null 2>&1 || true
  }
  trap cleanup_upgrade_check EXIT INT TERM

  ensure_network
  build_local_image
  docker pull "$previous_image"
  docker volume create "$db_volume" >/dev/null
  docker volume create "$apps_volume" >/dev/null

  echo "Creating the ${PREVIOUS_VERSION#v} database shape..."
  docker run -d \
    --name "$seed_container" \
    --network "$NETWORK_NAME" \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v "$db_volume:/app/db" \
    -v "$apps_volume:/var/slipway/apps" \
    -e NODE_ENV=development \
    -e PORT=1337 \
    -e SLIPWAY_URL="http://${seed_container}:1337" \
    -e SLIPWAY_APP_PORT_HOST=127.0.0.1 \
    -e SLIPWAY_APP_PORT_START=15500 \
    -e SLIPWAY_APP_PORT_END=15600 \
    -e SESSION_SECRET="$session_secret" \
    -e DATA_ENCRYPTION_KEY="$data_encryption_key" \
    "$previous_image" node app.js >/dev/null
  wait_for_container_health "$seed_container"
  docker rm -f "$seed_container" >/dev/null

  echo "Starting the current ${PREVIOUS_VERSION#v} release..."
  docker run -d \
    --name "$current_container" \
    --network "$NETWORK_NAME" \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v "$db_volume:/app/db" \
    -v "$apps_volume:/var/slipway/apps" \
    -e NODE_ENV=production \
    -e PORT=1337 \
    -e SLIPWAY_URL="http://${current_container}:1337" \
    -e SLIPWAY_APP_PORT_HOST=127.0.0.1 \
    -e SLIPWAY_APP_PORT_START=15500 \
    -e SLIPWAY_APP_PORT_END=15600 \
    -e SESSION_SECRET="$session_secret" \
    -e DATA_ENCRYPTION_KEY="$data_encryption_key" \
    "$previous_image" >/dev/null
  wait_for_container_health "$current_container"

  echo "Validating release migrations on copies while the previous release runs..."
  docker run --rm \
    -v "$db_volume:/app/db" \
    "$IMAGE_NAME" node -e \
    "require('./api/lib/release-migrations').run({directory:'/app/db',preflightOnly:true}).then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1})"
  docker stop "$current_container" >/dev/null

  echo "Starting the current checkout after stopping the previous writer..."
  docker run -d \
    --name "$candidate_container" \
    --network "$NETWORK_NAME" \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v "$db_volume:/app/db" \
    -v "$apps_volume:/var/slipway/apps" \
    -e NODE_ENV=production \
    -e PORT=1337 \
    -e SLIPWAY_URL="http://${candidate_container}:1337" \
    -e SLIPWAY_APP_PORT_HOST=127.0.0.1 \
    -e SLIPWAY_APP_PORT_START=15500 \
    -e SLIPWAY_APP_PORT_END=15600 \
    -e SESSION_SECRET="$session_secret" \
    -e DATA_ENCRYPTION_KEY="$data_encryption_key" \
    "$IMAGE_NAME" >/dev/null
  wait_for_container_health "$candidate_container"

  echo -e "${GREEN}Upgrade check passed: ${PREVIOUS_VERSION#v} -> current checkout${NC}"
  cleanup_upgrade_check
  trap - EXIT INT TERM
}

show_status() {
  docker ps -a --filter "name=^/${CONTAINER_NAME}$"
  echo
  echo "Dashboard: $SLIPWAY_URL"
  echo "Secrets: $SLIPWAY_ENV_FILE"
  echo "Apps dir: $SLIPWAY_APPS_DIR"
  echo "DB dir: $SLIPWAY_DB_DIR"
}

open_shell() {
  docker exec -it "$CONTAINER_NAME" bash
}

destroy_local_state() {
  local local_state_path=""
  if [ -d "$LOCAL_ROOT" ]; then
    local_state_path="$(cd "$LOCAL_ROOT" && pwd -P)"
    # Never mount an installation parent or the operator's home for recursive
    # ownership recovery, even if a local-root override was configured wrongly.
    case "$ROOT_DIR/" in
      "$local_state_path/"*) echo "Refusing to destroy an installation parent." >&2; return 1 ;;
    esac
    if [ "$local_state_path" = "/" ] || [ "$local_state_path" = "$HOME" ]; then
      echo "Refusing to destroy an unsafe local state directory." >&2
      return 1
    fi
  fi
  remove_container
  docker volume rm -f "$NODE_MODULES_VOLUME" "$NPM_CACHE_VOLUME" >/dev/null 2>&1 || true
  if ! rm -rf -- "$LOCAL_ROOT" 2>/dev/null; then
    # Root-owned 0700 state (including Quest history) must stay private during
    # normal operation. Recover ownership only for this explicit local destroy,
    # inside a container with no network or Docker socket and one bounded mount.
    echo "Recovering ownership of container-created local state..."
    docker run --rm --network none --user 0:0 \
      --mount "type=bind,source=$local_state_path,target=/local-state" \
      --entrypoint chown "$IMAGE_NAME" \
      --no-dereference -R -P "$(id -u):$(id -g)" /local-state
    rm -rf -- "$LOCAL_ROOT"
  fi
  docker network rm "$NETWORK_NAME" >/dev/null 2>&1 || true
}

main() {
  ensure_docker

  case "$COMMAND" in
    install|rebuild)
      echo "Installing Slipway locally..."
      ensure_local_directories
      load_or_generate_secrets
      ensure_network
      ensure_volumes
      build_local_image
      ensure_container_dependencies
      remove_container
      run_local_slipway
      wait_for_health
      echo
      echo -e "${GREEN}========================================================${NC}"
      echo -e "${GREEN}  Slipway local is ready${NC}"
      echo -e "${GREEN}========================================================${NC}"
      echo
      echo "  Dashboard: $SLIPWAY_URL"
      echo "  Logs: npm run local:logs"
      echo "  Shell: npm run local:shell"
      echo "  Stop: npm run local:stop"
      echo "  Down: npm run local:down"
      echo "  Destroy: npm run local:destroy"
      echo
      ;;
    upgrade-check)
      check_upgrade_from_previous_release
      ;;
    stop)
      stop_container
      echo -e "${GREEN}Stopped ${CONTAINER_NAME}${NC}"
      ;;
    down)
      remove_container
      echo -e "${GREEN}Removed ${CONTAINER_NAME}${NC}"
      ;;
    destroy)
      destroy_local_state
      echo -e "${GREEN}Destroyed local Slipway state${NC}"
      ;;
    logs)
      docker logs -f "$CONTAINER_NAME"
      ;;
    status)
      show_status
      ;;
    shell)
      open_shell
      ;;
    *)
      usage
      exit 1
      ;;
  esac
}

main
