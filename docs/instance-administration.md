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

## Passwords and recovery

Signing in, completing setup, or recovering an account rotates the browser
session. Changing or resetting a password invalidates previously issued browser
sessions and CLI tokens, and closes existing operator streams. Reset links can
only succeed once, including concurrent submissions. A reset also cancels any
pending email change or old verification link. Email changes require the current
password as well as verification of the new address.

The authentication-version columns are added before user hydration on upgrades
using safe migrations. Existing credentials remain valid until the account's
password changes or the credential is explicitly revoked.
