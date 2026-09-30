# Unsaved content

Content Manager warns before leaving a dirty editor with exactly two actions:
Keep editing or Discard and leave. Save from the editor before navigating away;
validation and server failures preserve edits. Edits made while a save is in
flight remain unsaved.

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

Bearing update composers use the same tab-local, user/project/environment/app
scoping and 30-minute recovery window. Restore update recovers title, summary,
Markdown body, and linked feedback. Discard update removes the recovery copy.
Switching drafts or starting a new update asks before discarding unsaved changes.
After a successful draft save, edits typed during the request remain unsaved on
the same draft; another save updates that draft rather than creating a duplicate.
After publishing, newer edits remain in the composer as a new update. Recovery
copies are removed only when the submitted content is still current or the user
explicitly discards it. Saved drafts that were deleted or published elsewhere
restore as a new update instead of targeting an unavailable draft.
