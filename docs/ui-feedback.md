# Warning and error feedback

Use the source-owned Klean `Alert` component for persistent warning, failure,
recovery, and configuration notices. Import it from
`@/components/ui/alert/Alert.vue`; style the notice at its call site, including
its dark-mode colors. Keep the message close to the affected content and retain
any useful retry action.

Use `role="alert"` for an actionable failure and `role="status"` for a passive
status update. Keep field-specific validation next to its input with its existing
accessible association. Use Klean `ErrorState` for an unavailable content view;
logs and query diagnostics retain their specialized presentation.

Show a failure once. When a persistent Alert already explains a failed operation,
do not duplicate the same message in a toast.

Confirmation dialogs have at most two CTAs, in one footer. Keep optional work in
the originating screen: for example, an unsaved-content dialog offers Keep editing
and Discard and leave, while Save remains in the editor. The ConfirmModal form
slot is for fields, not additional action buttons.

Capture and share updated screenshots when changing visible feedback. Verify
that retry, dismissal, retained input, and keyboard behavior still work.
