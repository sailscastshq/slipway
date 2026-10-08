# Secret-safe configuration and diagnostics

Slipway returns configuration values as `[REDACTED]` by default. A
variable is public only when its metadata explicitly declares `kind: plain`.
This applies to arbitrary variable names, not just keys containing `SECRET` or
`PASSWORD`. Declaring a value public is an administrator decision: do not mark
credentials plain.

Environment, app, service and deployment summaries use explicit field lists.
Status and list requests do not decrypt populated app/service records. A
configuration detail request decrypts its environment internally, because
Waterline requires all encrypted attributes during decryption, then returns
only variable names, metadata and explicitly public values. Service URLs are
constructed from public connection metadata with credentials masked.

## Reveal and editing

The eye button fetches one value using `POST /api/v1/configuration/reveal` with
`scope` (`app`, `environment`, `service`, or `global`), `id` and `key`. Service
URLs use key `connectionUrl`; global values use id `global`.

The request requires current owner/administrator membership, validates the
resource's team, persists a `configuration.revealed` audit containing only the
resource and key, and returns `Cache-Control: private, no-store`. Global reveal
also requires the instance founder. If the audit cannot be saved, the request
fails and no value is returned. Removing administrator membership revokes the
capability on subsequent requests. Revealed values belong only to the current
screen, are discarded when hidden, and are not included in ordinary page props.
Copying a service connection URL is also an explicit, audited reveal. Clipboard
contents remain the user's responsibility.

Submitting `[REDACTED]` under an existing key means preserve its server value.
This keeps older CLI `env:set` and `env:unset` read/modify/write flows working.
A rename supplies `envVarRenames: { OLD_KEY: NEW_KEY }` and removes the old key;
ambiguous renames, new keys containing a mask, or overwriting another key with a
hidden value are rejected. The mask string is reserved for this protocol.
Actual deployment configuration continues to use stored values, never masks.

The updated CLI's `db:url` intentionally reveals a connection URL after server
authorization and auditing. Existing CLI deployment commands continue working;
a CLI update is needed for the new reveal behavior and its additional client
output protection, not for host-port allocation or server-side redaction.

## Presentation and credential classification

Response protection and diagnostic protection have separate catalogues. Unknown
legacy environment values are deliberately hidden in configuration maps and
masked in logs, errors and diagnostic streams. That conservative decision does
not make them secret patterns for unrelated page content. For example, a legacy
`BRAND=flossafrica` must not turn a Bearing title `Support flossafrica` into
`Support [REDACTED]`. The same rule covers arbitrary titles, descriptions,
rich text, emails, image origins and navigation URLs; it needs no display-field
allowlist. Public prose and code examples are not scanned for assignment or
header syntax: `token=example` alone is not a credential. Complete URLs still
receive userinfo and credential-query protection, and registered credentials
remain masked anywhere they appear.

The response catalogue registers credentials from sensitive fields, explicit
`kind: secret` metadata, recognizable legacy credential variable names
(passwords, tokens, keys, DSNs and database connection URLs), and supported
credential settings such as SMTP passwords, webhooks and backup storage keys.
Variable metadata is annotation, not credential material: secret variable names
must not register their descriptions or author names as secret patterns, and
those annotations remain readable. Encryption at rest is not classification: neither an encrypted settings column
nor `secureEnvVars` makes all nested labels and coordinates credentials.
Explicit `kind: plain` environment metadata remains an administrator decision.
Unknown variables still cannot be read from a configuration map without reveal.

Confirmed credential values and their supported encodings remain masked even
inside display-name, domain and other presentation fields. These fields no
longer bypass credential protection. If a public label really equals an
explicitly classified credential, rotate that credential or correct its metadata;
there is no global display-name exemption. Arbitrarily named, unclassified
secrets copied into unrelated free-form content cannot reliably be identified
without also guessing at public text: source DTOs and secret metadata remain
part of the security boundary.

JSON, Inertia initial pages, navigation responses and SSE use response
protection. Error HTTP responses, error envelopes, Error instances and explicit diagnostic
fields (`error`, `errors`, `stack`, `buildLogs`, `stdout`, `stderr`) retain the
conservative diagnostic policy. Existing persistence and streaming protections
remain in place. Intentional capability grants below remain action- and
success-scoped.

