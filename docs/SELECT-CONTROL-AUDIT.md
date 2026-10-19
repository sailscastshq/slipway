# Select control underline audit (#803)

Audit against `main` at `3b89df42`. The app uses Klean's class-first Select and
Combobox primitives. Fields use transparent backgrounds, square corners, zero
top/side borders, one dashed bottom border, gray-200/gray-700 colors and brand
focus. Native time fields retain native controls and keyboard behavior.

The earlier audit already aligned the application fields. This follow-up routes
remaining application Select consumers through the existing `BareSelect`
wrapper, retaining sizing, options, event handlers and validation attributes.
The wrapper also supplies red invalid borders in light/dark mode, including
focus, and forwards named slots. No selection implementation changes.

| Surface                             | Fields / result                                                                                                                                          |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Settings audit log                  | Event filter uses BareSelect                                                                                                                             |
| Settings team                       | Invitation role uses BareSelect                                                                                                                          |
| Settings uploads                    | Backup interval and retention use BareSelect; existing invalid state and revalidation handlers retained                                                  |
| BackupStorageSettings               | Provider and authentication use BareSelect                                                                                                               |
| ExternalPostgresFields              | TLS uses BareSelect                                                                                                                                      |
| ConfigVariableMenu                  | Metadata choices use BareSelect                                                                                                                          |
| Project environment                 | App route, deployment branch, service type and service version use BareSelect                                                                            |
| Bridge access                       | Invitation role uses BareSelect; disabled condition retained                                                                                             |
| Bearing workspace / public feedback | Status controls use BareSelect; existing feedback mobile filters already use it                                                                          |
| Wake                                | Currency and privacy mode use BareSelect; management permissions retained                                                                                |
| Quest                               | Job state filter, global run job/state filters and run-dialog choices use BareSelect; invalid/disabled/help attributes retained                          |
| Existing BareSelect consumers       | Dock database, Bridge app/model/pagination and filter operators/choices, app settings routes, deploy-token scope and log level retain the shared pattern |
| Bridge scalar choices               | Already dashed; retained in BridgeFieldInput, owned by #763 lane                                                                                         |
| Bridge relationship combobox        | Already dashed; coordinated with #763 owner, no overlapping edits                                                                                        |
| Bridge recipient picker             | BridgeActionMultiselect already dashed. Real picker search and selection verified in the synthetic fixture; no duplicate styling change                  |
| Lookout project filter              | Already completed in #819; retained                                                                                                                      |
| Lookout request-status and Decoys   | Already dashed; retained; no edits to the Decoys owner’s components                                                                                      |
| Schedule picker                     | Hour/minute/period already dashed; retain native controls, labels, parsing and focus                                                                     |
| InstanceQuest                       | Remaining outlier assigned to #817 owner; no overlapping edits                                                                                           |

## Verification

- `sounding test --file tests/unit/assets/select-measurement.test.js --test-concurrency=1`: 3 passed (popup width, resizing, controlled state).
- `sounding test --file tests/e2e/pages/select-underlines.test.js --test-concurrency=1`: 1 passed (real audit-log page in light/dark/mobile, keyboard selection).
- `node --test tests/local-review/select-audit.test.cjs`: builds the real wrapper and recipient components with app CSS, serves only local synthetic choices and verifies all four 1440px/390px light/dark combinations. Checks border geometry, viewport fit, invalid color, disabled state, skipping disabled options, Escape/Tab focus, native form serialization, and recipient search/selection.

The synthetic fixture writes screenshots to `.tmp/select803-evidence/`. It uses
no application database, accounts or production endpoints. Screenshots show an
open select plus closed-field states. These are component-level review evidence;
they do not claim full-page coverage of every inventory row.
