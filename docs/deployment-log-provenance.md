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

## Public identity in shared diagnostics

The shared diagnostic redactor now accepts a separate bounded catalogue of
validated control-plane identifiers. The secrets hook reads project, environment,
app, repository and user identity fields without decrypting configuration for
this catalogue at startup. Deployment/source preparation and actor logging also
register freshly resolved records before logging. Configuration maps and log
output never establish public identity.

Only known public runtime-coordinate values matched inside one of these public identifiers may be preserved; arbitrary unclassified hidden values remain mandatory even if they equal a public name.
For example, a recognized project/app coordinate can no longer erase part of the actual
repository owner or a public app name in an image reference or asset filename.
This applies before build chunk capture, instance logger output, persistence,
HTTP responses and live stream rendering, so later masking boundaries agree.
Unknown hidden values remain masked, including reversible encodings. Credential names, structured secrets and explicit credential metadata remain mandatory. Every overlapping mandatory match is collected against the original input and their union is masked, so neither public matches nor earlier replacements can expose a private suffix.
URL userinfo, credential assignments, Bearer/Basic material and signed/query
credentials retain syntax masking. The authenticated deployment-event mechanism
and its replay checks remain in place.

The catalogue is process-local, case-sensitive and bounded; exhausted public
capacity only drops further exceptions. Like the existing secret catalogue,
identity evidence survives record deletion until restart. Historical strings
already containing `[REDACTED]` cannot be recovered. Browser proof uses only a
synthetic deployment fixture; it does not claim a production rollout or repair
of a separate application failure.

Unknown variable names such as `BRAND` remain conservatively masked, even inside
public identity. They need explicit plain classification to become diagnostic
public values; the fix does not infer that every brand-like variable is harmless.
The preexisting minimum registered-value length is eight characters; syntax-based
credential masking still applies below that threshold, but arbitrary shorter
canaries are not comprehensively substring-masked. Typed diagnostic identifier
fields also apply credential-only masking so logger object arguments cannot
bypass a registered genuine credential.
