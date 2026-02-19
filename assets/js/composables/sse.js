import { ref, onUnmounted, isRef, unref } from 'vue'

/**
 * Vue composable for Server-Sent Events.
 *
 * Handles connection lifecycle, JSON parsing, reactive state,
 * auto-reconnect, and cleanup on unmount.
 *
 * @param {string|Ref<string>} url - The SSE endpoint URL
 * @param {object} [options]
 * @param {boolean}  [options.immediate=true]       - Connect immediately on creation
 * @param {boolean}  [options.autoReconnect=true]    - Reconnect on error/close
 * @param {number}   [options.reconnectDelay=3000]   - Ms to wait before reconnecting
 * @param {Function} [options.onMessage]             - Called with parsed JSON data for each event
 *
 * @returns {{ data, connected, error, close, connect }}
 */
export function useEventSource(url, options = {}) {
  const {
    immediate = true,
    autoReconnect = true,
    reconnectDelay = 3000,
    onMessage
  } = options

  const data = ref(null)
  const connected = ref(false)
  const error = ref(null)

  let es = null
  let reconnectTimer = null
  let unmounted = false

  function connect() {
    close()
    error.value = null

    const resolvedUrl = isRef(url) ? unref(url) : url
    if (!resolvedUrl) return

    es = new EventSource(resolvedUrl)

    es.onopen = () => {
      connected.value = true
      error.value = null
    }

    es.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data)
        data.value = parsed

        if (parsed.error) {
          error.value = parsed.error
        }

        if (parsed.closed) {
          connected.value = false
        }

        if (onMessage) {
          onMessage(parsed)
        }
      } catch (e) {
        // Non-JSON event — ignore
      }
    }

    es.onerror = () => {
      connected.value = false
      if (es) {
        es.close()
        es = null
      }

      if (!unmounted && autoReconnect) {
        if (!error.value) {
          error.value = 'Connection lost. Reconnecting...'
        }
        reconnectTimer = setTimeout(() => {
          if (!unmounted) connect()
        }, reconnectDelay)
      }
    }
  }

  function close() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (es) {
      es.close()
      es = null
    }
    connected.value = false
  }

  if (immediate) {
    connect()
  }

  onUnmounted(() => {
    unmounted = true
    close()
  })

  return { data, connected, error, close, connect }
}
