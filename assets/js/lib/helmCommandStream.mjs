const TERMINAL_STATES = new Set([
  'success',
  'error',
  'timeout',
  'cancelled',
  'unconfirmed'
])

export async function readHelmCommandStream(
  response,
  { executionId, onEvent, maxBytes = 4 * 1024 * 1024 }
) {
  if (!response.ok) {
    const text = await readErrorBody(response)
    let data
    try {
      data = JSON.parse(text)
    } catch {
      data = {}
    }
    const error = new Error(
      data.message || `Command request failed (HTTP ${response.status}).`
    )
    error.code = data.code || 'HELM_COMMAND_REQUEST_FAILED'
    error.requestFailed = true
    throw error
  }
  if (!response.body?.getReader)
    throw new Error('Command stream is unavailable.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let bytes = 0
  let result = null
  let accepted = false
  const consume = (line) => {
    if (!line.trim()) return
    const event = JSON.parse(line)
    if (event.type === 'accepted') {
      if (accepted || event.executionId !== executionId)
        throw new Error('Command stream identity mismatch.')
      accepted = true
    } else if (!accepted || result) {
      throw new Error('Command stream event order is invalid.')
    }
    if (event.type === 'result') {
      if (
        event.executionId !== executionId ||
        !TERMINAL_STATES.has(event.result?.status)
      ) {
        throw new Error(
          'Command result is invalid or belongs to another execution.'
        )
      }
      const value = event.result
      if (
        !(
          value.exitCode === null ||
          (Number.isInteger(value.exitCode) && value.exitCode >= 0)
        ) ||
        value.success !== (value.status === 'success') ||
        (value.status === 'success' && value.exitCode !== 0) ||
        (value.status !== 'unconfirmed' && value.terminationConfirmed !== true)
      ) {
        throw new Error('Command result has contradictory exit evidence.')
      }
      result = value
    } else if (['accepted', 'started'].includes(event.type)) {
      onEvent(event)
    } else if (
      ['stdout', 'stderr'].includes(event.type) &&
      typeof event.text === 'string'
    ) {
      onEvent(event)
    } else {
      throw new Error('Command stream event is invalid.')
    }
  }
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > maxBytes)
        throw new Error('Command stream exceeded its transport limit.')
      buffer += decoder.decode(value, { stream: true })
      let boundary
      while ((boundary = buffer.indexOf('\n')) !== -1) {
        consume(buffer.slice(0, boundary))
        buffer = buffer.slice(boundary + 1)
      }
    }
    buffer += decoder.decode()
    if (buffer.trim()) consume(buffer)
    if (!result)
      throw new Error('The command stream ended without a verified result.')
    return result
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally {
    reader.releaseLock()
  }
}

async function readErrorBody(response) {
  if (!response.body?.getReader) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let remaining = 4096
  try {
    while (remaining > 0) {
      const { done, value } = await reader.read()
      if (done) return text + decoder.decode()
      const bytes = value.subarray(0, remaining)
      remaining -= bytes.byteLength
      text += decoder.decode(bytes, { stream: true })
    }
    await reader.cancel()
    return text
  } finally {
    reader.releaseLock()
  }
}
