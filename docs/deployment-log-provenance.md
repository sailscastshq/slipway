# Deployment log provenance

Default reveal-only environment metadata remains conservative in diagnostics.
Slipway's container-start, health-check and public access-origin events instead
retain provenance before flattening. Only in-process branded constructors can
produce these events. Container names, health endpoints and access origins are
validated; access origins cannot contain paths, credentials, queries or fragments.

Events are credential-redacted and authenticated with the session secret before
being stored in `deployLogs`. JSON/Inertia responses and SSE render verified
records for the matching deployment, rechecking current credential patterns.
Docker output is always untrusted, including strings that resemble events and
reserved carrier markers split across chunks. The previous raw Docker URL-host
exception has been removed. Explicit credential metadata and credentials from
other workloads still mask overlapping coordinate values.

The carrier adds no database columns or migration. Raw database exports contain
encoded events; clients should use the deployment log API. Stable session secrets
are required across workers and restarts. Rotating that key makes old signed
records display `[Unverified deployment event]` rather than trusting them.
Previously masked historical text remains masked and is never reconstructed.

This draft requires security review and full CI before merge. It changes no
production settings or data and performs no deployment.
