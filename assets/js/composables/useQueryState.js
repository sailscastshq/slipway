import { ref, watch, onMounted, onUnmounted } from 'vue'

export function useQueryState(key, defaultValue = '', options = {}) {
  const { replace = false } = options

  const value = ref(defaultValue)

  // Read initial value from URL on mount
  onMounted(() => {
    const params = new URLSearchParams(window.location.search)
    const urlValue = params.get(key)
    if (urlValue !== null) {
      value.value = urlValue
    }
  })

  // Update URL when value changes
  watch(value, (newValue) => {
    if (typeof window === 'undefined') return

    const url = new URL(window.location.href)
    if (newValue && newValue !== defaultValue) {
      url.searchParams.set(key, newValue)
    } else {
      url.searchParams.delete(key)
    }

    const method = replace ? 'replaceState' : 'pushState'
    window.history[method]({}, '', url.toString())
  })

  // Listen for back/forward navigation
  function onPopState() {
    const params = new URLSearchParams(window.location.search)
    value.value = params.get(key) ?? defaultValue
  }

  onMounted(() => window.addEventListener('popstate', onPopState))
  onUnmounted(() => window.removeEventListener('popstate', onPopState))

  return value
}
