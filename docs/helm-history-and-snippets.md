# Helm history and snippets

Helm keeps a durable workspace for each signed-in user, project, and
environment. The workspace is designed to make repeat operations convenient
without turning production query results into another datastore.

## What history stores

Each run records:

- the JavaScript source that was executed;
- the execution status and duration;
- the project, environment, app, container, and deployment version target; and
- the execution timestamp.

Returned values, console output, captured logs, and error details are never
stored in Helm history. Security audit records are written separately and do
not contain the executed source. Deleting editable history therefore does not
delete the audit trail.

History is private to the user who ran it and to the project environment where
it ran. A user can search, reload, rerun, pin, or delete an entry. Clearing
history removes unpinned entries and preserves pins.

Unpinned history is retained for 30 days and capped at 200 entries per user,
project, and environment by default. Production installations can change
these bounds:

```text
SLIPWAY_HELM_HISTORY_RETENTION_DAYS=30
SLIPWAY_HELM_HISTORY_MAX_ENTRIES=200
```

Pinned entries are exempt from both automatic retention and the default clear
action. They remain until the user unpins or explicitly deletes them.

## Production context and write arming

Helm's breadcrumb identifies the active project, environment, and app. Slipway
resolves the container and deployment again on the server for every execution,
then includes that complete target in history rows and **Copy diagnostics**
output. Production mutation confirmations also show the resolved target before
writes can be armed.

Before every project Helm execution, Slipway parses the submitted JavaScript
and looks for obvious database mutations, native queries, and recognizable
external side effects. A matching production run is blocked until the
operator explicitly arms writes.

A write arm:

- expires after 60 seconds by default;
- belongs to the current signed-in user and team;
- is bound to the exact source hash, project, environment, app, container, and
  deployment version;
- is stored by Slipway only as a token hash; and
- is consumed after one execution attempt.

Changing the source or deploying a new version invalidates the arm. Production
installations can shorten the window:

```text
SLIPWAY_HELM_WRITE_ARM_TTL_SECONDS=60
```

Mutation detection is safety friction, not a security sandbox. Arbitrary
JavaScript can hide or construct side effects in ways static analysis cannot
prove. Teams that require strong read-only enforcement must give the
application or Helm runtime read-only database credentials and restrict any
other runtime capabilities at the infrastructure boundary.

## Audit access, privacy, and retention

Team owners and admins can open **Settings → Audit Log**, search by action,
resource, person, or IP address, and filter to Helm events. Team members cannot
open either the audit page or its JSON endpoint.

Helm execution audit events contain the actor, request IP, target, SHA-256
source hash, source and output byte counts, start time, duration, status,
classifier metadata, and whether writes were armed. Blocked runs and write-arm
actions are recorded separately.

Audit events never contain submitted source, returned values, captured logs,
credentials, or full production records. The editable, user-private history
described above is therefore separate from the administrative audit trail.

Helm audit events are retained for 90 days and capped at 5,000 events per team
by default. Both limits are configurable:

```text
SLIPWAY_HELM_AUDIT_RETENTION_DAYS=90
SLIPWAY_HELM_AUDIT_MAX_ENTRIES=5000
```

## Reusable snippets

A snippet is named JavaScript source that Helm inserts into the editor without
executing it. A snippet can be:

- **Personal** — visible only to its creator in that project.
- **Project** — visible to every Slipway team member who can access that
  project.

The creator owns a project snippet and is the only user who can rename, edit,
change the visibility of, or delete it. Other project members can insert the
source but cannot overwrite it. Audit records cover snippet creation, changes,
and deletion without copying snippet source into the audit details.

Snippets share Helm's maximum source-size limit. Inserting a snippet never
triggers a run; the user must review it and press **Run**.
