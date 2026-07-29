export async function cancelHelmExecution(executionId, csrfToken = '') {
  const response = await fetch(
    `/api/v1/helm/executions/${executionId}/cancel`,
    {
      method: 'POST',
      headers: csrfToken ? { 'x-csrf-token': csrfToken } : {}
    }
  )
  const text = await response.text()
  let result

  try {
    result = text ? JSON.parse(text) : {}
  } catch {
    throw new Error(text || 'Could not stop Helm execution.')
  }

  if (!response.ok) {
    throw new Error(
      result.message || result.error || 'Could not stop Helm execution.'
    )
  }

  return result.cancelled === true
}

export function cancelledHelmResult(durationMs) {
  return {
    success: false,
    status: 'cancelled',
    value: null,
    logs: [],
    output: null,
    outputBytes: 0,
    rowCount: null,
    error: {
      name: 'CancelledError',
      message: 'Helm execution was cancelled.',
      stack: null,
      filename: null,
      line: null,
      column: null,
      code: 'HELM_CANCELLED'
    },
    durationMs,
    truncated: false,
    logsPartial: false
  }
}
