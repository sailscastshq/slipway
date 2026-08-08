import { onMounted, onUnmounted, ref, watch } from 'vue'

export function useFormDraft(key, form, options = {}) {
  const ttl = options.ttl || 60 * 60 * 1000
  const excludedFields = new Set(options.exclude || [])
  const restored = ref(false)
  let saveTimer

  onMounted(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(key) || 'null')
      if (!saved || saved.expiresAt < Date.now()) {
        window.localStorage.removeItem(key)
        return
      }
      for (const field of Object.keys(form.data())) {
        if (excludedFields.has(field)) continue
        if (Object.hasOwn(saved.data || {}, field))
          form[field] = saved.data[field]
      }
      restored.value = true
    } catch {
      window.localStorage.removeItem(key)
    }
  })

  watch(
    () => form.data(),
    (data) => {
      window.clearTimeout(saveTimer)
      saveTimer = window.setTimeout(() => {
        const persistedData = Object.fromEntries(
          Object.entries(data).filter(
            ([field, value]) =>
              !excludedFields.has(field) &&
              !(typeof File !== 'undefined' && value instanceof File) &&
              !(typeof Blob !== 'undefined' && value instanceof Blob)
          )
        )
        const hasContent =
          persistedData.title?.trim() || persistedData.details?.trim()
        if (!hasContent) return clear()
        try {
          window.localStorage.setItem(
            key,
            JSON.stringify({
              data: persistedData,
              expiresAt: Date.now() + ttl
            })
          )
        } catch {
          // Draft persistence is best-effort; the form remains usable.
        }
      }, 500)
    },
    { deep: true }
  )

  onUnmounted(() => window.clearTimeout(saveTimer))

  function clear() {
    try {
      window.localStorage.removeItem(key)
    } catch {
      // Ignore unavailable storage.
    }
    restored.value = false
  }

  return { clear, restored }
}
