import { computed, onBeforeUnmount, ref, watch } from 'vue'

export function useSearch(source, search, options = {}) {
  const results = ref([])
  const loading = ref(false)
  const error = ref(null)
  const searched = ref(false)
  let controller
  let timer

  const query = computed(() => String(read(source) ?? '').trim())
  const empty = computed(
    () =>
      searched.value && !loading.value && !error.value && !results.value.length
  )

  function cancel() {
    clearTimeout(timer)
    controller?.abort()
    controller = undefined
    loading.value = false
  }

  async function run(next = query.value) {
    cancel()
    const normalized = String(next ?? '').trim()
    if (normalized.length < (options.minLength ?? 1)) {
      results.value = []
      searched.value = false
      error.value = null
      return []
    }

    controller = new AbortController()
    const active = controller
    loading.value = true
    error.value = null
    try {
      const found = await search(normalized, { signal: active.signal })
      if (active !== controller) return results.value
      results.value = found ?? []
      searched.value = true
      return results.value
    } catch (reason) {
      if (reason?.name === 'AbortError') return results.value
      if (active === controller) {
        error.value = reason
        searched.value = true
        options.onError?.(reason)
      }
      return results.value
    } finally {
      if (active === controller) loading.value = false
    }
  }

  watch(
    query,
    (next) => {
      cancel()
      timer = setTimeout(() => run(next), options.debounceMs ?? 250)
    },
    { immediate: options.immediate !== false }
  )
  onBeforeUnmount(cancel)

  return { cancel, empty, error, loading, query, results, run, searched }
}

function read(source) {
  return typeof source === 'function' ? source() : source?.value ?? source
}
