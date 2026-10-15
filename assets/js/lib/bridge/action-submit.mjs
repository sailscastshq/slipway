// Captions affect presentation only. The submitted values and target helper
// remain the authority for preview/send validation and authorization.
export function bridgeActionSubmitCaption(action, values = {}) {
  if (!action?.submit) {
    return { label: action?.label || '', processingLabel: 'Running…' }
  }
  return values[action.submit.field] === true
    ? action.submit.whenTrue
    : action.submit.whenFalse
}
