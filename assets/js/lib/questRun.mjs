// This legacy endpoint returns a Docker-client process receipt, not a stable run
// identity or the script's business result. Never synthesize history from it.
export async function requestQuestRun(url, fetchRequest = fetch) {
  const unconfirmed = (error) => ({
    state: 'unconfirmed',
    success: false,
    stdout: '',
    stderr: '',
    exitCode: null,
    error:
      error ||
      'No execution result was received. The job may still be running. Check history before retrying.'
  })

  let response
  try {
    response = await fetchRequest(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    })
  } catch {
    return unconfirmed()
  }

  // Even a JSON error response can look like a job result. HTTP rejection is
  // request evidence only; it cannot establish a process exit or create a run.
  if (!response.ok) {
    return {
      ...unconfirmed(),
      state: 'request_failed',
      error: `Request failed (HTTP ${response.status}). No execution result was received. Check history before retrying.`
    }
  }

  let data
  try {
    data = await response.json()
  } catch {
    return unconfirmed()
  }

  if (
    !data ||
    !Number.isInteger(data.exitCode) ||
    data.exitCode < 0 ||
    data.success !== (data.exitCode === 0)
  ) {
    return {
      ...unconfirmed(),
      stdout: typeof data?.output === 'string' ? data.output : '',
      stderr: typeof data?.stderr === 'string' ? data.stderr : ''
    }
  }

  return {
    state: data.success ? 'completed' : 'failed',
    success: data.success,
    stdout: typeof data.output === 'string' ? data.output : '',
    // Older servers returned stderr under `error`, including on exit zero.
    stderr:
      typeof data.stderr === 'string'
        ? data.stderr
        : typeof data.error === 'string'
        ? data.error
        : '',
    error: !data.success && typeof data.error === 'string' ? data.error : '',
    exitCode: data.exitCode
  }
}
