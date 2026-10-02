# Helm non-interactive command runtime

Command mode runs one executable and its argument vector inside the selected
running app container. It does not start an interactive shell, allocate a TTY,
or provide stdin to the command. Quoting groups arguments; there is no implicit
shell expansion or package download. `sails` resolves the app's installed Sails
CLI directly. In production, all commands require a command-specific write arm;
JavaScript mutation analysis cannot determine their effects. Command mode is available to team owners and administrators. Command source is retained in user-scoped history; output is transient. Keep secrets in the app environment, not command arguments.

The byte and time budgets bound execution output and duration, not hostile CPU or memory usage. Existing container resource limits still apply; command mode is not a resource-isolation sandbox.

## Terminal prompt

Type one command and press **Enter**. The small return-key control submits the
same command for touch and keyboard users. In production, Enter first opens the
arming confirmation. Arming restores focus to the prompt but does not execute:
press Enter again for the single approved attempt. Repeating a completed command
requires a fresh production arm.

Held Enter, composition confirmation and modified Enter do not submit. Pasting
or dropping multiple lines is rejected before the browser can silently join
them. Edit or paste a single-line command to clear the error before submitting;
the rejected transfer also clears any production arm. The prompt keeps native
selection, cursor movement and editing. It does not provide shell expansion,
interactive stdin, or a second terminal session.

Stop and the observed command status remain separate from submission. A compact
prompt does not change admission, cancellation, history or runtime authority.

## Runtime selection and supported Sails scripts

Commands require a current, verified Helm runtime contract, published by
`sails-hook-slipway` 0.0.11 or later. An older app must upgrade its hook and
redeploy before using command mode. The JavaScript compatibility path is
unchanged. The selected app/deployment IDs, live process start time, executable,
cwd and startup environment must match the contract. No alternate app/container
or development configuration is guessed when verification fails.

The Docker exec process must have the same real/effective/saved user and group
IDs, supplementary groups, Linux capabilities and `NoNewPrivs` state as the
resident app. An identity mismatch fails closed before spawning the command;
Helm does not change machine accounts or silently run with broader privileges.
The app should run directly as its configured image user.

Ordinary executables inherit the verified app's **startup** environment and
working directory. Linux `/proc` does not expose later `process.env` mutations.
For `sails run`, Helm also reproduces the selected app's argv-derived Sails
configuration and verifies its effective environment/datastore fingerprints
before invoking the script function.

The managed Sails integration currently supports exactly **Sails 1.5.18 and
whelk 6.0.2**, as pinned by the native-CLI contract tests. Other versions fail with
an explicit unsupported-version error; Helm does not install or upgrade them.
The installed CLI retains script lookup, typed/positional input parsing,
validation, custom exits, error reporting, Sails load and lower lifecycle.
A one-use wrapper around that CLI's whelk definition changes only the selected
Sails instance's `getRc()` and the selected script's function:

- Sails configuration is read with the resident app's launch argv, rather than
  treating script input flags as datastore/environment overrides
- `safe: true` and `models.migrate: 'safe'` prevent Sails' `--drop`/`--alter`
  convenience flags from enabling automatic migrations
- `quest.autoStart: false` prevents a temporary second Quest scheduler
- Immediately before the script function, the safety settings and both runtime
  fingerprints must still match

Package.json shell aliases, `sails:false`, non-Sails habitats and nested whelk
`def` wrappers are unsupported because they bypass the verified lifecycle.
Use a normal app-owned Sails script module. Normal configuration/module loading
and hook initialization still execute, as they do in native `sails run`;
script-module top-level code is not sandboxed or delayed by the function guard.
Command mode is an operator capability, not an isolation/security sandbox.

## Cancellation and completion evidence

The host keeps a private control pipe to an in-container supervisor. The
supervisor does not spawn the command until it receives an explicit `start`.
Cancellation before that handshake cannot race a late PID-file registration.
The supervisor also cancels on control EOF/error and has its own deadline,
independent of the Docker client.

