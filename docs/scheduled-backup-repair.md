# Scheduled backup registration repair

Quest loads `scripts/*.js` using `include-all`. Its loader catches an import failure around the whole directory and returns an empty registry. `benchmark-bridge-runtime.js` (introduced in `f169ce12`, 2026-08-03) throws on import when no valid container argument is supplied. Several other command-only scripts also execute work during import. Local reproduction at baseline `670d09a5`: **zero jobs**; after separating command tools as `.cjs`: **seven jobs**, including `run-scheduled-backups` every minute with overlap prevention.

Command tools retain their entry points with a `.cjs` extension, following the existing command-script convention. Callers in package scripts, local tooling, tests, CI and docs follow those paths. The scheduled Sails scripts remain in `scripts/`; no new `lib/` directory or scheduling abstraction is introduced.

The schedule is persisted as the `backupSchedule` setting. The backup script checks configured storage, enabled state, interval and last-run watermark before selecting running managed/reachable external services. Existing schedule-update code preserves `lastRunAt`. The repair does not change schedule values or invoke backups.

The environment controller now returns the last completed backup separately from the newest attempt. The row groups its actions and retains last successful time/size when a newer attempt fails. Existing Klean Button semantics, busy behavior and transparent action treatment remain.

## Visual review

The before image is the user-supplied production crop. After images are synthetic fixtures rendered by the actual environment page, with an older successful backup and a newer failed attempt. They do not establish a production rollout.

| Before                                                        | After, dark desktop                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| ![Original backup row](images/backup-row/before-original.png) | ![Grouped actions and retained success](images/backup-row/after-dark-1280.png) |

[Light desktop](images/backup-row/after-light-1280.png) · [Dark mobile](images/backup-row/after-dark-390.png)

## Verification

- `node --test tests/unit/scripts/scheduled-backups.test.js`: 5 passed; actual directory registration plus mocked due, disabled, not-due and unavailable-storage behavior.
- Sounding targeted command-path and scheduler tests: 8 passed.
- `node --test tests/contracts/quest-registry-initialization.cjs`: 2 passed.
- Existing mocked manual-backup browser trial: passed.
- New backup-row browser trial: passed, including last success after failure, enabled retry, grouped actions, desktop/mobile overflow and dark/light screenshots.
- Prettier on changed source and command scripts, and `git diff --check`: passed.

Production log and last-run confirmation remains pending a confirmed host/container or diagnostics route. No live database backup, restore, schedule mutation, migration, deployment, merge or release was performed.