Rendered SSR markup is never searched and rewritten. If response protection
changes props, the already-rendered HTML is discarded and Inertia renders the
sanitized page in the browser. Unchanged pages retain their exact SSR output.
This avoids both credential-bearing stale HTML and damaged markup/hydration.

This separation follows the distinction between protected diagnostic data in
[OWASP's logging guidance](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)
and context/field-based redaction described in
[Pino's documentation](https://github.com/pinojs/pino/blob/main/docs/redaction.md).
Slipway implements it in its local Sails hook without adding a logger dependency.

## Diagnostic boundaries and limits

A local Sails hook masks JSON responses, Inertia page props/root views, SSE
packets and Sails logger levels. The explicit credential fields issued by CLI
sign-in, deploy-token creation, Helm write arming and Bridge/Bearing exchange
remain available only on their successful credential-issuing responses. Bridge
direct-upload signing preserves only the short-lived upload URLs (including
multipart part URLs); Bearing page rendering preserves only its scoped realtime
subscription token. Bridge action context preserves its signed confirmation token,
which is bound to the authorized actor, record, action and current state. These are intentional capability grants, not configuration
inspection. Errors from those actions are still masked. Password-reset forms retain only their
validated reset token. These exceptions do not expose configuration maps.

Public upload origins (`R2_PUBLIC_URL`, `S3_PUBLIC_URL`, `SPACES_PUBLIC_URL`)
without credentials or query parameters remain usable in browser image URLs.
Their environment-map entries are still masked unless declared public. Backup
storage coordinates do not become secrets merely because the configuration is
encrypted; its credential fields remain protected.

New deployment logs, container-log snapshots, telemetry diagnostic fields and
Helm history source/context are redacted before persistence. Existing stored
records are masked when read; this release does not rewrite historical storage.
Docker builds and Helm command NDJSON redact complete lines across chunk boundaries. Lines over
64 KiB are withheld; an incomplete line appears when the command finishes.
Configured multiline secrets also register their nontrivial component lines.

The hook seeds a bounded in-memory catalogue from credential-bearing records
in batches of 100 at startup. Existing authorized configuration/settings reads,
mutations, runtime-config resolution and service credential operations register
values already available in memory, without adding decrypting callbacks or
queries to every model write. Rotated values remain masked for the process
lifetime. Secrets changed by direct SQL outside these application paths require
an instance restart to refresh the catalogue.

Structured credential fields and private configuration values are masked at
any length. Free-form diagnostic text also masks URL userinfo, common credential query
parameters, Basic/Bearer headers and credential assignments. Registered strings
of at least eight characters are masked in plaintext, URI-encoded, JSON-escaped,
HTML-escaped, base64/base64url and hexadecimal forms. Matching short arbitrary
strings across all text would destroy useful diagnostics, so arbitrary short
values and unknown application-only secrets must be sanitized by their source.
This is not a guarantee against arbitrary encodings or deliberately obfuscated
output. Public routing identifiers and control fields remain usable.

The catalogue holds at most 4 MiB/10,000 variants; a single value over 128 KiB or
exceeding catalogue capacity withholds free-form diagnostic text rather than
expanding without bound. An authorized reveal remains available. The catalogue
contains credentials in process memory; heap/core dumps are privileged sensitive
artifacts and are not covered by text redaction.

The CLI adds a second mask for recognizable credential fields and URLs in its
diagnostic JSON, NDJSON and error/log output. It cannot discover unknown server
secrets on an older server; update the Slipway instance for configuration-aware
protection. Binary database exports, private backups and authorized restoration
streams are intentionally not rewritten: masking them would corrupt recovery
artifacts. Treat them as sensitive and retain their existing access controls.

## Incident handling

If a credential was previously exposed in downloaded logs, shared diagnostics
or exported data, revoke/rotate it at its provider and update the deployed app.
Masking does not revoke a leaked credential, delete copies already downloaded,
or repair previous disclosure. Use Slipway diagnostic APIs for support packets;
do not attach unredacted database files, environment dumps or process heaps.
