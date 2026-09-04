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
