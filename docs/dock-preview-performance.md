# Dock preview performance and display labels

Dock reads deployed model metadata and the database catalog concurrently.
Successful read-only previews may reuse a model snapshot for at most ten
monotonic seconds. Every read still inspects the container identity, image,
restart time, environment, execution context, mounts and network. Missing
identity/running evidence disables caching. The cache is process-local, limited
to 16 entries and 8 MiB; entries larger than 4 MiB and failed inspections are not
cached. Returned graphs are cloned.

Refresh and retry request a fresh model snapshot. Mutation validation requests
its own fresh inspection and never joins a preview started before validation.
Database catalogs, native engine preflight and transaction validation are never
cached. Bind-mounted source edits can be reflected up to ten seconds later in a
passive preview; explicit Refresh and mutation validation read them immediately.
Whole preview responses use private/no-store headers.

`Server-Timing` reports model inspection/queue/container, catalog, diff, native
preflight and plan stages without SQL text or credentials. The disposable native
schema contract prints numeric `DOCK_SCHEMA_PROFILE` samples in CI, including
native engine preflight. No production profiling or database mutation is needed.

The display-label map comes from runtime model identity. Selection keys, physical
SQL tables/columns, operation IDs, migration contracts and SQL remain unchanged.
Unknown/unmanaged tables retain their physical labels rather than guessing a
singular form.

Local measurement uses an isolated real Sails/ORM app with 40 models and twenty
fields per model; catalog transport has a controlled 100 ms per round trip.
The real controller measured 836–846 ms before, 524 ms cold after, and 304–308 ms
warm after. Model snapshots alone improved from 519–526 ms to 38–39 ms on warm
reads. Sails load measured 278–286 ms. Native Docker was unavailable locally;
these numbers are not production or native-container startup claims.

Actual synthetic browser screenshots measured seven changed-field rows at
484 px before and 232 px after. The empty state decreased from 166 px to 127 px.
Dark changed-field contrast improved from 1.06:1 to 18.16:1. Observed response-to-
first-frame times were 17–31 ms, so client rendering was not the main local delay.
