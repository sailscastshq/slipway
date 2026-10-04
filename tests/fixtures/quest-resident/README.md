# Real resident Quest integration

This fixture uses npm-packed and npm-installed copies of the exact pinned
upstream Quest source and complete Slipway hook, installed Sails/whelk,
actual Docker exec/private UDS transport,
a disposable Sounding HTTP world and Chromium. No runtime double, fabricated
lifecycle event, intercepted browser response or customer job is used.

Run only on the authorized disposable Linux CI runner with installed lockfile
dependencies, Chromium and the already-provisioned `node:22-bookworm-slim` image:

```sh
export SLIPWAY_QUEST_UPSTREAM_ROOT="$PWD/.tmp/quest-upstream"
export SLIPWAY_QUEST_UPSTREAM_SHA=7411223d586d1b86365296b0a696fda5477f2109
export SLIPWAY_QUEST_CONSUMER_HEAD="$(git rev-parse HEAD)"
export SLIPWAY_QUEST_PACKED_ROOT="$PWD/.tmp/quest-packed-consumer"
CI=true node tests/fixtures/quest-resident/packed.cjs
node_modules/.bin/sounding test \
  --file tests/contracts/quest-resident-integration.test.js \
  --test-concurrency=1 --test-timeout=600000
```

The upstream checkout must be clean and match the asserted full SHA. CI prepares
its pinned production dependencies separately for source-only checks. Runtime
preparation npm-packs both exact checked hook sources and npm-installs those
tarballs with nested production dependencies into a fresh disposable consumer.
The consumer's resolved dependency names/versions and lockfile SHA256 are
recorded separately from each tarball's package-file hashes. They are npm's
consumer resolution, not a claim that upstream's development lockfile was used
for that installation. The fixture application's Sails/machine/whelk still
resolve through the unchanged root lockfile dependency mount. Missing source or
packed provenance is a failure, never a
skip or a fallback to released 0.0.5. The known unsafe `788d767` implementation is
blocked; readiness also demands explicit scheduler-suppression, trigger and
terminal-exit-code/terminal-signal/schedule-diagnostics capabilities and source-loaded job metadata.

The writable app tmpfs owns its `node_modules` directory. It links the existing
locked dependencies and physically copies the two installed hook packages,
including their installed nested dependencies. Source symlinks are rejected;
every package file must match the tarball manifest and every installed file
must match the recorded dependency-tree hashes. Both
container startup and offline checks resolve all declared fixture dependencies
and peers from their actual package locations, including the normal Sails CLI.
The offline probe also calls the installed Sails moduleloader on that layout
and checks the shared source-owned `.sailsrc` enables all four discovered hooks.
It loads hook definitions only; it does not initialize any hook or lift Sails.

The worker uses real `sails.lift()` with helpers/ORM and no HTTP hook. The full
Slipway hook auto-registers on `ready`; Quest owns every validation, child and
timer. The source enables resident auto-start. A passive observer verifies that
owned temporary CLI bootstraps disable it at ORM readiness. It never rewrites
the setting to make an unsafe hook pass.

The npm pack/install commands use `--ignore-scripts --omit=dev` where applicable.
Preparation explicitly rejects required build, prepack, postpack and install
steps. The sole permitted prepare script is upstream's exact `husky` command;
that verified omission is recorded. The gate retains the existing 16 MiB app
tmpfs and fails if measured hook copies exceed 12 MiB after 4 KiB file rounding,
leaving room for fixture files and links.

Docker runs with network `none`, a read-only root/source/dependencies/consumer,
and writable app/tmp tmpfs state.
Only one unique container is created or removed. The supervisor permits one
owned-resident restart, caps the complete fixture at four minutes, and stops
the container if evidence exceeds 256 KiB or Sails loads/starts exceed 40. No
host process lookup or broad cleanup is used.

Coverage includes source aliases/default precedence, actual stable timer due-at,
typed/falsy/nullable inputs and independent business results, Sails validation,
named exits, throwing scripts, stderr on exit 0, request-key dedupe, scheduled and
manual overlap/pause, process/socket ownership, real authentication and privacy,
browser review/result/log/stable-link reopening and disconnect without replay.
The index script calls a source-owned pure Sails helper over synthetic records.
The resident calls that same helper directly at startup, and its observed result
is compared with the separate Quest child receipt without creating another job.
A synthetic job signals only its own PID to prove observed SIGTERM propagation
with no invented numeric exit code; it does not exercise a cancellation API.
Malformed cron, a valid expired date, a stopped interval and a bounded consumed
one-shot remain distinct. Yearly paused cron definitions verify `cronOptions.tz`
precedence and an explicit local-default timezone without waiting for their dates.
An invalid schedule does not prevent an independently validated manual run.
The one-shot is source-loaded with its script's actual schema, stopped at the
synchronous Quest hook-ready boundary, then explicitly started through the
public API by one owned fixture signal. It is never dynamically redefined.

Recovery trials intentionally mark only the disposable dashboard App stopped or
temporarily point it at a uniquely nonexistent container while a real child
keeps running. They require uncertainty and exact same-sequence resident recovery
without replay. A separate test withholds real terminal delivery, then uses a
single bounded fixture signal to create 40 genuine paused Quest timer skips at
100 ms intervals,
evicting the old resident receipt without new children or a runtime restart.
The timer stops afterward; its dynamically unavailable schema stays gated.
Finally the supervisor replaces the actual resident, proving stale-identity
rejection and persisted uncertainty rather than an invented result or retry.

