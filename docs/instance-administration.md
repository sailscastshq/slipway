# Instance administration

The account that completes installation is the instance administrator. This
authority is separate from team ownership: creating a team or promoting a team
member does not grant access to the installation's databases or shared secrets.

Only the instance administrator can use Bosun, configure global environment
variables, change instance routing, configure storage and notifications, change
the GitHub OAuth application's credentials, or apply Slipway updates. The server
checks this authority on every protected request, including read views and log
streams. Other users do not see those controls in navigation or settings.

Team members retain access to their own team's projects, GitHub connection,
and personal CLI tokens. Existing team role checks continue to govern team
management. Changing the instance administrator's active team does not remove
their instance authority.

This uses the existing installation-founder identity, so existing installations
do not need a schema migration or manual role backfill.

## Credential revocation

Bearer tokens authenticate only the request that presents them. They never log
a browser session in, and a supplied invalid token cannot fall back to a browser
cookie. Revoking a token closes its active operator streams; removing a user
closes that user's operator streams. Each new authenticated request also checks
that its user still exists.

This upgrade changes the session cookie name once to discard legacy sessions
that might have originated from a CLI token. Browser users must sign in again.
Existing valid CLI tokens continue to work until explicitly revoked.
