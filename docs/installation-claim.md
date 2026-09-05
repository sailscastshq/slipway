# Claiming a new installation

First-run setup requires an installation claim token as well as the founder's
email and password. The installer generates the token, stores it with the other
server secrets, passes it to the container, and prints it for the operator.

For manual deployments, set `SLIPWAY_SETUP_TOKEN` to a random secret (for
example, `openssl rand -hex 32`). Without this variable, an unconfigured server
generates a token at startup and prints it to its private server logs. That
generated token changes on restart. Never place the token in a URL or share it
with people who should not administer the instance.

Founder creation, default-team creation, and the permanent installation marker
commit in one transaction. Concurrent submissions cannot create two founders.
Existing configured installations acquire the marker during startup and need no
claim token. Removing users directly from the database does not reopen setup.

The installation administrator cannot delete their own account. Other team
owners must transfer or delete their owned teams before deleting their account.
Recover a lost administrator through the existing account recovery flow; do not
delete the installation marker to expose setup again.
