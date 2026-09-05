# CLI device authorization

Upgrade the Slipway server and CLI together. Device authorization now requires
protocol version 2; older clients receive an explicit upgrade message. Existing
API keys continue to work unless revoked or invalidated by a password change.

The browser confirmation code identifies a request but cannot retrieve its
credential. The initiating CLI receives a separate random device secret, which
must never appear in a URL, console output, or log. Polling uses that secret in
the request body; SSE uses an `Authorization: Device …` header.

Approval first reserves the request, persists its credential, and verifies that
the approving account's authentication version is unchanged. Only then can the
device retrieve the token, once. Requests expire after five minutes. Pending
requests, active streams, and per-IP request rates are bounded.

If a network failure loses the single successful token response, restart login;
do not retry with the human confirmation code. An unused resulting CLI key can
be revoked from Settings → API Keys.
