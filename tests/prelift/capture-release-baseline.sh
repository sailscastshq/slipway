#!/usr/bin/env bash
# Linux CI only: genuine published images, disposable volumes, no candidate
# startup and no live-volume adoption. Stop every fixture writer before capture.
set -euo pipefail
version="${1:?Pass 0.0.86 or 0.0.87}"
output="${2:?Pass an output filename}"
case "$version" in 0.0.86|0.0.87) ;; *) exit 2 ;; esac
root="$(git rev-parse --show-toplevel)"
suffix="${GITHUB_RUN_ID:-local}-$$"
container="slipway-baseline-${suffix}"
volume="slipway-baseline-db-${suffix}"
apps="slipway-baseline-apps-${suffix}"
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  docker volume rm "$volume" "$apps" >/dev/null 2>&1 || true
}
trap cleanup EXIT
image="ghcr.io/sailscastshq/slipway:${version}"
docker pull "$image" >/dev/null
identity="$(docker image inspect --format '{{index .RepoDigests 0}}' "$image")"
docker volume create "$volume" >/dev/null
docker volume create "$apps" >/dev/null
# Synthetic fixture settings are not real account credentials. The legacy
# installer seeds new databases through development ORM setup before safe boot.
for mode in development production; do
  docker run -d --name "$container" \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v "$volume:/app/db" -v "$apps:/var/slipway/apps" \
    -e "NODE_ENV=$mode" -e PORT=1337 \
    -e "SLIPWAY_URL=http://${container}:1337" \
    -e SESSION_SECRET=disposable-baseline-fixture-only \
    -e DATA_ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= \
    "$identity" node app.js >/dev/null
  ready=false
  for attempt in $(seq 1 90); do
    if docker exec "$container" curl -fsS http://localhost:1337/health >/dev/null 2>&1; then
      ready=true
      break
    fi
    sleep 2
  done
  if [ "$ready" != true ]; then
    echo "Disposable release baseline failed health: $version/$mode" >&2
    exit 1
  fi
  docker stop --time 30 "$container" >/dev/null
  docker rm "$container" >/dev/null
done
# Require the current reader through NODE_PATH, but run against the old native
# SQLite dependency and its read-only mounted volume. SQLite may need transient
# WAL shared-memory files even for read-only connections, so inspect a private
# copy containing all sidecars. The original volume stays read-only throughout.
# No Sails lift occurs here.
docker run --rm --network none \
  -v "$volume:/fixture-db:ro" -v "$root:/capture:ro" \
  -e NODE_PATH=/app/node_modules \
  "$identity" sh -c '
    mkdir /tmp/baseline-copy
    cp -a /fixture-db/. /tmp/baseline-copy/
    exec node /capture/tests/prelift/capture-release-baseline.cjs /tmp/baseline-copy "$1" "$2"
  ' sh "$version" "$identity" > "$output"
