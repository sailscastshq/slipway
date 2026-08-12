import { ref, onScopeDispose, isRef, unref } from 'vue'

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
  let disposed = false
  let connectionSequence = 0
  let reconnectEnabled = false

  function connect() {
    close()
    if (disposed) return
    error.value = null

    const resolvedUrl = isRef(url) ? unref(url) : url
    if (!resolvedUrl) return

    reconnectEnabled = true
    const sequence = ++connectionSequence
    es = new EventSource(resolvedUrl)

    es.onopen = () => {
      if (sequence !== connectionSequence) return
      connected.value = true
      error.value = null
    }

    es.onmessage = (event) => {
      if (sequence !== connectionSequence) return
      try {
        const parsed = JSON.parse(event.data)
        data.value = parsed

        if (parsed.error) {
          error.value = parsed.error
        }

        if (parsed.closed) {
          close()
        }

        if (onMessage) {
          onMessage(parsed)
        }
      } catch (e) {
        // Non-JSON event — ignore
      }
    }

    es.onerror = () => {
      if (sequence !== connectionSequence) return
      connected.value = false
      if (es) {
        es.close()
        es = null
      }

      if (!unmounted && reconnectEnabled && autoReconnect) {
        if (!error.value) {
          error.value = 'Connection lost. Reconnecting...'
        }
        if (reconnectTimer) clearTimeout(reconnectTimer)
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null
          if (!unmounted && reconnectEnabled) connect()
        }, reconnectDelay)
      }
    }
  }

  function close() {
    reconnectEnabled = false
    connectionSequence += 1
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

  function dispose() {
    if (disposed) return
    disposed = true
    unmounted = true
    close()
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', dispose)
      window.removeEventListener('beforeunload', dispose)
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', dispose)
    window.addEventListener('beforeunload', dispose)
  }

  onScopeDispose(dispose)

  return { data, connected, error, close, connect }
}
