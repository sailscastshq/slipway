import { onMounted, onUnmounted, ref } from 'vue'
import { io } from 'socket.io-client'

const BEARING_FEEDBACK_EVENT = 'bearing:feedback'
const BEARING_UPDATE_EVENT = 'bearing:update'
const SAILS_SDK_QUERY = {
  __sails_io_sdk_version: '1.2.1',
  __sails_io_sdk_platform: 'browser',
  __sails_io_sdk_language: 'javascript'
}

export function useBearingRealtime(
  realtime,
  { onSnapshot, onEvent, onUpdate = () => {} }
) {
  const state = ref('connecting')
  const lastSyncedAt = ref(null)
  let socket

  function subscribe() {
    if (!socket?.connected) return
    state.value = 'syncing'
    socket.emit(
      'get',
      {
        method: 'get',
        url: `${realtime.subscribePath}?token=${encodeURIComponent(
          realtime.token
        )}`,
        headers: {}
      },
      (response = {}) => {
        if (response.statusCode >= 400 || !response.body) {
          state.value = 'unavailable'
          return
        }
        const syncedAt = response.body.syncedAt || Date.now()
        onSnapshot(
          response.body.feedback || [],
          syncedAt,
          response.body.updates || []
        )
        lastSyncedAt.value = syncedAt
        state.value = 'connected'
      }
    )
  }

  onMounted(() => {
    if (!realtime?.token || !realtime?.socketPath) {
      state.value = 'unavailable'
      return
    }

    socket = io(window.location.origin, {
      path: realtime.socketPath,
      transports: ['websocket'],
      reconnection: true,
      query: {
        ...SAILS_SDK_QUERY,
        bearingRealtimeToken: realtime.token
      }
    })
    socket.on('connect', subscribe)
    socket.on(BEARING_FEEDBACK_EVENT, onEvent)
    socket.on(BEARING_UPDATE_EVENT, onUpdate)
    socket.on('disconnect', () => {
      state.value = 'reconnecting'
    })
    socket.on('connect_error', () => {
      state.value = 'reconnecting'
    })
  })

  onUnmounted(() => {
    if (!socket) return
    socket.off('connect', subscribe)
    socket.off(BEARING_FEEDBACK_EVENT, onEvent)
    socket.off(BEARING_UPDATE_EVENT, onUpdate)
    socket.disconnect()
  })

  return { state, lastSyncedAt }
}
