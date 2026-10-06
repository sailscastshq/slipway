#!/usr/bin/env bash
# Disposable Linux CI only. Build source as the coordinated version without
# changing the repository version or publishing any release/artifact registry.
set -euo pipefail
context=$(mktemp -d)
registry="slipway-fixture-registry-${GITHUB_RUN_ID:-local}-$$"
cleanup() { rm -rf "$context"; docker rm -f "$registry" >/dev/null 2>&1 || true; }
trap cleanup EXIT
tar --exclude=.git --exclude=node_modules --exclude=.tmp -cf - . | tar -xf - -C "$context"
python3 - "$context" <<'PY'
import json,sys,pathlib
root=pathlib.Path(sys.argv[1])
for name in ['package.json','package-lock.json']:
 p=root/name;v=json.loads(p.read_text());v['version']='0.0.88'
 if 'packages' in v:v['packages']['']['version']='0.0.88'
 p.write_text(json.dumps(v))
PY
docker build -t slipway-full-upgrade-fixture:88 "$context"
docker run -d --name "$registry" -p 127.0.0.1::5000 registry:2 >/dev/null
port=$(docker port "$registry" 5000/tcp | sed 's/.*://')
tag="localhost:$port/slipway-full-fixture:88"
docker tag slipway-full-upgrade-fixture:88 "$tag"
docker push "$tag" >/dev/null
identity=$(docker image inspect --format '{{index .RepoDigests 0}}' "$tag")
sudo env PATH="$PATH" SLIPWAY_FULL_IMAGE_FIXTURE=1 SLIPWAY_FULL_IMAGE="$identity" SLIPWAY_FULL_IMAGE_DIAGNOSTICS="${RUNNER_TEMP:-$PWD/.tmp}/upgrade-full-image-diagnostics" node --test tests/prelift/upgrade-full-image.test.cjs
