export function mutationFailureMessage(error) {
  return (
    error?.mutationMessage ||
    'Connection interrupted. We could not confirm the result. Your edits are still here; check the current status before retrying.'
  )
}

export async function assertMutationResponse(response) {
  if (response.ok) return response
  const body = await response.json().catch(() => null)
  const message =
    response.status === 401 || response.status === 419
      ? 'Your session expired. Sign in again in another tab, then retry.'
      : response.status === 403
      ? 'You no longer have permission to make this change.'
      : body?.message ||
        `The server could not complete this change (${response.status}).`
  const error = new Error(message)
  error.mutationMessage = message
  throw error
}
