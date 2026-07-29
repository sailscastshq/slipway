# Helm history and snippets

Helm keeps a durable workspace for each signed-in user, project, and
environment. The workspace is designed to make repeat operations convenient
without turning production query results into another datastore.

## What history stores

Each run records:

- the JavaScript source that was executed;
- the execution status and duration;
- the target app slug; and
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
