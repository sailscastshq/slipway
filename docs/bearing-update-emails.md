# Bearing update emails

Verified host-app customers can opt in below their app's public Updates page,
including an embedded widget. Consent starts off. Signing in, installing the
upgrade, and publishing an update never subscribe a customer automatically.
Consent is scoped to one Bearing participant and app. A verified email change
invalidates the previous consent, including when the address changes back.

Each publish path records a frozen title, full Markdown body, publication date,
app identity and canonical URL inside the same database transaction as publication.
Draft saves, edits to published content, repeated publication requests and
historical updates do not create another event. Audience expansion only includes
the consent revisions that existed when the update was published.

The minute Quest job expands at most two events, fifty consent revisions per
event, and delivers at most ten messages per run. Unique update/participant keys
deduplicate delivery records. Atomic five-minute leases coordinate workers and
allow a restarted process to resume abandoned work. Failed sends retry with
exponential backoff, capped at one hour, and stop after five reported failures.
Every attempt rechecks the exact consent revision, verified address, participant,
app, public Updates visibility and published update. Opting out and back in does
not revive an old queued message.

Mail uses `sendConfigured` and waits for transport acknowledgement. The log
transport is refused for this message, so recipient addresses, full bodies and
unsubscribe tokens cannot be emitted through that diagnostic transport. Failures
in the queue do not log the recipient, transport error or token.

SMTP acknowledgement is not an exactly-once delivery guarantee. If SMTP accepts
mail but the acknowledgement or subsequent database commit is lost, recovery can
send it again. A consent change after the final check cannot recall a message
already handed to SMTP. No existing SMTP settings are changed by this feature.

The email contains the complete safe HTML and plain-text body. Headings, lists,
code, tables, links and responsive images are supported; images include alt text
and absolute URLs. Interactive embeds become descriptive links. Raw HTML is
escaped. Long messages include a clipping note and a browser link, while retaining
the complete body. Actual clipping thresholds vary by mail client.

The signed unsubscribe link opens a confirmation page. GET does not change
consent; a CSRF-protected, idempotent POST opts out without requiring host login.
Tokens are bound to the app, participant and verified address and do not appear
in public page props. Old-address tokens cannot unsubscribe a newly consented
address.

Three new tables are installed through the existing pre-lift executor, including
clone validation, backup and transaction receipt. A separate
`bearing-update-emails-v1` receipt preserves the released `0.0.88` checksum.
The participant table gains no columns and old customers have no consent rows.
Production Sails helpers verify migration readiness rather than issuing DDL.

Local evidence uses synthetic recipients and a mocked transport. Browser tests
cover keyboard interaction, light/dark mobile embedding, saved preferences and
rollback. Native tests cover released and already-receipted upgrades. Preview
HTML is evidence of browser layout, not proof of rendering in Gmail, Outlook or
Apple Mail; those clients still need acceptance checks before shipping.
