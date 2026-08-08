import { ref, watch, onMounted, onUnmounted } from 'vue'

export function useQueryState(key, defaultValue = '', options = {}) {
  const {
    replace = false,
    initialValue = defaultValue,
    allowedValues = null
  } = options

  function normalize(candidate) {
    const nextValue = candidate ?? defaultValue
    if (allowedValues && !allowedValues.includes(nextValue)) {
      return defaultValue
    }
    return nextValue
  }

  function readUrlValue() {
    const params = new URLSearchParams(window.location.search)
    return normalize(params.get(key))
  }

  const value = ref(normalize(initialValue))
  let syncingFromUrl = false

  // Reconcile the server-rendered value with the browser URL after hydration.
  onMounted(() => {
    const urlValue = readUrlValue()
    if (value.value !== urlValue) {
      syncingFromUrl = true
      value.value = urlValue
      syncingFromUrl = false
    }
  })

  // Update URL when value changes
  watch(
    value,
    (newValue) => {
      if (typeof window === 'undefined' || syncingFromUrl) return

      const normalizedValue = normalize(newValue)
      if (normalizedValue !== newValue) {
        syncingFromUrl = true
        value.value = normalizedValue
        syncingFromUrl = false
        return
      }

      const url = new URL(window.location.href)
      if (normalizedValue && normalizedValue !== defaultValue) {
        url.searchParams.set(key, normalizedValue)
      } else {
        url.searchParams.delete(key)
      }

      const method = replace ? 'replaceState' : 'pushState'
      window.history[method](window.history.state, '', url.toString())
    },
    { flush: 'sync' }
  )

  // Listen for back/forward navigation
  function onPopState() {
    syncingFromUrl = true
    value.value = readUrlValue()
    syncingFromUrl = false
  }

  onMounted(() => window.addEventListener('popstate', onPopState))
  onUnmounted(() => window.removeEventListener('popstate', onPopState))

  return value
}
