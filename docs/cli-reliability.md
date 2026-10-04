# CLI reliability contracts

This slice uses the existing authenticated REST and guarded Helm APIs. It adds seven commands and the `exec` alias for `run`; it does not introduce a second execution engine. Every registered command and alias supports command-specific `--help` without authentication or prompts. `slipway --help` remains global help. Unknown commands/options exit 1, with structured stderr when `--json` or `--ndjson` is requested.

## Targets and machine output

Pass `--project`, `--env`, and `--app` for scripts. A linked directory can supply the project, and the environment defaults to `production`. `app:inspect`, `app:restart`, `run:history`, and `run:arm` require an explicit app. An unknown app fails rather than choosing another app. `apps --app` filters the selected app.

The new commands accept mutually exclusive `--json` and `--ndjson`. Each emits one JSON result to stdout; errors emit `{ "type": "error", "error": { "code", "message", "status"? } }` to stderr and exit 1. `run --ndjson` streams the existing execution events. A confirmed command exit code from 1 through 255 is preserved. Transport uncertainty exits 1 and must be investigated before a retry.

```sh
slipway apps --project example --env staging --json
slipway app:inspect --project example --env staging --app web --json
slipway app:restart --project example --env staging --app web \
  --approve-target example/staging/web --json
```

Inspection/listing whitelist app metadata and resource limits; they omit environment variables and credentials. Restart requires an exact target approval string, then invokes the existing synchronous restart endpoint. A lost response is reported as `RESTART_UNCONFIRMED`; the CLI does not automatically retry.

## Health, authentication, and readiness

```sh
slipway doctor --project example --env staging --app web --json
```

Doctor checks public `/health`, validates the saved CLI token by reading the authenticated project list, and optionally requests the existing deployment-readiness report. Its readiness check succeeds only when `canDeploy` is true. This describes deployment prerequisites; it does not certify application availability. Any failed check exits 1. Doctor does not infer fresh user identity from cached `whoami` data.

The current CLI reads its saved credential store. It does not accept `SLIPWAY_TOKEN` as an environment variable. The server accepts CLI tokens through its existing authentication policy; advertised deploy-token scopes do not establish deploy-token authentication support. This slice leaves authentication policy unchanged.

## Cancellation and retained history

```sh
slipway run:cancel EXECUTION_UUID --json
slipway run:history --project example --env staging --app web --json
```

Cancellation exits 0 only for `{ "cancelled": true }`, which the server returns after confirmed command termination. A false result exits 1: it can mean unknown, completed, unavailable, unowned, or unconfirmed execution. The CLI cannot distinguish those states. Live execution lookup is process-local on the server.

History returns retained per-user app command metadata with `executionLookup: false`. A history row's `id` is not an execution UUID. The CLI omits stored command source and does not claim to retrieve logs, results, a durable execution ledger, or replay capability.

## Private client receipts

```sh
slipway run --project example --env staging --app web \
  --file command.txt --receipt-file receipt.json --json
```

The CLI exclusively creates a mode-0600 receipt before submitting the command; it refuses existing paths and symlinks. The receipt records its generated execution UUID, creation time, accepted target metadata, and terminal outcome metadata as events arrive. It omits command source, streamed output, and write-arm tokens. Rejections and interrupted/lost streams mark the receipt accordingly. A receipt is a local snapshot, not server-side durability or permission to retry. A crash can leave an incomplete snapshot.

## Explicit guarded arming

Review the exact command and target before requesting the existing production write capability:

```sh
slipway run:arm --project example --env production --app web \
  --approve-target example/production/web --file command.txt \
  --output command.arm --json
slipway run --project example --env production --app web \
  --file command.txt --write-arm-file command.arm \
  --receipt-file receipt.json --json
```

The server retains owner/admin authorization, the configured 60-second expiry, single use, and binding to the exact command hash and deployment fingerprint. The CLI stores the capability only in a newly created mode-0600 file and prints expiry/hash/target metadata. It never automatically arms, renews, or replays a command. A failed arming request can leave an empty private file; inspect the failure before choosing a new output path.

Both `run` and `run:arm` support `--file` or `--stdin`, mutually exclusive with positional command text. Input is bounded to 64 KiB. Prefer these inputs to avoid command text in process arguments. `terminal` still prints manual connection instructions; it does not provide an interactive terminal transport.

## Validation scope

Fixture tests cover all registered help/alias dispatch, malformed invocation exit status, explicit target rejection, secret redaction, approved restart and uncertain responses, cancellation truthfulness, metadata-only history, server-denied arming, private file permissions and overwrite rejection, receipt event updates, health/authentication/readiness failures, and split SSE/NDJSON delivery. They perform no real production operations or capability creation.
