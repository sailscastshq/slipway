# Local-first Slipway CI

The owner can trust a local device to run required source checks, then let Slipway independently verify the deployment candidate. This implementation is on the CI feature branch; it is not in the installed public CLI/server until that branch is reviewed and released.

## One-time setup

Install matching CLI and server releases. Connect the app's GitHub repository. Review its committed `lint`, `test`, and `build` scripts, including npm installation lifecycle scripts. The first execution profile supports Linux, Node 22.12+, npm lockfiles, and disposable SQLite. PostgreSQL/Redis services, CI secrets, remote Docker daemons and uploaded source archives are not supported by this profile.

Choose the immutable official Node image for the deployment architecture. Prefer its platform-specific digest. Pin the app Dockerfile base to that image, or a multi-platform index containing exactly that image. The server compares the candidate's base layer chain and Node version with the reviewed runtime.

```sh
slipway ci:setup --project sailsconf --env production --app web \
  --commit <pushed-full-sha> --branch main \
  --image node@sha256:<platform-specific-digest> --platform linux/amd64 \
  --approve-policy --approve-target sailsconf/production/web

slipway ci:register --project sailsconf --env production --app web \
  --name 'My development machine' --trust-device \
  --approve-target sailsconf/production/web
```

Only team owners/admins can configure, approve, submit or revoke local runners in this first version. Explicit trust means the device's administrator is trusted to report checks honestly. An Ed25519 signature identifies the approved device and protects the submitted result; it does not prove an administrator cannot forge execution.

## Everyday use

Commit first. Local changes outside that commit are excluded.

```sh
slipway ci --project sailsconf --env production --app web --local
# Push that same commit to the reviewed branch.
slipway ci:submit --project sailsconf --env production --app web \
  --report <path-printed-by-ci>/report.json
slipway ci:status --project sailsconf --env production --app web
```

Without `--local`, the runner also attempts submission immediately. If the commit has not been pushed, the report is retained for later submission. The server verifies the current head of the configured branch directly against GitHub; a different merge SHA needs its own run. The server never accepts arbitrary client-supplied source or configuration hashes as authority.

Each run creates a fresh disposable Docker container inside the local Docker Desktop VM: non-root, read-only root, bounded executable workspace, no host project or Docker socket mount, no production environment, two CPUs, 4 GiB memory, bounded processes/logs, and a twenty-minute deadline. Installation can access the network; required checks run after network disconnection. Job code receives neither CLI credentials nor the device signing key. The parent cleans up the container; the container also has its own maximum lifetime.

The device key and retained evidence live in the CLI's protected configuration directory, outside the repository. `SLIPWAY_CONFIG_DIR` can select an absolute private directory for an isolated pilot. Do not commit or share its credentials.

## What the server verifies

1. A current app-scoped policy and approved, non-revoked device.
2. The connected repository ID, exact pushed branch head/tree, package and lockfile bytes, required commands, executor digest, pinned runtime and platform.
3. A signed, one-use server challenge; complete ordered successful checks; cleanup; a result no more than an hour old. Identical resubmission is idempotent. Altered replay is rejected.
4. A clean checkout of that same source before building. An existing deployment worker can wait up to twenty minutes for a qualifying result; missing evidence blocks rather than silently rerunning untrusted checks on the management host.
5. The server-built immutable image, architecture, reviewed runtime base, executable Node version, current runtime/readiness configuration, and existing schema/health/route checks.
6. Current policy, runner trust, source receipt and candidate verification again inside the traffic-commit transaction. A policy change or revocation blocks promotion. Existing rollback safety checks remain in force.

Local source checks and server candidate verification are separate records. A green local result is never an image attestation. Runtime compatibility checks do not rerun the test suite against the final application image; there is no claim of hermetic dependency installation, reproducible builds, independent local execution, or a SLSA level.

Ten simultaneous unexpired submissions and 200 submissions per app per hour bound admission. Old unlinked receipts are pruned during new submissions; the latest 200 and deployment-linked evidence are retained. Signed source summaries are bounded; full check logs stay local. No production secrets are copied into CI.

## Changes and revocation

Review a new policy after changing required commands, executor implementation, pinned runtime or platform; approve the device for that policy again. Existing receipts cannot satisfy the new revision. Configuration in Slipway shows the policy, registered devices and revocation action, with confirmation and toast feedback.

```sh
slipway ci:revoke --project sailsconf --env production --app web \
  --runner <runner-uuid> --approve-target sailsconf/production/web
```

The owner can also disable the policy in CI → Configuration. Disabling while a CI-admitted deployment is in flight invalidates that candidate's promotion; start a new deployment after reviewing the change.

## Sailsconf pilot and rollout

The pilot uses real Sailsconf source and GitHub metadata with an isolated localhost Slipway, protected temporary credentials and disposable Docker. It does not connect to the production database or change the live deployment policy. The app feature PR includes its lint fixes, missing model column mappings and the pinned Node base.

Before live cutover: review and merge both feature PRs, release/install matching server and CLI, review the policy against the exact new `main` SHA, register the owner's device, submit its successful receipt, then observe a normal deployment reaching separate server verification. Preserve the existing GitHub workflow/protection until replacement is explicitly approved. Automatic GitHub status mirroring, remote runner orchestration, shared caches and extra service profiles are follow-up work, not prerequisites hidden inside this pilot.

Final feature-branch pilot on `5de9277a0cc6a992757b28d3bff5b1cd936b9155`: install, lint, **312 tests passed / one skipped / zero failures**, and build passed in **244.77 seconds** on Linux AMD64, Node v22.23.4. Cleanup completed and the isolated server accepted the signed source receipt. See [the sanitized evidence](evidence/sailsconf-amd64.json). A separate disposable Docker candidate passed real health/base/version/image checks and rejected an image mismatch. These measurements do not establish a GitHub speedup or verify Sailsconf's production image.