A dedicated, detached guardian remains the process-group leader while the
command and ordinary descendants run. It signals only **its own process group**;
no PID read from a file is ever used as a kill target. On Stop, timeout or normal
command exit, it sends TERM to the group. If the immediate child ignores TERM,
it uses its still-owned ChildProcess handle to request KILL and observes the
native exit event before reporting. Finally the guardian kills its own group,
including foreground descendants that outlived their immediate parent. The
supervisor checks that no live group member or execution-tagged process remains
before emitting a confirmed terminal result. Zombies are already terminated.

Commands that daemonize into a different session/process group are outside the
supported foreground contract. Detected escaped descendants produce
`unconfirmed`, not successful Stop. Helm does not use an unsafe numeric-PID kill
fallback. A command deliberately removing its inherited execution marker and
escaping the group cannot be contained by this mechanism; do not use daemon
launchers or treat this operator interface as a hostile-process sandbox.

A stopped/failed Docker client is **not evidence that its container command
stopped**. Lost/malformed transport output, unreadable ownership information,
missing terminal evidence or surviving descendants produce `unconfirmed` once
start was granted. Check the selected app before running that operation again.
Independent container deadlines remain in effect, but the host never claims an
unobserved stop. An already-observed command exit wins a later cancellation
request during group cleanup.

Terminal results preserve the observed immediate command `exitCode` and
`signal`, plus `terminationConfirmed`. Confirmation is explicitly scoped by
`terminationScope: 'foreground-process-group'`. If the kernel has not supplied a child
exit event, they remain null (`exitStatusObserved: false`); the cleanup signal is
reported separately as `terminationSignal`, not invented as a native exit.
Live stdout/stderr and the terminal capture share one byte budget. Decoding is
stream-aware, truncated valid UTF-8 never gains a replacement character, and
output beyond the budget is drained without being retained or streamed.
The streamed terminal record omits the already-streamed captured output. The browser allows up to 4 MiB of framed transport (including JSON escaping and tiny-event overhead), while retaining at most 64 KiB and 1,024 channel segments in the view, with visible truncation. Adjacent same-channel chunks coalesce. Command output is not persisted in history by default.

## Backend contract

`executeCommandInContainer.with()` accepts `containerName`, parsed `argv`,
`executionId`, `expectedRuntime`, optional AbortSignal `signal`, and `onEvent`.
The callback receives `started` only after the actual command spawn succeeds,
and bounded `{ type: 'stdout' | 'stderr', text }` events. It returns one terminal
result with `success`, `status`, `exitCode`, `signal`, `durationMs`, `outputBytes`,
`truncated`, `terminationConfirmed`, `terminationScope`, transient `stdout`/`stderr`/`output`, and an
optional error. Status is `success`, `error`, `timeout`, `cancelled`, or
`unconfirmed`. Callers must preserve `unconfirmed` and must not synthesize a
confirmed cancellation merely because Stop was clicked.

## Verification

Run the synthetic Linux process and native installed-CLI tests:

```sh
node_modules/.bin/sounding test \
  --file tests/unit/helpers/helm/command-runtime.test.js \
  --file tests/unit/helpers/helm/command-sails.test.js \
  --file tests/unit/helpers/helm/app-context.test.js \
  --test-concurrency=1
```

The host-Node process fixtures enumerate only their registered app, supervisor,
guardian, command and descendant PIDs so unrelated CI-host process churn cannot
change their expected outcome. PID/start identity reads, environment reads and
signals remain real. Separate controlled ownership probes cover unreadable
processes and PID reuse. This test-only inventory is never loaded by the
production runtime or the Docker contract below, which inspects the actual
container process namespace.

The disposable Docker contract uses an isolated, network-disabled container,
read-only dependencies/source, tmpfs app data and no customer or business jobs.
It verifies selected environment/cwd, native Sails arguments/validation,
stdout/stderr, runtime mismatch, descendant cancellation and real Docker-client
disconnect cleanup. CI must provide the official image first:

```sh
docker pull node:22-bookworm-slim
node_modules/.bin/sounding test --file tests/contracts/helm-commands.test.js
```

Docker was unavailable in the implementation environment; the Docker contract
must pass in CI before claiming end-to-end container verification. No production
or customer command, payment/mail/reconciliation job, release or deployment is
part of these tests.
