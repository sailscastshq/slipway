import { computed, ref, unref, watch } from 'vue'
import { clone } from './core.js'

export function useOptimistic(source, commit, options = {}) {
  const value = ref(clone(unref(source)))
  const pending = ref(false)
  const error = ref(null)
  let operation = 0

  watch(
    () => unref(source),
    (next) => {
      if (!pending.value) value.value = clone(next)
    },
    { deep: true }
  )

  async function update(next) {
    if (pending.value && options.concurrent !== true) return false
    const id = ++operation
    const previous = clone(value.value)
    value.value = typeof next === 'function' ? next(value.value) : next
    pending.value = true
    error.value = null

    try {
      const confirmed = await commit(value.value, previous)
      if (id !== operation) return true
      if (confirmed !== undefined) value.value = clone(confirmed)
      options.onSuccess?.(value.value)
      return true
    } catch (reason) {
      if (id !== operation) return false
      value.value = previous
      error.value = reason
      options.onError?.(reason)
      return false
    } finally {
      if (id === operation) pending.value = false
    }
  }

  function reset(next = unref(source)) {
    operation += 1
    value.value = clone(next)
    pending.value = false
    error.value = null
  }

  return {
    busy: computed(() => pending.value),
    error,
    pending,
    reset,
    update,
    value
  }
}
