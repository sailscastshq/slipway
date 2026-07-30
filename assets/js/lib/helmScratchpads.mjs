export const HELM_SCRATCHPAD_STORAGE_VERSION = 1
export const HELM_SCRATCHPAD_LIMIT = 20
export const HELM_SCRATCHPAD_DEFAULT_SOURCE =
  '// Access your Sails models, helpers, and config\n'

const RESULT_VIEWS = new Set(['auto', 'raw', 'tree', 'table'])

export function snapshotHelmTarget(target) {
  const project = cleanIdentity(target?.project)
  const environment = cleanIdentity(target?.environment)
  const app = cleanIdentity(target?.app)
  if (!project || !environment || !app) return null

  const key = [project.id, environment.id, app.id].join(':')
  return {
    key,
    project,
    environment: {
      ...environment,
      isProduction: Boolean(target.environment.isProduction)
    },
    app,
    href: `/projects/${encodeURIComponent(
      project.slug
    )}/environments/${encodeURIComponent(
      environment.slug
    )}/helm?appSlug=${encodeURIComponent(app.slug)}`
  }
}

export function createHelmScratchpad({
  id = createId(),
  name = 'Scratchpad',
  source = HELM_SCRATCHPAD_DEFAULT_SOURCE,
  baselineSource = source,
  view = 'auto',
  target,
  now = Date.now()
}) {
  const safeTarget = snapshotHelmTarget(target)
  if (!safeTarget) return null

  return {
    id: String(id),
    name: cleanName(name),
    source: String(source),
    baselineSource: String(baselineSource),
    view: RESULT_VIEWS.has(view) ? view : 'auto',
    target: safeTarget,
    createdAt: finiteTimestamp(now),
    updatedAt: finiteTimestamp(now)
  }
}

export function parseHelmScratchpadState(value) {
  let parsed
  try {
    parsed = typeof value === 'string' ? JSON.parse(value) : value
  } catch {
    return emptyState()
  }

  if (
    !parsed ||
    parsed.version !== HELM_SCRATCHPAD_STORAGE_VERSION ||
    !Array.isArray(parsed.tabs)
  ) {
    return emptyState()
  }

  const ids = new Set()
  const tabs = []
  for (const candidate of parsed.tabs.slice(0, HELM_SCRATCHPAD_LIMIT)) {
    const tab = normalizeStoredTab(candidate)
    if (!tab || ids.has(tab.id)) continue
    ids.add(tab.id)
    tabs.push(tab)
  }

  const activeByTarget = {}
  if (isPlainObject(parsed.activeByTarget)) {
    for (const [targetKey, tabId] of Object.entries(parsed.activeByTarget)) {
      if (
        typeof targetKey === 'string' &&
        typeof tabId === 'string' &&
        tabs.some((tab) => tab.id === tabId && tab.target.key === targetKey)
      ) {
        activeByTarget[targetKey] = tabId
      }
    }
  }

  return { tabs, activeByTarget }
}

export function serializeHelmScratchpadState({ tabs, activeByTarget }) {
  return JSON.stringify({
    version: HELM_SCRATCHPAD_STORAGE_VERSION,
    tabs: (tabs || []).slice(0, HELM_SCRATCHPAD_LIMIT).map((tab) => ({
      id: tab.id,
      name: tab.name,
      source: tab.source,
      baselineSource: tab.baselineSource,
      view: tab.view,
      target: tab.target,
      createdAt: tab.createdAt,
      updatedAt: tab.updatedAt
    })),
    activeByTarget: activeByTarget || {}
  })
}

export function helmScratchpadTargetLabel(target) {
  if (!target) return ''
  return `${target.app.name} · ${target.environment.name}`
}

export function helmScratchpadTargetTitle(target) {
  if (!target) return ''
  return `${target.project.name} / ${target.environment.name} / ${target.app.name}`
}

export function helmScratchpadIsModified(tab) {
  return Boolean(tab) && tab.source !== tab.baselineSource
}

export function nextHelmScratchpadName(tabs, targetKey) {
  const used = new Set(
    (tabs || [])
      .filter((tab) => tab.target.key === targetKey)
      .map((tab) => tab.name)
  )
  let number = 1
  while (used.has(`Scratchpad ${number}`)) number += 1
  return `Scratchpad ${number}`
}

export function duplicateHelmScratchpadName(tabs, tab) {
  const base = `Copy of ${tab.name}`.slice(0, 64)
  const used = new Set(
    (tabs || [])
      .filter((item) => item.target.key === tab.target.key)
      .map((item) => item.name)
  )
  if (!used.has(base)) return base

  let number = 2
  while (used.has(`${base} ${number}`.slice(0, 64))) number += 1
  return `${base} ${number}`.slice(0, 64)
}

function normalizeStoredTab(candidate) {
  if (
    !isPlainObject(candidate) ||
    typeof candidate.id !== 'string' ||
    !candidate.id ||
    typeof candidate.source !== 'string'
  ) {
    return null
  }

  const tab = createHelmScratchpad({
    id: candidate.id,
    name: candidate.name,
    source: candidate.source,
    baselineSource:
      typeof candidate.baselineSource === 'string'
        ? candidate.baselineSource
        : candidate.source,
    view: candidate.view,
    target: candidate.target,
    now: candidate.createdAt
  })
  if (!tab) return null

  return {
    ...tab,
    updatedAt: finiteTimestamp(candidate.updatedAt)
  }
}

function cleanIdentity(value) {
  if (!isPlainObject(value)) return null
  const id = cleanIdentifier(value.id)
  const slug = cleanIdentifier(value.slug)
  const name =
    typeof value.name === 'string' && value.name.trim()
      ? value.name.trim().slice(0, 120)
      : slug
  if (!id || !slug || !name) return null
  return { id, slug, name }
}

function cleanIdentifier(value) {
  if (!['string', 'number'].includes(typeof value)) return ''
  return String(value).trim().slice(0, 180)
}

function cleanName(value) {
  if (typeof value !== 'string' || !value.trim()) return 'Scratchpad'
  return value.trim().slice(0, 64)
}

function finiteTimestamp(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : Date.now()
}

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `scratchpad-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function emptyState() {
  return { tabs: [], activeByTarget: {} }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
