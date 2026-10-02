import { computed, onScopeDispose, ref, watch } from 'vue'
import { LOCAL_STORAGE_KEYS } from '../lib/localStorageKeys.js'
import {
  HELM_SCRATCHPAD_DEFAULT_SOURCE,
  HELM_SCRATCHPAD_LIMIT,
  createHelmScratchpad,
  duplicateHelmScratchpadName,
  nextHelmScratchpadName,
  parseHelmScratchpadState,
  serializeHelmScratchpadState,
  snapshotHelmTarget
} from '../lib/helmScratchpads.mjs'
import { createHelmScratchpadPersistence } from '../lib/helmScratchpadPersistence.mjs'

export function useHelmScratchpads(targetSource) {
  const tabs = ref([])
  const activeByTarget = ref({})
  const runtime = ref({})
  const ready = ref(false)
  const currentTarget = computed(() =>
    snapshotHelmTarget(
      typeof targetSource === 'function' ? targetSource() : targetSource
    )
  )
  const currentTargetKey = computed(() => currentTarget.value?.key || '')
  const activeId = computed(
    () => activeByTarget.value[currentTargetKey.value] || ''
  )
  const activeTab = computed(
    () => tabs.value.find((tab) => tab.id === activeId.value) || null
  )
  const visibleTabs = computed(() =>
    tabs.value.filter((tab) => tab.target.key === currentTargetKey.value)
  )
  const canCreate = computed(() => tabs.value.length < HELM_SCRATCHPAD_LIMIT)

  const code = computed({
    get: () => activeTab.value?.source || HELM_SCRATCHPAD_DEFAULT_SOURCE,
    set: (source) => {
      update(activeId.value, { source: String(source), updatedAt: Date.now() })
    }
  })
  const view = computed({
    get: () => activeTab.value?.view || 'auto',
    set: (selectedView) => {
      update(activeId.value, {
        view: selectedView,
        updatedAt: Date.now()
      })
      persistence.flush()
    }
  })
  const result = computed({
    get: () => runtime.value[activeId.value]?.result || null,
    set: (value) => setRuntime(activeId.value, { result: value })
  })
  const error = computed({
    get: () => runtime.value[activeId.value]?.error || '',
    set: (value) => setRuntime(activeId.value, { error: String(value || '') })
  })

  const persistence = createHelmScratchpadPersistence({
    readState: () => ({
      tabs: tabs.value,
      activeByTarget: activeByTarget.value
    }),
    serialize: serializeHelmScratchpadState,
    writeState: (serialized) => {
      window.localStorage.setItem(
        LOCAL_STORAGE_KEYS.helmScratchpads,
        serialized
      )
    },
    onError: (error) => console.warn('Could not save Helm scratchpads:', error)
  })

  initialize()

  // All persisted updates replace these refs. Avoid walking every saved tab on
  // each keystroke, and defer serialization until the autosave actually runs.
  watch(
    [tabs, activeByTarget],
    () => {
      if (!ready.value || typeof window === 'undefined') return
      persistence.schedule()
    },
    { flush: 'sync' }
  )

  if (typeof window !== 'undefined') {
    persistence.save()
    const flush = () => persistence.flush()
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', flushWhenHidden)
    onScopeDispose(() => {
      flush()
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', flushWhenHidden)
    })
  }

  function initialize() {
    const state = readState()
    const target = currentTarget.value
    tabs.value = state.tabs
    activeByTarget.value = state.activeByTarget

    if (!target) {
      ready.value = true
      return
    }

    tabs.value = tabs.value.map((tab) =>
      tab.target.key === target.key ? { ...tab, target } : tab
    )
    let targetTabs = tabs.value.filter((tab) => tab.target.key === target.key)
    if (
      targetTabs.length === 0 &&
      !Object.hasOwn(activeByTarget.value, target.key) &&
      canCreate.value
    ) {
      const tab = createHelmScratchpad({
        name: nextHelmScratchpadName(tabs.value, target.key),
        target
      })
      tabs.value.push(tab)
      targetTabs = [tab]
    }

    const remembered = activeByTarget.value[target.key]
    if (!targetTabs.some((tab) => tab.id === remembered)) {
      activeByTarget.value = {
        ...activeByTarget.value,
        [target.key]: targetTabs[0]?.id || ''
      }
    }
    ready.value = true
  }

  function create({ source = HELM_SCRATCHPAD_DEFAULT_SOURCE } = {}) {
    if (!canCreate.value || !currentTarget.value) return null
    const tab = createHelmScratchpad({
      name: nextHelmScratchpadName(tabs.value, currentTargetKey.value),
      source,
      baselineSource: source,
      target: currentTarget.value
    })
    tabs.value = [...tabs.value, tab]
    activate(tab.id)
    return tab
  }

  function activate(id) {
    const tab = tabs.value.find((item) => item.id === id)
    if (!tab) return null
    activeByTarget.value = {
      ...activeByTarget.value,
      [tab.target.key]: tab.id
    }
    persistence.flush()
    return tab
  }

  function rename(id, name) {
    const tab = tabs.value.find((item) => item.id === id)
    if (!tab) return 'unchanged'
    const renamed = normalizeUpdate(tab, { name, updatedAt: Date.now() })
    if (renamed.name === tab.name) return 'unchanged'
    const nextTabs = tabs.value.map((item) => (item.id === id ? renamed : item))
    if (
      typeof window === 'undefined' ||
      !persistence.save({
        tabs: nextTabs,
        activeByTarget: activeByTarget.value
      })
    )
      return 'failed'
    tabs.value = nextTabs
    persistence.flush()
    return 'saved'
  }

  function duplicate(id) {
    if (!canCreate.value) return null
    const index = tabs.value.findIndex((tab) => tab.id === id)
    const original = tabs.value[index]
    if (!original) return null

    const copy = createHelmScratchpad({
      name: duplicateHelmScratchpadName(tabs.value, original),
      source: original.source,
      baselineSource: '',
      view: original.view,
      target: original.target
    })
    const nextTabs = [...tabs.value]
    nextTabs.splice(index + 1, 0, copy)
    tabs.value = nextTabs
    activate(copy.id)
    return copy
  }

  function move(id, offset) {
    const index = tabs.value.findIndex((tab) => tab.id === id)
    const targetTabs = tabs.value.filter(
      (tab) => tab.target.key === currentTargetKey.value
    )
    const targetIndex = targetTabs.findIndex((tab) => tab.id === id)
    const neighbor = targetTabs[targetIndex + offset]
    if (!neighbor) return
    const nextIndex = tabs.value.findIndex((tab) => tab.id === neighbor.id)
    if (index < 0 || nextIndex < 0 || nextIndex >= tabs.value.length) return
    const nextTabs = [...tabs.value]
    const [tab] = nextTabs.splice(index, 1)
    nextTabs.splice(nextIndex, 0, tab)
    tabs.value = nextTabs
    persistence.flush()
  }

  function close(id) {
    const index = tabs.value.findIndex((tab) => tab.id === id)
    const closing = tabs.value[index]
    if (!closing) return

    tabs.value = tabs.value.filter((tab) => tab.id !== id)
    const nextForTarget = tabs.value.filter(
      (tab) => tab.target.key === closing.target.key
    )
    delete runtime.value[id]

    if (activeByTarget.value[closing.target.key] === id) {
      const next =
        tabs.value[Math.min(index, tabs.value.length - 1)] || nextForTarget[0]
      activeByTarget.value = {
        ...activeByTarget.value,
        [closing.target.key]:
          next?.target.key === closing.target.key
            ? next.id
            : nextForTarget[0]?.id || ''
      }
    }
    persistence.flush()
  }

  function markCurrentSourceSaved(source = code.value) {
    const tab = activeTab.value
    if (!tab || tab.source !== source) return
    update(tab.id, { baselineSource: source, updatedAt: Date.now() })
    persistence.flush()
  }

  function clearRuntime() {
    setRuntime(activeId.value, { result: null, error: '' })
  }

  function update(id, changes) {
    if (!id) return
    tabs.value = tabs.value.map((tab) =>
      tab.id === id ? normalizeUpdate(tab, changes) : tab
    )
  }

  function setRuntime(id, changes) {
    if (!id) return
    runtime.value = {
      ...runtime.value,
      [id]: {
        result: null,
        error: '',
        ...(runtime.value[id] || {}),
        ...changes
      }
    }
  }

  function readState() {
    if (typeof window === 'undefined') {
      return { tabs: [], activeByTarget: {} }
    }
    try {
      return parseHelmScratchpadState(
        window.localStorage.getItem(LOCAL_STORAGE_KEYS.helmScratchpads)
      )
    } catch {
      return { tabs: [], activeByTarget: {} }
    }
  }

  return {
    tabs: visibleTabs,
    activeId,
    activeTab,
    currentTarget,
    currentTargetKey,
    code,
    view,
    result,
    error,
    canCreate,
    limit: HELM_SCRATCHPAD_LIMIT,
    activate,
    clearRuntime,
    close,
    create,
    duplicate,
    markCurrentSourceSaved,
    move,
    rename
  }
}

function normalizeUpdate(tab, changes) {
  const next = { ...tab, ...changes }
  next.name =
    typeof next.name === 'string' && next.name.trim()
      ? next.name.trim().slice(0, 64)
      : tab.name
  next.view = ['auto', 'raw', 'tree', 'table'].includes(next.view)
    ? next.view
    : tab.view
  return next
}
