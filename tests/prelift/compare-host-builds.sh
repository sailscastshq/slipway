#!/usr/bin/env bash
# Disposable Linux x64 proof. Artifacts remain local; only redacted evidence is retained.
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
revision="$(git rev-parse HEAD)"
workspace="$(mktemp -d)"
trap 'sudo rm -rf "$workspace"' EXIT
for iteration in first second; do
  SLIPWAY_HOST_BUILD_NO_CACHE=1 bash scripts/build-upgrade-host.sh "$workspace/$iteration.tar.gz" "$revision"
  checksum="$(sha256sum "$workspace/$iteration.tar.gz" | cut -d' ' -f1)"
  sudo bash scripts/upgrade-host-native.sh verify --bundle "$workspace/$iteration.tar.gz" --bundle-sha256 "$checksum" --state-dir "$workspace/$iteration-verify"
  mkdir "$workspace/$iteration"
  tar -xzf "$workspace/$iteration.tar.gz" -C "$workspace/$iteration"
done
node - "$workspace" "$root" <<'NODE'
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const [directory, root] = process.argv.slice(2)
const first = JSON.parse(fs.readFileSync(path.join(directory, 'first/host-manifest.json')))
const second = JSON.parse(fs.readFileSync(path.join(directory, 'second/host-manifest.json')))
const sha = name => crypto.createHash('sha256').update(fs.readFileSync(path.join(directory, name))).digest('hex')
const changed = first.files.filter(file => second.files.find(item => item.path === file.path)?.sha256 !== file.sha256).map(file => file.path)
for (const file of second.files) if (!first.files.some(item => item.path === file.path)) changed.push(file.path)
const evidence = {
  format: 1, sourceRevision: first.sourceRevision, builderImage: first.builderImage,
  sourceDateEpoch: first.sourceDateEpoch, packageLockSha256: first.packageLockSha256,
  platform: first.platform, arch: first.arch, nodeVersion: first.nodeVersion, modules: first.modules,
  glibcMinimum: first.glibcMinimum, verifiedBuilds: 2,
  firstArchiveSha256: sha('first.tar.gz'), secondArchiveSha256: sha('second.tar.gz'),
  manifestsEqual: JSON.stringify(first) === JSON.stringify(second), changedFiles: changed,
  arm64Verified: false
}
evidence.reproducible = evidence.firstArchiveSha256 === evidence.secondArchiveSha256 && evidence.manifestsEqual
fs.writeFileSync(path.join(root, 'host-reproducibility.json'), JSON.stringify(evidence, null, 2) + '\n')
console.log(JSON.stringify(evidence))
if (!evidence.reproducible) process.exitCode = 1
NODE
