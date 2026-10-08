#!/usr/bin/env bash
# Explicit Linux/Docker operator recovery. Never run as an automatic startup fix.
set -euo pipefail
umask 077
if [[ $# != 3 || $3 != --reset-observability ]]; then
  echo 'Usage: recover-slipway.sh IMAGE HOST_SQLITE_RECOVERY_BINARY|--logical-app --reset-observability' >&2
  exit 2
fi
command -v fuser >/dev/null
health_attempts=${SLIPWAY_RECOVERY_HEALTH_ATTEMPTS:-90}
[[ $health_attempts =~ ^[0-9]+$ && $health_attempts -ge 1 && $health_attempts -le 180 ]]
container=${SLIPWAY_RECOVERY_CONTAINER:-slipway}
[[ $container =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]+$ ]]
image=$1
if [[ $2 == --logical-app ]]; then
  recovery_args=(--logical-app)
else
  sqlite_tool=$(realpath "$2")
  [[ -x $sqlite_tool ]]
  recovery_args=(--sqlite /recovery/sqlite3-recovery)
fi
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
[[ $(uname -s) == Linux && $EUID == 0 ]]
[[ $(docker context inspect --format '{{.Endpoints.docker.Host}}') == unix://* ]]
docker image inspect "$image" >/dev/null # Pull explicitly before downtime.
[[ $(docker inspect --format '{{.State.Running}}' "$container") == true ]]
live=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/app/db"}}{{.Source}}{{end}}{{end}}' "$container")
[[ -d $live && -f $live/app.db ]]
work=$(mktemp -d "${SLIPWAY_RECOVERY_ROOT:-/root}/slipway-recovery-XXXXXX")
printf 'Recovery directory: %s\n' "$work"
if [[ $2 != --logical-app ]]; then cp -- "$sqlite_tool" "$work/sqlite3-recovery"; fi
docker inspect "$container" > "$work/container-before.json"
# This file includes environment secrets. Keep the complete recovery tree private.
stopped=false
installing=false
marker="$live/.slipway-recovery-in-progress"
[[ ! -e $marker ]]
rollback() {
  status=$?
  trap - EXIT INT TERM
  if "$installing"; then
    docker stop "$container" >/dev/null 2>&1 || true
    # Originals stay untouched; partial new files/journals are quarantined.
    mkdir -p "$work/failed-install"
    for file in app.db observability.db analytics.db stash.db; do
      for suffix in '' -wal -shm -journal; do
        target="$live/$file$suffix"
        if [[ -e $target ]]; then mv -- "$target" "$work/failed-install/$file$suffix"; fi
        if [[ -e $work/original/$file$suffix ]]; then cp -a -- "$work/original/$file$suffix" "$target"; fi
      done
    done
    rm -f -- "$marker"
    echo 'Recovered installation did not become healthy; original database files restored.' >&2
  fi
  if "$stopped"; then docker start "$container" >/dev/null || echo "Restart failed: run docker start $container and inspect its logs." >&2; fi
  exit "$status"
}
trap rollback EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

docker stop --time 60 "$container" >/dev/null
stopped=true
# Reject other Docker writers using overlapping host storage paths.
ids=$(docker ps -q)
if [[ -n $ids ]]; then docker inspect $ids > "$work/running.json"; else echo '[]' > "$work/running.json"; fi
operator_id=''
if [[ -f /.dockerenv && $(hostname) =~ ^[a-f0-9]{12,64}$ ]]; then operator_id=$(hostname); fi
docker run --rm --network none -e "RECOVERY_OPERATOR_ID=$operator_id" -v "$work:/recovery" "$image" node -e '
 const fs=require("fs"),path=require("path");
 const self=JSON.parse(fs.readFileSync("/recovery/container-before.json"))[0];
 const source=self.Mounts.find(m=>m.Destination==="/app/db").Source;
 const overlaps=(a,b)=>a===b||a.startsWith(b+"/")||b.startsWith(a+"/");
 const others=JSON.parse(fs.readFileSync("/recovery/running.json"));
 const operator=process.env.RECOVERY_OPERATOR_ID;
 if(others.some(c=>(!operator||!c.Id.startsWith(operator))&&c.Mounts.some(m=>m.RW&&m.Source&&overlaps(path.resolve(m.Source),path.resolve(source)))))
   throw Error("Another container can write the database volume; recovery stopped");
'
if fuser -s "$live/app.db" "$live/observability.db" "$live/analytics.db" "$live/stash.db" 2> "$work/fuser-errors.log"; then
  echo 'Another host process has a database open; recovery stopped.' >&2
  exit 1
fi
if [[ -s $work/fuser-errors.log ]]; then
  echo 'Could not verify open host database handles; recovery stopped. Inspect the private fuser-errors.log.' >&2
  exit 1
fi
# Complete cold snapshot includes WAL/journals, keys, and unrelated volume files.
cp -a -- "$live" "$work/snapshot"
run_doctor() {
  docker run --rm --network none \
    -v "$work:/recovery" \
    -v "$script_dir/slipway-database.cjs:/app/bin/slipway-database.cjs:ro" \
    "$image" node bin/slipway-database.cjs "$@"
}
run_doctor prepare --source /recovery/snapshot --output /recovery/candidate \
  "${recovery_args[@]}" --reset-observability > "$work/prepare-report.json"
# Migrates only a second copy. Its generated receipt paths use the final /app/db.
cp -a "$work/candidate" "$work/validation"
docker run --rm --network none \
  -v "$work/validation:/app/db" \
  -v "$script_dir/slipway-database.cjs:/app/bin/slipway-database.cjs:ro" \
  "$image" node bin/slipway-database.cjs migrate --directory /app/db > "$work/migration-report.json"
# Install the original-schema candidates, not the migrated validation copies.
# This keeps the installed old server compatible until the normal update.
mkdir "$work/original"
for file in app.db observability.db analytics.db stash.db; do
  for suffix in '' -wal -shm -journal; do
    if [[ -e $live/$file$suffix ]]; then cp -a -- "$live/$file$suffix" "$work/original/$file$suffix"; fi
  done
  cp -- "$work/candidate/$file" "$live/$file.recovery-next"
  chmod --reference="$live/$file" "$live/$file.recovery-next"
  chown --reference="$live/$file" "$live/$file.recovery-next"
done
printf '%s\n' "$work" > "$marker"
installing=true
for file in app.db observability.db analytics.db stash.db; do
  for suffix in -wal -shm -journal; do
    if [[ -e $live/$file$suffix ]]; then mv -- "$live/$file$suffix" "$work/original/retired-$file$suffix"; fi
  done
  mv -- "$live/$file.recovery-next" "$live/$file"
done
# All replacements are complete before startup is admitted. The trap remains
# armed until health succeeds, so a normal startup failure still restores originals.
sync
rm -f -- "$marker"
sync
docker start "$container" >/dev/null
healthy=false
for attempt in $(seq 1 "$health_attempts"); do
  if docker exec "$container" curl -fsS --max-time 3 http://localhost:1337/health > "$work/health.json"; then
    if docker run --rm --network none -v "$work:/recovery:ro" "$image" node -e '
      const h=JSON.parse(require("fs").readFileSync("/recovery/health.json"));if(h.status!=="ok"||h.mode==="preflight")process.exit(1)'; then
      healthy=true; break
    fi
  fi
  sleep 2
done
"$healthy"
rm -f -- "$marker"
installing=false
stopped=false
trap - EXIT INT TERM
printf 'Recovery verified; Slipway restarted. Evidence and originals: %s\n' "$work"
printf 'Observability history was reset. Use the normal Update flow for the patched release.\n'
