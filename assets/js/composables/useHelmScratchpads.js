import { computed, ref, watch } from 'vue'
import { LOCAL_STORAGE_KEYS } from '@/lib/localStorageKeys'
import {
  HELM_SCRATCHPAD_DEFAULT_SOURCE,
  HELM_SCRATCHPAD_LIMIT,
  createHelmScratchpad,
  duplicateHelmScratchpadName,
  nextHelmScratchpadName,
  parseHelmScratchpadState,
  serializeHelmScratchpadState,
  snapshotHelmTarget
} from '@/lib/helmScratchpads.mjs'

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

  initialize()

  watch(
    [tabs, activeByTarget],
    () => {
      if (!ready.value || typeof window === 'undefined') return
      try {
        window.localStorage.setItem(
          LOCAL_STORAGE_KEYS.helmScratchpads,
          serializeHelmScratchpadState({
            tabs: tabs.value,
            activeByTarget: activeByTarget.value
          })
        )
      } catch (error) {
        console.warn('Could not save Helm scratchpads:', error)
      }
    },
    { deep: true }
  )

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
    if (targetTabs.length === 0) {
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
        [target.key]: targetTabs[0].id
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
    return tab
  }

  function rename(id, name) {
    update(id, { name, updatedAt: Date.now() })
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
    const nextIndex = index + offset
    if (index < 0 || nextIndex < 0 || nextIndex >= tabs.value.length) return
    const nextTabs = [...tabs.value]
    const [tab] = nextTabs.splice(index, 1)
    nextTabs.splice(nextIndex, 0, tab)
    tabs.value = nextTabs
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

    if (
      nextForTarget.length === 0 &&
      closing.target.key === currentTargetKey.value
    ) {
      create()
      return
    }

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
  }

  function markCurrentSourceSaved(source = code.value) {
    const tab = activeTab.value
    if (!tab || tab.source !== source) return
    update(tab.id, { baselineSource: source, updatedAt: Date.now() })
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
    tabs,
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
