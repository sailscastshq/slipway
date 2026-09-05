# Team membership and active context

Memberships store a role for each user/team pair. Creating a team grants ownership
of the new team without dropping membership of the previous team. The browser's
active team lives in its session; switching never changes another session or an
existing CLI token. A CLI token is bound to the team selected when it is issued.
Log in again with the intended team selected to obtain a token for that team.

Authorization reads the current membership on each request. Removing a member
deletes that membership and its team-scoped CLI tokens, retaining the account
and other memberships. A browser falls back to another active membership or
asks the user to create/join a team. Removing a member cannot remove a team owner.

Existing accounts can receive pending invitations, displayed as Join in their
team switcher. Selecting the invitation accepts it. Pending membership never
grants API access. New accounts retain the email/password setup invitation flow.
The switcher and role display refresh on navigation rather than caching stale
membership state indefinitely.

Existing installations backfill the legacy user team/role and all owned teams
once, then bind legacy CLI tokens to their existing team. A migration marker
prevents removed memberships from being recreated on a later restart. The old
User.team field remains a login/default compatibility field; request authorization
uses TeamMembership and the session/token context.
