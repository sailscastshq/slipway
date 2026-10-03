import { getCredentials, isLoggedIn } from './config.js'
import { APIError } from './api.js'

// Awaitable streams: protocol errors and missing terminal receipts must fail callers.
export async function streamRequest(
  path,
  { method = 'GET', body, format, onEvent, signal } = {}
) {
  if (!isLoggedIn())
    throw new Error('Not logged in. Run `slipway login` first.')
  const { server, token } = getCredentials()
  const response = await fetch(`${server}/api/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: format === 'sse' ? 'text/event-stream' : 'application/x-ndjson',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal
  })
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new APIError(
      data.message ||
        (typeof data.error === 'string' ? data.error : data.error?.message) ||
        `Request failed (${response.status}).`,
      response.status,
      data
    )
  }
  const expected =
    format === 'sse' ? 'text/event-stream' : 'application/x-ndjson'
  if (
    !response.headers.get('content-type')?.includes(expected) ||
    !response.body
  )
    throw new Error('Unexpected stream response from Slipway server.')
  const decoder = new TextDecoder()
  let buffer = ''
  let data = []
  let event = 'message'
  const line = (value) => {
    value = value.replace(/\r$/, '')
    if (format !== 'sse') {
      if (value.trim()) {
        let event
        try {
          event = JSON.parse(value)
        } catch {
          throw new Error('Slipway sent an invalid stream event.')
        }
        onEvent(event)
      }
      return
    }
    if (!value) {
      if (data.length) {
        let parsed
        try {
          parsed = JSON.parse(data.join('\n'))
        } catch {
          throw new Error('Slipway sent an invalid stream event.')
        }
        onEvent({ event, data: parsed })
      }
      data = []
      event = 'message'
    } else if (value.startsWith('data:'))
      data.push(value.slice(5).replace(/^ /, ''))
    else if (value.startsWith('event:')) event = value.slice(6).trim()
  }
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true })
    if (buffer.length > 2 * 1024 * 1024)
      throw new Error('Stream event exceeds the CLI response limit.')
    let index
    while ((index = buffer.indexOf('\n')) >= 0) {
      line(buffer.slice(0, index))
      buffer = buffer.slice(index + 1)
    }
  }
  buffer += decoder.decode()
  if (format !== 'sse' && buffer.trim()) line(buffer)
  else if (buffer || data.length)
    throw new Error('Slipway stream ended with an incomplete event.')
}
