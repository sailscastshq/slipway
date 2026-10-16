# Select control underline audit (#803)

The app uses Klean's class-first Select and Combobox primitives. Match the
existing field pattern: transparent background, square corners, zero top/side
borders, one dashed bottom border, gray-200/gray-700 colors and brand focus.
Keep the primitive's keyboard navigation, popup positioning, ARIA state and
validation. Do not change selection logic or options.

| Surface                                              | Result                                                                                                                                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Audit log event filter                               | Replace boxed/ring styling with the field underline                                                                                                                       |
| Bridge access invitation role                        | Replace outlined card styling with the field underline                                                                                                                    |
| Bearing workspace filter                             | Replace filled rounded styling with the field underline                                                                                                                   |
| Public Bearing feedback select                       | Replace filled rounded styling with the field underline                                                                                                                   |
| Shared BareSelect                                    | Add underline; removes its inline border reset                                                                                                                            |
| BareSelect consumers                                 | Covers Dock database, Bridge app/model/pagination and filter operators/choices, app settings route choices, deploy-token scope, log level, public feedback mobile filters |
| Shared relationship combobox                         | Add underline in resource forms and relationship filters; preserve loading, search and invalid states                                                                     |
| Schedule picker hour/minute/period                   | Underline native selects; remove enclosing segmented border; preserve native controls, labels, time parsing and focus                                                     |
| Recipient combobox                                   | Updated separately in owning picker PR #801 (commit 2b71ec8c); no missing-component dependency in this branch                                                             |
| Lookout request-status filter and new Decoys selects | Assigned to the Decoys owner through the parent task; this branch deliberately does not edit lookout.vue                                                                  |

Already consistent, retained: settings team/uploads; environment app/service
creation; configuration metadata; backup storage; external PostgreSQL; Wake;
Quest filters/global runs/run dialog; Bridge scalar select fields.

For the Decoys owner, the existing request-status select in
`assets/js/pages/projects/lookout.vue` uses a rounded outline and filled
background. Keep its compact `text-[10px]` size and existing change handler, but
use `rounded-none border-0 border-b border-dashed border-gray-200 bg-transparent
shadow-none focus:border-brand focus:outline-none dark:border-gray-700
dark:bg-transparent dark:focus:border-brand`. Apply the same pattern to new
Decoys select fields. No other branch should overwrite that worktree.

Browser checks: audit light/dark/mobile computed borders and keyboard selection;
Dock popup collision/resize and keyboard navigation; creation-field widths;
Bridge setup access; schedule parsing and mobile overlays. Seven trials passed.
The picker has an additional passing native selection/underline check in #801.
Review screenshots use synthetic local fixtures under `docs/images/select-underlines`.
