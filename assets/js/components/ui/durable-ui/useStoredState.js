import { onMounted, onScopeDispose, ref, watch } from 'vue'
import {
  readStored,
  removeStored,
  subscribeStored,
  writeStored
} from './core.js'

export function useStoredState(key, fallback, options = {}) {
  const state = ref(fallback)
  const restored = ref(false)
  let stopStorage = () => {}
  let syncing = false

  function read() {
    const stored = readStored(key, fallback, options)
    syncing = true
    state.value = stored.value
    syncing = false
    restored.value = true
  }

  function reset() {
    removeStored(key, options)
    syncing = true
    state.value = fallback
    syncing = false
  }

  onMounted(() => {
    read()
    stopStorage = subscribeStored(key, read, options)
  })
  onScopeDispose(() => stopStorage())

  watch(
    state,
    (value) => {
      if (restored.value && !syncing) writeStored(key, value, fallback, options)
    },
    { deep: true, flush: 'sync' }
  )

  return Object.assign(state, { reset, restored })
}
