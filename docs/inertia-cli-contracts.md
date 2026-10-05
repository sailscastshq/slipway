# Inertia page mutations and CLI streams

The browser uses Inertia for app settings, environment settings, service resources,
service rename, app variables, environment variables, deploy-token revocation, and
private backup-storage Save. The existing controllers still return their JSON
contracts to REST clients. Authorization, validation, managed-variable protection,
secret storage, and auditing run once in those controllers.

Successful Inertia mutations return 303 to the same-origin referring page. Invalid
input returns field errors to that page. Network and HTTP failures retain local
edits and report an unconfirmed save. Save-and-restart reports a saved configuration
separately from a failed restart. Backup connection probes, one-time token creation,
streaming, uploads, binary responses, polling, and cleanup receipts retain their
existing transports.

## CLI examples

```sh
# Bounded application snapshot; no linked directory is needed.
slipway logs --project harbor --env staging --app worker --tail 200 --json

# Live logs for pipes. Ctrl-C exits 130.
slipway logs --project harbor --app worker --follow --ndjson

# Stored deployment build/deploy logs.
slipway logs --deployment DEPLOYMENT_ID --json

# Run through the existing guarded Helm command API.
printf '%s' 'node --version' | slipway run --project harbor --env staging --app worker --stdin --ndjson
slipway run --project harbor --env staging --file ./command.txt --json
```

`--project` overrides the linked `.slipway.json` project. `--env` defaults to
production. Omitting `--app` uses the server's default-app selection. An explicit
app never falls back to another app. CLI snapshot requests set `follow=false`;
existing browser streams continue following by default. Tail must be 0–10000.
JSON snapshots have a 16 MiB output bound; use NDJSON for larger outputs.

`run` accepts one command string, `--file`, or `--stdin`. For multiple positional
words the CLI joins them with spaces; quote the complete command when its internal
argument quoting matters. Helm parses and validates it, owns execution and audit,
and enforces production write arming. This CLI does not add a runner or an arming
bypass. An existing exact-command, exact-deployment arm may be supplied with
`--write-arm-file ./private-arm.txt`; its value is never printed or passed in argv.
An unarmed production command returns `HELM_WRITES_NOT_ARMED` and exit 1.

`run --ndjson` forwards accepted/output/result events. `run --json` returns one
execution ID and terminal result, without mixing progress or command output into
stdout. Human output sends remote stdout and stderr to their corresponding local
streams. A confirmed nonzero command exit is propagated (1–255); absent/unconfirmed
outcomes fail with exit 1 and must be investigated before replay. Interrupting a
run fails conservatively; it does not claim confirmed remote termination.

Request and usage errors in either machine mode are JSON records on stderr:

```json
{
  "type": "error",
  "error": {
    "code": "HELM_WRITES_NOT_ARMED",
    "message": "Every production command requires a single-use write arm for this exact command and deployment.",
    "status": 409
  }
}
```

Machine modes are mutually exclusive. `logs --json --follow` is rejected; use
NDJSON. Snapshot requests time out after 30 seconds, runs after ten minutes.
Streams ending without the required close/result receipt fail. Neither logs nor
run prompts for a target or opens the dashboard.

## Bounded coverage

The initial slice moved eight browser mutation flows to Inertia and two print-only
CLI commands. The remaining cleanup adds 17 saved-record operations: environment
domain, Bosun variables, Wake settings and visitor deletion, external PostgreSQL
registration and connection settings, custom service app links, release-flag CRUD,
six Helm history/snippet mutations, and public feedback votes. This makes 25
converted browser mutation flows overall. Built-in service creation and reviewed
custom service creation retain REST because they start containers and return
operational receipts. External registration performs no runtime work and uses
Inertia in the browser while keeping its REST 201 response.

Creation adapters preserve 201 JSON payloads. Visitor deletion returns the surviving
Wake journeys page. Vote confirmation carries only the public vote receipt;
optimistic rollback, login redirects, and live announcements remain. Stale selected
apps remain visible for deselection after failed validation. Confirmed external
connection saves clear local DSN and CA inputs. Helm reads and commands stay on REST.

Interactive `terminal`, broader app lifecycle, profiles/doctor, async
operation replay, and Dock/Quest CLI workflows remain separate work. No claim of
complete dashboard/CLI parity is made.
