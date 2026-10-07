# Slipway 0.0.91 — self-updates without validation port conflicts

A self-update could fail before the new container started because the running legacy updater chose a host port already owned by a customer app. Docker reported `port is already allocated`; changing the target image alone could not repair the updater that was already running.

This patch includes [#726](https://github.com/sailscastshq/slipway/issues/726) and [#727](https://github.com/sailscastshq/slipway/pull/727), merged at `9f3b33037d4edf1b7f998858e25fcd7707ddc568`.

## Validation no longer needs a host port

The temporary `slipway-next` candidate keeps its mounts, environment and network, but allocates and publishes no host port. Health checks continue through `docker exec` inside that container. Migration preflight and verified pre-update backups remain in the normal flow.

The final production replacement preserves the dashboard's existing published binding. Failed candidate creation is cleaned up. Failure to remove a successfully validated candidate blocks the production swap rather than leaving the candidate running alongside the replacement. Bosun retains the previous container until the replacement passes normal startup checks and restores it on failure.

## Useful Docker diagnostics without command credentials

App startup, update validation, Bosun creation and the isolated swap script use a shared Sails helper to format Docker failures. Diagnostics come from bounded stderr, without falling back to command text containing environment credentials. Bosun captures errors before logging; candidate startup logs are also redacted against the supplied environment arguments.

Short numeric environment values no longer erase digits inside unrelated addresses, ports and identifiers. Explicit environment assignments and text credential values are redacted. The owned app-binding address remains available in Docker routing diagnostics.

## One-time repair for an already running legacy updater

An older running updater needs a bootstrap before it can start the fixed image. `scripts/bootstrap-unpublished-update.cjs` supports 0.0.88/0.0.89 and removes only the known unnecessary validation-port publication statement. It checks source shape and JavaScript syntax, retains a private source backup, preserves source ownership, replaces the helper atomically and is idempotent. Unsupported versions or unexpected source stop without replacing the helper.

Run the repair inside the existing management container, restart only `slipway` to reload its helper, then use Settings to update. Customer application containers remain running; the repair does not open database files or change credentials. See [bootstrap instructions](https://github.com/sailscastshq/slipway/blob/v0.0.91/docs/self-update-port-bootstrap.md).

## Verification and limits

All **23 PR checks** passed on `6b649a3f5b70a76b9584e908192a7581263c7726`, including **703 Linux unit tests**, **200 functional tests**, all three browser shards, real Docker allocation/health checks, and production update/swap checks. [CI evidence](https://github.com/sailscastshq/slipway/actions/runs/37694827287).

The 16 focused local trials passed. The labeled Docker fixture verifies the host/container namespace mismatch, usable host-aware allocation, container-local health for a candidate with zero published ports, and cleanup of its owned containers. Bootstrap syntax and idempotence passed against published v0.0.89 source and inside the actual local 0.0.89 image, without starting application databases. The full direct macOS unit attempt encountered existing Linux-only `/proc` trials; complete unit pass evidence is from Linux CI.

This patch does not change app hooks, the CLI, dependency versions or database schemas. Failed customer app deployments still require a retry and verification on the affected installation. The host-aware allocator shipped in 0.0.90 is retained.

## Dependency audit

A fresh audit still reports **7 findings: 4 high, 3 moderate, 0 critical**, across the existing braces and sprintf-js advisory families tracked in [#724](https://github.com/sailscastshq/slipway/issues/724). No compatible remediation is supplied by npm audit; its suggested changes downgrade framework/build dependencies. The repository-owned pattern/format boundaries assessed in #723 are unchanged by this patch.

On 8 October 2026, the maintainer explicitly approved carrying these existing findings into 0.0.91. This is release-specific acceptance, not a clean audit or a global waiver. Issue #724 remains open for compatible remediation; future releases need reassessment.
