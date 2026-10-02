#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
baseline=2c9be311e68e07b0c9906a089771089226bc5595
current=$(git rev-parse HEAD)
artifact=.tmp/screenshots/helm-terminal-prompt
backup=$(mktemp -d)
components=(HelmCommandConsole.vue HelmWriteGuardDialog.vue)

# This is a disposable CI-checkout comparison, not a baseline branch checkout.
# Both trials use the same current backend, fixtures, lockfile and capture test.
# Preserve even uncommitted component bytes and restore before any current tests.
for component in "${components[@]}"; do
  cp "assets/js/components/$component" "$backup/$component"
done
restore() {
  for component in "${components[@]}"; do
    cp "$backup/$component" "assets/js/components/$component" || return
  done
  rm -rf "$backup"
}
trap restore EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir -p "$artifact"
git cat-file -e "$baseline^{commit}"
for component in "${components[@]}"; do
  git show "$baseline:assets/js/components/$component" > "assets/js/components/$component"
done
HELM_PROMPT_VARIANT=baseline HELM_PROMPT_SOURCE_REVISION="$baseline" \
  node_modules/.bin/sounding test --file tests/contracts/helm-terminal-prompt.test.js \
  --test-concurrency=1 --test-timeout=600000 | tee "$artifact/baseline.log"

for component in "${components[@]}"; do
  cp "$backup/$component" "assets/js/components/$component"
  cmp "$backup/$component" "assets/js/components/$component"
done
HELM_PROMPT_VARIANT=current HELM_PROMPT_SOURCE_REVISION="$current" \
  node_modules/.bin/sounding test --file tests/contracts/helm-terminal-prompt.test.js \
  --test-concurrency=1 --test-timeout=600000 | tee "$artifact/current.log"

node scripts/summarize-helm-terminal-prompt.js "$artifact"
