import { getCredentials } from './config.js'

/**
 * Connect to a Server-Sent Events endpoint
 *
 * @param {string} path - API path (e.g., '/cli/auth/stream')
 * @param {object} options - Options
 * @param {function} options.onMessage - Called for each message
 * @param {function} options.onError - Called on error
 * @param {function} options.onClose - Called when stream closes
 * @returns {function} - Call to abort the connection
 */
export function connectSSE(path, { onMessage, onError, onClose }) {
  const { server, token } = getCredentials()
  const url = `${server}/api/v1${path}`

  const controller = new AbortController()

  ;(async () => {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'text/event-stream',
          Authorization: token ? `Bearer ${token}` : undefined
        },
        signal: controller.signal
      })

      if (!response.ok) {
        throw new Error(`SSE connection failed: ${response.status}`)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()

        if (done) {
          if (onClose) onClose()
          break
        }

        buffer += decoder.decode(value, { stream: true })

        // Parse SSE format: "event: type\ndata: json\n\n"
        const lines = buffer.split('\n')
        buffer = ''

        let eventType = 'message'
        let eventData = null

        for (const line of lines) {
          if (line.startsWith('event:')) {
            eventType = line.slice(6).trim()
          } else if (line.startsWith('data:')) {
            const dataStr = line.slice(5).trim()
            try {
              eventData = JSON.parse(dataStr)
            } catch {
              eventData = dataStr
            }
          } else if (line === '' && eventData !== null) {
            // Empty line means end of event
            if (onMessage) {
              onMessage(eventType, eventData)
            }
            eventType = 'message'
            eventData = null
          } else if (line !== '') {
            // Incomplete event, save for next chunk
            buffer = line
          }
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        if (onClose) onClose()
      } else {
        if (onError) onError(err)
      }
    }
  })()

  // Return abort function
  return () => controller.abort()
}

/**
 * Subscribe to deployment status updates
 */
export function subscribeToDeployment(deploymentId, callbacks) {
  return connectSSE(`/deployments/${deploymentId}/stream`, callbacks)
}

/**
 * Subscribe to CLI auth confirmation
 */
export function subscribeToAuthConfirmation(code, callbacks) {
  return connectSSE(`/cli/auth/stream?code=${code}`, callbacks)
}
