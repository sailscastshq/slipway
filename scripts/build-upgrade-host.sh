#!/usr/bin/env bash
# Local artifact only. Exact committed source and frozen Linux x64 inputs.
set -euo pipefail
destination="${1:?Pass an output archive path}"
revision="${2:?Pass the exact source revision}"
[[ "$revision" =~ ^[a-f0-9]{40}$ ]] || exit 2
root="$(git rev-parse --show-toplevel)"
inputs="$root/scripts/upgrade-host-build-inputs.json"
builder="$(node -p 'require(process.argv[1]).builderImage' "$inputs")"
platform="$(node -p 'require(process.argv[1]).platform' "$inputs")"
epoch="$(git show -s --format=%ct "$revision")"
context="$(mktemp -d)"
tag="slipway-host-build-$$"
container="slipway-host-export-$$"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; docker image rm "$tag" >/dev/null 2>&1 || true; rm -rf "$context"; }
trap cleanup EXIT
git archive "$revision" | tar -xf - -C "$context"
# Inputs are part of the selected revision, never an ambient worktree override.
cmp "$inputs" "$context/scripts/upgrade-host-build-inputs.json"
docker pull --platform "$platform" "$builder" >/dev/null
options=()
if [[ "${SLIPWAY_HOST_BUILD_NO_CACHE:-0}" = 1 ]]; then options+=(--no-cache); fi
docker build "${options[@]}" --platform "$platform" -f "$context/Dockerfile.upgrade-host" \
  --build-arg "BUILDER_IMAGE=$builder" --build-arg "SOURCE_REVISION=$revision" \
  --build-arg "SOURCE_DATE_EPOCH=$epoch" -t "$tag" "$context"
docker create --platform "$platform" --name "$container" "$tag" >/dev/null
docker cp "$container:/slipway-host.tar.gz" "$destination"
sha256sum "$destination" > "$destination.sha256"
