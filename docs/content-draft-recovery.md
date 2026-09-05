# Unsaved content

Content Manager warns before leaving a dirty editor. Save and leave continues
only after a successful save; validation and server failures keep the editor
open. Edits made while a save is in flight remain unsaved.

A recovery copy is kept in session storage for the current tab, scoped to the
signed-in user, project, environment, app, collection, and file. It expires after
30 minutes without an update and is removed on successful save or explicit
discard. A returning editor offers Restore draft or Discard draft. The draft
retains its original source revision, so restoring it does not bypass repository
conflict checks.

Reload and tab-close use the browser's native warning. Inertia's history
navigation is not cancellable, so Back/Forward uses draft recovery instead.
If browser storage is unavailable or full, an inline warning asks the user to
save before leaving. These drafts apply only to content; credentials and
configuration forms are not stored by this feature.
