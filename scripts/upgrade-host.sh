#!/usr/bin/env bash
# One-time 0.0.86/0.0.87 -> coordinated release upgrade. No credentials on argv.
# Inspect plan first; apply requires its exact instance and review hash.
set -euo pipefail
umask 077
operation="${1:-}"
if [ "$#" -gt 0 ]; then shift; fi
image=""
instance=""
approval=""
container="slipway"
checkpoint=""
directory="/var/lib/slipway/upgrades"
while [ "$#" -gt 0 ]; do
  if [ "$#" -lt 2 ] || [ -z "$2" ] || [[ "$2" == --* ]]; then
    printf '%s\n' '{"success":false,"code":"upgradeHostInput"}' >&2
    exit 2
  fi
  case "$1" in
    --image) image="${2:?Missing image}" ;;
    --instance) instance="${2:?Missing instance}" ;;
    --approve-plan) approval="${2:?Missing review hash}" ;;
    --container) container="${2:?Missing container}" ;;
    --checkpoint) checkpoint="${2:?Missing checkpoint}" ;;
    --state-dir) directory="${2:?Missing state directory}" ;;
    *) printf '%s\n' '{"success":false,"code":"upgradeHostInput"}' >&2; exit 2 ;;
  esac
  shift 2
done
case "$operation" in plan|apply|initialize|status|resume) ;; *) printf '%s\n' '{"success":false,"code":"upgradeHostInput"}' >&2; exit 2 ;; esac
if [ "$(id -u)" != 0 ] || [ "$(uname -s)" != Linux ] || [[ ! "$image" =~ ^ghcr\.io/sailscastshq/slipway@sha256:[a-f0-9]{64}$ ]]; then
  printf '%s\n' '{"success":false,"code":"upgradeHostEnvironment"}' >&2
  exit 2
fi
if { [ "$operation" = apply ] || [ "$operation" = resume ]; } && { [ -z "$instance" ] || [ -z "$approval" ]; }; then
  printf '%s\n' '{"success":false,"code":"upgradeHostApproval"}' >&2
  exit 2
fi
case "$directory" in /*) ;; *) printf '%s\n' '{"success":false,"code":"upgradeHostInput"}' >&2; exit 2 ;; esac
mkdir -p "$directory"
chmod 700 "$directory"
if [ "$operation" = resume ] || [ "$operation" = status ]; then
  export SLIPWAY_HOST_CHECKPOINT_LOOKUP="$checkpoint" SLIPWAY_HOST_STATE_LOOKUP="$directory"
  container="$(python3 - <<'PYLOOKUP'
import json, os, stat
filename=os.environ['SLIPWAY_HOST_CHECKPOINT_LOOKUP']
root=os.path.realpath(os.environ['SLIPWAY_HOST_STATE_LOOKUP'])
if not os.path.realpath(filename).startswith(root+os.sep): raise SystemExit(2)
s=os.lstat(filename)
if not stat.S_ISREG(s.st_mode) or s.st_uid != 0 or stat.S_IMODE(s.st_mode) != 0o600: raise SystemExit(2)
value=json.load(open(filename))['state']['reviewed']['containerId']
if len(value)!=64 or any(c not in '0123456789abcdef' for c in value): raise SystemExit(2)
print(value)
PYLOOKUP
)"
fi
docker pull "$image" >/dev/null
source_dir="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/app/db"}}{{.Source}}{{end}}{{end}}' "$container")"
case "$source_dir" in /*) ;; *) exit 2 ;; esac
source_readonly=",readonly"
if [ "$operation" = initialize ]; then source_readonly=""; fi
controller="slipway-upgrade-controller-$(cat /proc/sys/kernel/random/uuid)"
# Pass only target/approval metadata via environment to a fixed JSON encoder.
# Existing session and encryption secrets remain in Docker's structured config.
export SLIPWAY_HOST_OPERATION="$operation" SLIPWAY_HOST_IMAGE="$image" SLIPWAY_HOST_INSTANCE="$instance" SLIPWAY_HOST_APPROVAL="$approval" SLIPWAY_HOST_CONTAINER="$container" SLIPWAY_HOST_CHECKPOINT="$checkpoint" SLIPWAY_HOST_DIRECTORY="$directory" SLIPWAY_HOST_CONTROLLER="$controller"
python3 - <<'PY' | docker run --rm -i --name "$controller" --restart=no --pid=host --cap-add=SYS_PTRACE --entrypoint=node --network=none \
  --mount "type=bind,src=/,dst=/slipway-host,readonly,bind-propagation=rslave" \
  --mount "type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock" \
  --mount "type=bind,src=$source_dir,dst=$source_dir$source_readonly" \
  --mount "type=bind,src=$directory,dst=$directory" \
  "$image" scripts/upgrade-host.cjs
import json, os
mapping = {'operation':'OPERATION','image':'IMAGE','instanceId':'INSTANCE','approval':'APPROVAL','container':'CONTAINER','filename':'CHECKPOINT','directory':'DIRECTORY','controllerContainer':'CONTROLLER'}
print(json.dumps({key:os.environ['SLIPWAY_HOST_'+value] for key,value in mapping.items()}))
PY
