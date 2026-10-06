#!/usr/bin/env bash
# Produces a local artifact only; never publishes or installs it.
set -euo pipefail
destination="${1:?Pass an output archive path}"
revision="${2:?Pass the exact source revision}"
docker pull node:22-bookworm >/dev/null
builder="$(docker image inspect --format '{{index .RepoDigests 0}}' node:22-bookworm)"
[[ "$builder" =~ ^(node|docker.io/library/node)@sha256:[a-f0-9]{64}$ ]] || exit 2
tag="slipway-host-build-$$"
container="slipway-host-export-$$"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; docker image rm "$tag" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker build -f Dockerfile.upgrade-host --build-arg "BUILDER_IMAGE=$builder" --build-arg "SOURCE_REVISION=$revision" -t "$tag" .
docker create --name "$container" "$tag" >/dev/null
docker cp "$container:/slipway-host.tar.gz" "$destination"
sha256sum "$destination" > "$destination.sha256"