Telemetry is disabled. This proves bounded resident reconciliation and truthful
lost evidence; it does not claim durable replay, cancellation, distributed locks
or exactly-once external effects. The only business data is synthetic.

The two exact tarballs, consumer lockfile and full per-file provenance accompany
screenshots plus browser and complete integration proof JSON under
`.tmp/screenshots/quest-real-resident`. Complete proof is written only after all
assertions pass. Syntax/offline checks are not runtime execution evidence.
Both runtime proof JSON files include the packed-consumer identity, tarball
hashes, package-file hashes, installed-tree hashes and exact source commits.

Offline source/schema checks need no socket, scheduler, browser or business child:

```sh
NODE_PATH="$PWD/node_modules" \
SLIPWAY_QUEST_UPSTREAM_ROOT="$PWD/.tmp/quest-upstream" \
SLIPWAY_QUEST_UPSTREAM_SHA=<verified-full-upstream-sha> \
node --test tests/fixtures/quest-resident/preflight.test.cjs \
  tests/fixtures/quest-resident/source-metadata.test.cjs \
  tests/fixtures/quest-resident/packed.test.cjs
```

## Separate CI-native dashboard restart and telemetry proof

`quest-dashboard-restart.test.js` is an independent, reconstructed fixture. It
does not change the worker/Docker/browser proof above. Reconstruction and pure
source checks are not runtime evidence; only a successful authorized CI run of
the command below establishes this additional proof.

```sh
CI=true SLIPWAY_QUEST_RESTART_CI=1 \
SLIPWAY_QUEST_UPSTREAM_ROOT="$PWD/.tmp/quest-upstream" \
SLIPWAY_QUEST_UPSTREAM_SHA=7411223d586d1b86365296b0a696fda5477f2109 \
node --test --test-concurrency=1 tests/contracts/quest-dashboard-restart.test.js
```

Run this command only on the authorized disposable Linux CI runner. Missing
either explicit CI gate fails before any fixture setup, app, socket or child.
The packed consumer must first be prepared using the exports and CI command
above; runtime never falls back to source links. Source-only loader preflight
can still inspect the explicit checkout without preparing a consumer.
The standalone Node test owns two real dashboard Sails process generations and
one independently lifted resident web app. It uses the installed dependencies,
exact upstream Quest source, normal Sails built-in discovery, and a real
loopback-only HTTP health route. Quest's source configuration has autoStart
false; all work uses source-registered scripts and the actual Quest CLI.

Dashboard A migrates four unique on-disk SQLite stores with `drop`; after its
owned SIGKILL and confirmed exit, B lifts on the same port and files with `safe`.
Both use Sounding's singular `datastore.mode: inherit`, checked against the
actual lifted paths. Sounding factories seed only disposable user/project/app
targets after lift. Authenticated Sounding HTTP requests read the real repo
controllers. No QuestRun row is seeded.

The resident's complete Slipway hook sends real HTTP telemetry to the disposable
dashboard token. Passive Node diagnostics observe delivery, errors, payloads and
responses without replacing transports. An index result and logs survive A's
death byte-for-byte. A typed job finishes while A is dead and its actual error
sentinel flush gets ECONNREFUSED. B first confirms the old receipt and logs are
unchanged and the missing run returns 404, then explicitly recovers that run via
the exported residentRequest ownership checks and workspace.synchronizeRun.
This is a direct private-UDS recovery sub-proof; the fixture above separately
proves the complete Docker route. The same app PID/runtime survives, and
reconciliation starts no job.

Thirty-six aliases return distinct labels and 16,000-byte result strings, with
at most four CLI children active. A real throwing sentinel flushes the buffer
using batchSize 1000 and 600000 ms flush/heartbeat intervals. Assertions require
all values, one start and completion per alias, HTTP 200 for every received
packet, numeric wrapper timestamps, 32 KiB/event, 512 KiB/post and 500/200/1000
per-kind limits. Total accepted traffic stays below 2 MiB, 3000 events and 120
requests, also checking persisted per-environment minute budgets.

The expected counts are 41 starts and 42 Sails loads. Hard bounds are 64 starts,
70 loads, 180 seconds per owned process, and 2 MiB each for captured output,
IPC and evidence. Child environments are allowlisted; runner credentials,
NODE_OPTIONS and inherited external destinations are omitted. Disposable tokens
are passed through a private 0600 context file, never proof/log artifacts. Cleanup
signals only owned process groups, confirms their exit, removes only exact
owned registry inodes, and deletes the unique SQLite/WAL/context directory.
`native-restart-proof.json` is written only after assertions and cleanup succeed.

Pure preflight and real source-loader checks do not lift Sails, open sockets,
run scripts, or launch children:

```sh
SLIPWAY_QUEST_UPSTREAM_ROOT="$PWD/.tmp/quest-upstream" \
SLIPWAY_QUEST_UPSTREAM_SHA=7411223d586d1b86365296b0a696fda5477f2109 \
node --test tests/fixtures/quest-resident/native-preflight.test.cjs
```
