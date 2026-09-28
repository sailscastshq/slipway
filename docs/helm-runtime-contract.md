# Helm runtime contract

Helm runs a short-lived Node process inside the selected app container. It
loads a temporary Sails instance so a cancelled or timed-out snippet cannot
leave its execution process running. The temporary instance must use the
deployed app's environment and datastore, never development defaults.

Starting with `sails-hook-slipway` 0.0.11, the running app writes a contract
after helpers load, refreshes it when ORM loads and when Sails is ready, in
`/tmp/slipway-helm-runtimes/`. This supports both web apps and workers that
call `sails.load()` without lifting an HTTP server. The file names the app,
deployment, PID, Linux process start tick, executable, working directory, and
argument offset. Helm reads actual launch arguments from that verified live
process when needed; they are not stored in the contract. The file contains fingerprints of the startup environment and
effective datastore selection, plus bounded autocomplete metadata (model,
helper, and config names/types). It contains no environment values, datastore
URLs, credentials, or result values. Files are mode 0600 and are removed on
normal shutdown. The directory lives in the app container, not in Slipway's
database or the image.

Slipway injects `SLIPWAY_APP_ID` and `SLIPWAY_DEPLOYMENT_ID` for every new app
deployment, including rollback and worker-only apps. When Helm opens the
selected container, it checks the contract against those IDs, the live PID's
start tick, executable, working directory, and startup environment. A stale,
missing, changed, or ambiguous contract fails closed for an app that has
registered the new hook version. A deployment with an older hook keeps the
existing fail-closed `/proc` discovery until it is upgraded and redeployed.
Quest `sails run` child processes and Helm's own temporary Sails lift do not
register as the app runtime.

Autocomplete reads the live app's bounded, secret-free metadata snapshot
without starting Sails again. For older hooks or an oversized snapshot, it
uses the existing isolated Sails lift. Snippet execution still uses an
isolated lift, with migrations forced to `safe` and the second Quest scheduler
disabled. Before evaluating a snippet, Helm compares the lifted datastore
fingerprint with the one recorded by the running app. A mismatch stops the
execution before user code runs. Helm does not transmit the fingerprint or
its underlying credentials to the browser.

Applications can change `process.env` while Sails loads, but `/proc` exposes
only their launch environment. Helm now compares the hook's recorded
post-load environment fingerprint with the isolated Sails lift's post-load
fingerprint, before it runs operator code. Reproducible changes are accepted;
different effective environments fail closed. Applications that derive
datastore settings from non-reproducible runtime state likewise fail the
datastore comparison. Fix the startup configuration or run the operation as
an app-owned Quest job. A contract does not make arbitrary
user code safe: production write arming, timeouts, cancellation, bounded
output, and auditing still apply.

## Reproduce the performance comparison

`scripts/benchmark-helm-runtime.js` uses a small Sails/SQLite fixture. It
reports p50/p95 wall time and peak _child-process_ RSS for metadata-only
retrieval versus a cold Sails lift. It does not represent a specific
customer app, the parent app's memory, or total container memory.

Run it under the same Node image and memory limit as the target deployment.
For example, from the repository root with an image that has Sails, ORM, and
SQLite installed at `/app/node_modules`:

```sh
docker run --rm --memory=512m --entrypoint node \
  -e NODE_PATH=/app/node_modules \
  -e HELM_NODE_MODULES=/app/node_modules \
  -v "$PWD/api/lib:/host/api/lib:ro" \
  -v "$PWD/packages/hook:/host/packages/hook:ro" \
  -v "$PWD/scripts:/host/scripts:ro" \
  IMAGE /host/scripts/benchmark-helm-runtime.js
```

Use `--memory=1g` for the larger comparison. Observe `docker stats` while
running a real app and Helm together to measure container peak memory; the
fixture's process RSS alone cannot establish that headroom. Run real Helm
snippets and concurrent Quest jobs against a staging deployment before
changing a production memory limit.

On 2026-09-28, 12 samples of this fixture using the local `slipway-local`
image gave the following results. Each row measures one short-lived child
process; p95 with 12 samples is only a directional estimate.

| Limit   | Path              | p50 wall time | p95 wall time | Peak child RSS |
| ------- | ----------------- | ------------: | ------------: | -------------: |
| 512 MiB | Verified metadata |       17.0 ms |       18.2 ms |       41.6 MiB |
| 512 MiB | Cold Sails lift   |      310.6 ms |      326.1 ms |       82.0 MiB |
| 1 GiB   | Verified metadata |       15.4 ms |       16.6 ms |       41.6 MiB |
| 1 GiB   | Cold Sails lift   |      283.3 ms |      310.8 ms |       85.8 MiB |
