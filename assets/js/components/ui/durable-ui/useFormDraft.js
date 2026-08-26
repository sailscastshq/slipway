import {
  computed,
  isRef,
  onBeforeUnmount,
  onMounted,
  ref,
  toRaw,
  unref,
  watch
} from 'vue'
import {
  clearDraft,
  clone,
  empty,
  equal,
  readDraft,
  writeDraft
} from './core.js'

export function useFormDraft(key, source, options = {}) {
  const draft = ref(null)
  const restored = ref(false)
  const initial = ref(clone(readSource(source)))
  const dirty = computed(() => !equal(readSource(source), initial.value))
  const hasDraft = computed(() => Boolean(draft.value))
  const savedAt = computed(() =>
    draft.value?.savedAt ? new Date(draft.value.savedAt) : null
  )
  let timer

  function load() {
    draft.value = readDraft(key, options)
    return draft.value
  }

  function restore() {
    if (!draft.value) return null
    const data = clone(draft.value.data)
    if (options.restore) options.restore(data)
    else writeSource(source, data)
    restored.value = true
    return data
  }

  function discard() {
    clearTimeout(timer)
    clearDraft(key, options)
    draft.value = null
    restored.value = false
  }

  function clear() {
    discard()
    initial.value = clone(readSource(source))
  }

  function save(data = readSource(source)) {
    draft.value = writeDraft(key, strip(data, options.exclude), {
      isEmpty: options.isEmpty || empty,
      ...options
    })
    return draft.value
  }

  function guard(event) {
    if (options.guard === false || !dirty.value) return
    event.preventDefault()
    event.returnValue = ''
  }

  onMounted(() => {
    load()
    window.addEventListener('beforeunload', guard)
  })
  onBeforeUnmount(() => {
    clearTimeout(timer)
    window.removeEventListener('beforeunload', guard)
  })

  watch(
    () => readSource(source),
    (data) => {
      if (options.enabled === false || readSource(options.clearWhen)) return
      clearTimeout(timer)
      timer = setTimeout(() => save(data), options.debounceMs ?? 500)
    },
    { deep: true }
  )

  watch(
    () => readSource(options.clearWhen),
    (shouldClear) => {
      if (shouldClear) clear()
    }
  )

  return {
    clear,
    dirty,
    discard,
    draft,
    hasDraft,
    load,
    restore,
    restored,
    save,
    savedAt
  }
}

function readSource(source) {
  if (typeof source === 'function') return source()
  return toRaw(unref(source))
}

function writeSource(source, data) {
  if (isRef(source)) source.value = data
  else if (source && typeof source === 'object') Object.assign(source, data)
}

function strip(data, excluded = []) {
  const blocked = new Set(excluded)
  return Object.fromEntries(
    Object.entries(clone(data)).filter(
      ([key, value]) =>
        !blocked.has(key) &&
        !(typeof File !== 'undefined' && value instanceof File) &&
        !(typeof Blob !== 'undefined' && value instanceof Blob)
    )
  )
}
