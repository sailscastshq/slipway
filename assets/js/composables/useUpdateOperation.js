import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useEventSource } from '@/composables/sse'

const phase = ref('')
const detail = ref('')
const targetVersion = ref(null)
const operationId = ref(null)
const canRetry = ref(true)
const error = ref(null)
const connectionNotice = ref('')
const terminal = new Set(['success', 'failed', 'rolled-back', 'interrupted'])
const updating = computed(() => !!phase.value && !terminal.has(phase.value))
const observers = new Set()
let streamStarted = false
const connectStream = () => {
  if (stream && !streamStarted) {
    streamStarted = true
    stream.connect()
  }
}
let subscribers = 0,
  timer,
  stream,
  reading = false,
  posting = false,
  generation = 0,
  sequence = -1,
  reloadTimer,
  idleReads = 0,
  observedActive = false

export const updatePhaseLabels = {
  starting: 'Starting update…',
  checking: 'Checking update…',
  pulling: 'Downloading release…',
  'backing-up': 'Verifying database backups…',
  inspecting: 'Preserving configuration…',
  validating: 'Checking migration preflight…',
  swapping: 'Replacing Slipway…',
  waiting: 'Waiting for normal startup…',
  'rolling-back': 'Restoring previous version…',
  'rolled-back': 'Previous version restored',
  interrupted: 'Update needs attention',
  reconnecting: 'Reconnecting to update…',
  failed: 'Update failed',
  success: 'Update complete! Reloading...'
}
async function request(url, options = {}) {
  const controller = new AbortController()
  let timeout
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(url, {
          ...options,
          signal: controller.signal
        })
        const data = await response.json()
        if (!response.ok) {
          const failure = new Error(
            data.message || 'Update request was not accepted.'
          )
          failure.definitive = response.status >= 400 && response.status < 500
          throw failure
        }
        return data
      })(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort()
          reject(new Error('Update request deadline exceeded.'))
        }, 10000)
      })
    ])
  } finally {
    clearTimeout(timeout)
  }
}
function accept(data) {
  if (!data || typeof data.phase !== 'string') return
  if (data.phase === 'idle') {
    if (
      !posting &&
      phase.value === 'reconnecting' &&
      !operationId.value &&
      ++idleReads >= 2
    ) {
      phase.value = 'failed'
      error.value =
        'No updater operation was admitted. It is safe to retry the request.'
      canRetry.value = true
    } else if (!posting && updating.value && operationId.value) {
      phase.value = 'interrupted'
      error.value =
        'The updater operation is missing. Inspect the retained containers before retrying.'
      canRetry.value = false
    }
    if (!posting && !updating.value && !error.value) {
      phase.value = ''
      operationId.value = null
    }
    return
  }
  if (
    data.operationId === operationId.value &&
    Number.isFinite(data.sequence) &&
    data.sequence < sequence
  )
    return
  if (data.operationId !== operationId.value) sequence = -1
  operationId.value = data.operationId || operationId.value
  sequence = data.sequence ?? sequence
  phase.value = data.phase
  targetVersion.value = data.targetVersion || targetVersion.value
  detail.value = data.detail || ''
  canRetry.value = data.canRetry === true
  connectionNotice.value = ''
  error.value = ['failed', 'rolled-back', 'interrupted'].includes(data.phase)
    ? detail.value || 'Inspect the retained update operation before retrying.'
    : null
  if (updating.value) observedActive = true
  if (data.phase === 'success' && observedActive && !reloadTimer)
    reloadTimer = setTimeout(() => window.location.reload(), 1500)
  if (updating.value) connectStream()
  else {
    stream?.close()
    streamStarted = false
  }
}
async function refresh() {
  if (reading) return
  reading = true
  const epoch = generation
  try {
    const data = await request('/api/v1/system/update-status')
    if (epoch === generation) accept(data)
  } catch {
    if (epoch === generation)
      connectionNotice.value =
        'Connection interrupted. Reconnecting to the update; no rollback has been confirmed.'
  } finally {
    reading = false
  }
}
async function applyUpdate(version) {
  if (
    posting ||
    updating.value ||
    (phase.value === 'success' && targetVersion.value === version)
  )
    return
  posting = true
  operationId.value = null
  idleReads = 0
  sequence = -1
  generation++
  stream?.close()
  streamStarted = false
  error.value = null
  phase.value = 'starting'
  detail.value = 'Starting the shared server update workflow…'
  canRetry.value = false
  targetVersion.value = version || targetVersion.value
  try {
    accept(
      await request('/api/v1/system/apply-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
    )
    connectStream()
  } catch (failure) {
    if (failure.definitive) {
      phase.value = 'failed'
      error.value = failure.message
      canRetry.value = true
    } else {
      phase.value = 'reconnecting'
      detail.value =
        'The request may have been accepted. Checking its durable status before retrying.'
      connectStream()
    }
  } finally {
    posting = false
    refresh()
  }
}
export function useUpdateOperation() {
  // The singleton observer is shared by the settings page and the reachable modal.
  const source = useEventSource('/api/v1/system/stream-update', {
    immediate: false,
    autoReconnect: true,
    onMessage: accept,
    onError: () => {
      streamStarted = false
      refresh()
    }
  })
  onMounted(() => {
    observers.add(source)
    subscribers++
    if (subscribers === 1) {
      stream = source
      refresh()
      timer = setInterval(refresh, 2000)
    }
  })
  onUnmounted(() => {
    observers.delete(source)
    subscribers--
    if (!subscribers) {
      clearInterval(timer)
      clearTimeout(reloadTimer)
      reloadTimer = null
      stream?.close()
      stream = null
      streamStarted = false
      generation++
    } else if (stream === source) {
      stream.close()
      stream = [...observers][0]
      streamStarted = false
      if (updating.value) connectStream()
    }
  })
  return {
    updating,
    updateError: error,
    updatePhase: phase,
    updateDetail: detail,
    updateTargetVersion: targetVersion,
    connectionNotice,
    canRetry,
    applyUpdate,
    refreshUpdate: refresh,
    phaseLabels: updatePhaseLabels
  }
}

export { request as requestUpdateJson }
