# GitHub webhook verification

Both GitHub endpoints authenticate the original HTTP body bytes with HMAC-SHA256.
Malformed or missing signatures are rejected. The normal JSON body limit remains
in force; raw bytes are retained only for webhook routes.

Verified deliveries require an `X-GitHub-Delivery` identifier. Slipway records a
receipt before handling an event and returns the recorded result for a repeated
identifier. Concurrent duplicate requests do not repeat processing. Receipts are
retained for seven days with a 10,000-record admission limit; a full receipt store
returns 503 instead of evicting recent replay protection. Failed attempts release
the receipt so a delivery can be retried.

A process interruption can leave a receipt marked `processing`. This means the
outcome is uncertain, not that a deployment succeeded. Check the deployment queue
before an administrator removes that receipt for redelivery. These receipts are
bounded idempotency protection, not a transactional guarantee across Git, Docker,
and the database.
