<script setup>
import { Head } from '@inertiajs/vue3'
import {
  ref,
  computed,
  inject,
  watch,
  nextTick,
  onMounted,
  onUnmounted,
  onBeforeUnmount
} from 'vue'
import { useEventSource } from '@/composables/sse'
import AppLayout from '@/layouts/AppLayout.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import ToastContainer from '@/components/ToastContainer.vue'
import Tooltip from '@/components/Tooltip.vue'
import CodeEditor from '@/components/CodeEditor.vue'
import { highlightSQL } from '@/lib/highlightSQL'
import { highlightJSON } from '@/lib/highlightJSON'
import { highlightJS } from '@/lib/highlightJS'
import { highlightLogLine } from '@/lib/highlightLog'
import SlippyLoader from '@/components/SlippyLoader.vue'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  stats: { type: Object, default: () => ({}) },
  databases: { type: Object, default: () => ({}) },
  processInfo: { type: Object, default: () => ({}) },
  version: { type: String, default: 'unknown' },
  instanceEnvVars: { type: Object, default: () => ({}) }
})

const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')

// ─── Tab management (matches Dock pattern: init from URL, sync via watcher) ───
const validTabs = ['overview', 'environment', 'console', 'migrate', 'activity']
const initialTab = new URLSearchParams(window.location.search).get('tab')
const activeTab = ref(validTabs.includes(initialTab) ? initialTab : 'overview')
const tabs = [
  { id: 'overview', name: 'Overview' },
  { id: 'environment', name: 'Environment' },
  { id: 'console', name: 'Console' },
  { id: 'migrate', name: 'Migrate' },
  { id: 'activity', name: 'Activity' }
]

// ─── Console state ───
const validModes = ['sql', 'helm']
const initialMode = new URLSearchParams(window.location.search).get('mode')
const consoleMode = ref(validModes.includes(initialMode) ? initialMode : 'sql')
const sqlQuery = ref(
  "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
)
const validDbs = ['app', 'observability', 'cache']
const initialDb = new URLSearchParams(window.location.search).get('db')
const selectedDatabase = ref(validDbs.includes(initialDb) ? initialDb : 'app')

// Sync tab + database to URL (same pattern as Dock: watcher + replaceState)
watch(activeTab, (tab) => {
  const url = new URL(window.location)
  if (tab === 'overview') url.searchParams.delete('tab')
  else url.searchParams.set('tab', tab)
  window.history.replaceState({}, '', url)
})

watch(selectedDatabase, (db) => {
  const url = new URL(window.location)
  if (db === 'app') url.searchParams.delete('db')
  else url.searchParams.set('db', db)
  window.history.replaceState({}, '', url)

  if (activeTab.value === 'migrate') {
    fetchDiff()
  }
})

watch(consoleMode, (mode) => {
  const url = new URL(window.location)
  if (mode === 'sql') url.searchParams.delete('mode')
  else url.searchParams.set('mode', mode)
  window.history.replaceState({}, '', url)
})

function onTabChange(tabId) {
  activeTab.value = tabId
  if (tabId === 'activity' && activities.value.length === 0) {
    fetchActivity()
  }
  if (tabId === 'migrate' && !diffLoading.value) {
    fetchDiff()
  }
}
const consoleResults = ref(null)
const consoleError = ref(null)
const consoleLoading = ref(false)
const queryHistory = ref([])
const resultView = ref('table')
const showExportMenu = ref(false)

// ─── Migrate state ───
const diff = ref(null)
const diffError = ref(null)
const diffLoading = ref(false)
const migrateLoading = ref(false)
const selectedModels = ref(new Set())
const showMigrateConfirm = ref(false)

// ─── Helm state ───
const helmCode = ref('// Access Slipway models and helpers\nawait User.find()')
const helmResults = ref(null)
const helmError = ref(null)
const helmLoading = ref(false)
const helmHistory = ref([])
const helmEditor = ref(null)
const helmSelection = ref({
  hasSelection: false,
  hasExecutableSelection: false
})
const helmRunLabel = computed(() =>
  helmSelection.value.hasSelection ? 'Run selection' : 'Run'
)
const canExecuteHelm = computed(() => {
  if (helmLoading.value) return false
  if (helmSelection.value.hasSelection) {
    return helmSelection.value.hasExecutableSelection
  }
  return Boolean(helmCode.value.trim())
})

// Toast state
const toasts = ref([])
let toastId = 0

function showToast(message, type = 'success') {
  const id = ++toastId
  toasts.value.push({ id, message, type })
  setTimeout(() => dismissToast(id), 5000)
}

function formatHelmError(error) {
  if (!error) return 'Evaluation failed'
  if (typeof error === 'string') return error

  const location =
    error.line && error.column ? ` (${error.line}:${error.column})` : ''
  return `${error.name || 'Error'}: ${
    error.message || 'Evaluation failed'
  }${location}`
}

function dismissToast(id) {
  toasts.value = toasts.value.filter((t) => t.id !== id)
}

// Format Helm output — try to parse as JSON for syntax highlighting, fall back to plain text
const highlightedHelmOutput = computed(() => {
  if (!helmResults.value?.output) return ''
  const raw = helmResults.value.output
  try {
    const parsed = JSON.parse(raw)
    // Only highlight objects/arrays — primitives display as plain text
    if (typeof parsed === 'object' && parsed !== null) {
      return highlightJSON(parsed)
    }
  } catch {
    // Not valid JSON — highlight as JS (handles util.inspect output too)
  }
  return highlightJS(raw)
})

async function executeQuery() {
  if (!sqlQuery.value.trim() || consoleLoading.value) return

  consoleLoading.value = true
  consoleError.value = null

  try {
    const response = await fetch('/api/v1/bosun/sql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: sqlQuery.value.trim(),
        database: selectedDatabase.value
      })
    })

    let data
    const text = await response.text()
    try {
      data = JSON.parse(text)
    } catch {
      if (!response.ok) {
        consoleError.value = text || 'Query failed'
        consoleResults.value = null
        return
      }
    }

    if (!response.ok) {
      consoleError.value =
        data?.message || data?.error || text || 'Query failed'
      consoleResults.value = null
      return
    }

    consoleResults.value = data

    // Add to history (deduplicate)
    const q = sqlQuery.value.trim()
    queryHistory.value = [
      q,
      ...queryHistory.value.filter((h) => h !== q)
    ].slice(0, 20)
  } catch (err) {
    consoleError.value = err.message || 'Network error'
  } finally {
    consoleLoading.value = false
  }
}

async function executeHelm() {
  const execution = helmEditor.value?.getExecutionSnapshot()
  if (!execution?.hasExecutableSource || !canExecuteHelm.value) return

  helmEditor.value.highlightExecution(execution)
  helmEditor.value.focus()
  helmLoading.value = true
  helmError.value = null
  helmResults.value = null

  try {
    const response = await fetch('/api/v1/bosun/eval', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: execution.source,
        sourceStartLine: execution.startLine,
        sourceStartColumn: execution.startColumn
      })
    })

    let data
    const text = await response.text()
    try {
      data = JSON.parse(text)
    } catch {
      if (!response.ok) {
        helmError.value = text || 'Evaluation failed'
        return
      }
    }

    if (!response.ok) {
      helmError.value =
        data?.message ||
        (data?.error ? formatHelmError(data.error) : null) ||
        text ||
        'Evaluation failed'
      return
    }

    helmResults.value = data
    if (!data.success) helmError.value = formatHelmError(data.error)

    // Add to history (deduplicate)
    const executedSource = execution.source
    helmHistory.value = [
      executedSource,
      ...helmHistory.value.filter((source) => source !== executedSource)
    ].slice(0, 20)
  } catch (err) {
    helmError.value = err.message || 'Network error'
  } finally {
    helmLoading.value = false
  }
}

function executeCurrentMode() {
  if (consoleMode.value === 'helm') {
    executeHelm()
  } else {
    executeQuery()
  }
}

function copyAsJSON() {
  if (!consoleResults.value?.rows) return
  navigator.clipboard.writeText(
    JSON.stringify(consoleResults.value.rows, null, 2)
  )
  showToast('Copied JSON to clipboard')
}

function copyAsCSV() {
  if (!consoleResults.value?.rows || !consoleResults.value?.columns) return
  const { columns, rows } = consoleResults.value
  const csvLines = [columns.join(',')]
  for (const row of rows) {
    const values = columns.map((col) => {
      const val = row[col]
      if (val === null) return ''
      const str = String(val)
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`
      }
      return str
    })
    csvLines.push(values.join(','))
  }
  navigator.clipboard.writeText(csvLines.join('\n'))
  showToast('Copied CSV to clipboard')
}

function downloadAsJSON() {
  if (!consoleResults.value?.rows) return
  downloadFile(
    JSON.stringify(consoleResults.value.rows, null, 2),
    'query-result.json',
    'application/json'
  )
  showToast('Downloaded query-result.json')
}

function downloadAsCSV() {
  if (!consoleResults.value?.rows || !consoleResults.value?.columns) return
  const { columns, rows } = consoleResults.value
  const csvLines = [columns.join(',')]
  for (const row of rows) {
    const values = columns.map((col) => {
      const val = row[col]
      if (val === null) return ''
      const str = String(val)
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`
      }
      return str
    })
    csvLines.push(values.join(','))
  }
  downloadFile(csvLines.join('\n'), 'query-result.csv', 'text/csv')
  showToast('Downloaded query-result.csv')
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function exportAction(fn) {
  fn()
  showExportMenu.value = false
}

function copyHelmOutput() {
  navigator.clipboard.writeText(
    helmResults.value?.output || formatHelmError(helmResults.value?.error) || ''
  )
  showToast('Copied to clipboard')
}

async function fetchDiff() {
  diffLoading.value = true
  diffError.value = null

  try {
    const params = new URLSearchParams({ database: selectedDatabase.value })
    const response = await fetch(`/api/v1/bosun/diff?${params}`)
    const data = await response.json()

    if (!response.ok) {
      diff.value = null
      selectedModels.value = new Set()
      diffError.value =
        data.error || data.message || 'Failed to load schema diff'
      return
    }

    diff.value = data

    const models = new Set()
    for (const statement of data.statements || []) {
      if (statement.table) {
        models.add(statement.table)
      }
    }
    selectedModels.value = models
  } catch (error) {
    diff.value = null
    selectedModels.value = new Set()
    diffError.value = error.message || 'Failed to load schema diff'
  } finally {
    diffLoading.value = false
  }
}

const diffModels = computed(() => {
  if (!diff.value?.statements) return []

  const models = new Set()
  for (const statement of diff.value.statements) {
    if (statement.table) {
      models.add(statement.table)
    }
  }

  return Array.from(models).sort()
})

const filteredStatements = computed(() => {
  if (!diff.value?.statements) return []
  if (diffModels.value.length === 0) return diff.value.statements

  return diff.value.statements.filter(
    (statement) => !statement.table || selectedModels.value.has(statement.table)
  )
})

const diffSummary = computed(() => {
  if (!diff.value?.diff) {
    return {
      tables: 0,
      columnsToRename: 0,
      columnsToAdd: 0,
      columnsToModify: 0,
      indexes: 0
    }
  }

  return {
    tables: diff.value.diff.tablesToCreate.length,
    columnsToRename: diff.value.diff.columnsToRename?.length || 0,
    columnsToAdd: diff.value.diff.columnsToAdd.length,
    columnsToModify: diff.value.diff.columnsToModify.length,
    indexes: diff.value.diff.indexesToCreate.length
  }
})

function toggleModel(model) {
  if (selectedModels.value.has(model)) {
    selectedModels.value.delete(model)
  } else {
    selectedModels.value.add(model)
  }

  selectedModels.value = new Set(selectedModels.value)
}

function selectAllModels() {
  selectedModels.value = new Set(diffModels.value)
}

function deselectAllModels() {
  selectedModels.value = new Set()
}

function confirmMigration() {
  if (!filteredStatements.value.length) return
  showMigrateConfirm.value = true
}

async function applyMigration() {
  showMigrateConfirm.value = false
  migrateLoading.value = true

  try {
    const response = await fetch('/api/v1/bosun/migrate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        database: selectedDatabase.value,
        statements: filteredStatements.value
      })
    })

    const data = await response.json()

    if (!response.ok || !data.success) {
      showToast(data.error || data.message || 'Migration failed', 'error')
      return
    }

    showToast(
      `Migration applied: ${data.executed} statement(s) executed`,
      'success'
    )
    await fetchDiff()
  } catch (error) {
    showToast(error.message || 'Migration failed', 'error')
  } finally {
    migrateLoading.value = false
  }
}

// ─── Environment variables state ───
const localVars = ref({ ...props.instanceEnvVars })
const envNewKey = ref('')
const envNewValue = ref('')
const envSaving = ref(false)
const revealedKeys = ref(new Set())

const sortedEnvKeys = computed(() => Object.keys(localVars.value).sort())

function toggleReveal(key) {
  if (revealedKeys.value.has(key)) {
    revealedKeys.value.delete(key)
  } else {
    revealedKeys.value.add(key)
  }
}

async function saveEnvVars(vars) {
  envSaving.value = true
  try {
    await fetch('/api/v1/bosun/env', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ envVars: vars })
    })
    // localVars is already updated by the caller — no need for router.reload()
    // which can trigger version-mismatch full page reloads in dev
  } finally {
    envSaving.value = false
  }
}

function addEnvVar() {
  if (!envNewKey.value.trim()) return
  localVars.value[envNewKey.value.trim()] = envNewValue.value
  saveEnvVars(localVars.value)
  envNewKey.value = ''
  envNewValue.value = ''
}

function removeEnvVar(key) {
  delete localVars.value[key]
  localVars.value = { ...localVars.value }
  saveEnvVars(localVars.value)
}

// ─── Activity state ───
const activities = ref([])
const activityLoading = ref(false)
const activityFilter = ref('all')
const activityPage = ref(1)

async function fetchActivity() {
  activityLoading.value = true
  try {
    const params = new URLSearchParams({
      page: activityPage.value,
      limit: 30,
      type: activityFilter.value
    })
    const response = await fetch(`/api/v1/bosun/activity?${params}`)
    const data = await response.json()
    activities.value = data.activities || []
  } catch (err) {
    console.error('Failed to fetch activity:', err)
  } finally {
    activityLoading.value = false
  }
}

function changeActivityFilter(filter) {
  activityFilter.value = filter
  activityPage.value = 1
  fetchActivity()
}

// ─── Instance logs state ───
const _params = new URLSearchParams(window.location.search)
const logsOpen = ref(_params.has('logs'))
const logLines = ref([])
const logContainer = ref(null)
const autoScroll = ref(true)

const {
  connected: logsConnected,
  error: logsError,
  close: disconnectLogs,
  connect: connectLogs
} = useEventSource('/api/v1/bosun/logs/stream?tail=200', {
  immediate: false,
  onMessage(data) {
    if (data.log) {
      logLines.value.push(data.log)
      if (logLines.value.length > 2000) {
        logLines.value = logLines.value.slice(-1500)
      }
      if (autoScroll.value) {
        nextTick(() => {
          if (logContainer.value) {
            logContainer.value.scrollTop = logContainer.value.scrollHeight
          }
        })
      }
    }
  }
})

watch(logsOpen, (open) => {
  const url = new URL(window.location)
  if (open) {
    url.searchParams.set('logs', '1')
  } else {
    url.searchParams.delete('logs')
  }
  window.history.replaceState({}, '', url)

  if (open) {
    connectLogs()
  } else {
    disconnectLogs()
  }
})

// ─── Computed ───
const heapPercent = computed(() => {
  if (!props.processInfo.memoryUsage) return 0
  return Math.round(
    (props.processInfo.memoryUsage.heapUsed /
      props.processInfo.memoryUsage.heapTotal) *
      100
  )
})

const statCards = computed(() => [
  { label: 'Projects', value: props.stats.projects || 0 },
  { label: 'Apps', value: props.stats.apps || 0 },
  { label: 'Deployments', value: props.stats.deployments || 0 },
  { label: 'Backups', value: props.stats.backups || 0 }
])

// ─── Formatters ───
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i]
}

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h ${mins}m`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

function timeAgo(timestamp) {
  if (!timestamp) return ''
  const now = Date.now()
  const date = new Date(timestamp)
  const diff = now - date.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function statusColor(status) {
  const colors = {
    running:
      'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    completed:
      'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    failed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    cancelled: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
    pending:
      'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    building:
      'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    deploying:
      'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    stopped: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
  }
  return (
    colors[status] ||
    'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
  )
}

function activityTypeIcon(type) {
  return { deployment: 'DP', backup: 'BK', audit: 'AU' }[type] || '??'
}

function activityTypeColor(type) {
  return (
    {
      deployment:
        'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
      backup:
        'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
      audit: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
    }[type] || 'bg-gray-100 text-gray-600'
  )
}

// Close menus on click outside
function handleClickOutside(e) {
  if (showExportMenu.value && !e.target.closest('[data-export-menu]')) {
    showExportMenu.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
  if (activeTab.value === 'activity') {
    fetchActivity()
  }
  if (logsOpen.value) {
    connectLogs()
  }
})

onBeforeUnmount(() => {
  disconnectLogs()
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>

<template>
  <Head title="Bosun | Slipway"></Head>
  <div class="flex h-full flex-col">
    <!-- Header -->
    <div
      class="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800 sm:px-6"
    >
      <div class="flex items-center space-x-3">
        <button
          @click="toggleMobileMenu"
          class="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white md:hidden"
        >
          <svg
            class="h-5 w-5"
            viewBox="-0.5 -0.5 16 16"
            fill="none"
            stroke="currentColor"
          >
            <path
              d="M12.777 14.285H2.223c-.833 0-1.508-.675-1.508-1.508V2.223c0-.833.675-1.508 1.508-1.508h10.554c.833 0 1.508.675 1.508 1.508v10.554c0 .833-.675 1.508-1.508 1.508Z"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1"
            />
            <path
              d="M5.615 14.285V.715"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1"
            />
            <path
              d="M2.6 5.992 3.919 7.5 2.6 9.008"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1"
            />
          </svg>
        </button>
        <button
          @click="toggleSidebar"
          class="hidden text-gray-400 dark:text-gray-500 md:block"
        >
          <svg
            v-if="sidebarCollapsed"
            class="h-5 w-5"
            viewBox="-0.5 -0.5 16 16"
            fill="none"
            stroke="currentColor"
          >
            <path
              d="M12.777 14.285H2.223c-.833 0-1.508-.675-1.508-1.508V2.223c0-.833.675-1.508 1.508-1.508h10.554c.833 0 1.508.675 1.508 1.508v10.554c0 .833-.675 1.508-1.508 1.508Z"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1"
            />
            <path
              d="M5.615 14.285V.715"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1"
            />
            <path
              d="M2.6 5.992 3.919 7.5 2.6 9.008"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1"
            />
          </svg>
          <svg
            v-else
            class="h-5 w-5"
            viewBox="-0.5 -0.5 16 16"
            fill="none"
            stroke="currentColor"
          >
            <path
              d="M12.777 14.285H2.223c-.833 0-1.508-.675-1.508-1.508V2.223c0-.833.675-1.508 1.508-1.508h10.554c.833 0 1.508.675 1.508 1.508v10.554c0 .833-.675 1.508-1.508 1.508Z"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1"
            />
            <path
              d="M5.615 14.285V.715"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1"
            />
            <path
              d="M3.919 5.992 2.6 7.5l1.319 1.508"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1"
            />
          </svg>
        </button>
        <span class="font-medium text-gray-900 dark:text-white">Bosun</span>
      </div>
      <div class="flex items-center space-x-2 sm:space-x-3">
        <Tooltip text="Slipway version" position="bottom">
          <span
            class="rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400"
            >v{{ version }}</span
          >
        </Tooltip>
        <a
          href="https://docs.sailscasts.com/slipway/bosun"
          target="_blank"
          class="flex items-center space-x-1 text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
        >
          <span>Docs</span>
          <svg
            class="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
            />
          </svg>
        </a>
      </div>
    </div>

    <!-- Tab bar (Dock-style pills with frosted glass) -->
    <div
      class="flex items-center space-x-1 border-b border-gray-200/50 bg-white/80 px-4 py-2 backdrop-blur-md dark:border-gray-800/50 dark:bg-gray-950/80 sm:px-6"
    >
      <button
        v-for="tab in tabs"
        :key="tab.id"
        @click="onTabChange(tab.id)"
        :class="[
          'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
          activeTab === tab.id
            ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
            : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-300'
        ]"
      >
        {{ tab.name }}
      </button>
    </div>

    <!-- ═══ Console Tab (full-height layout matching Dock) ═══ -->
    <div
      v-if="activeTab === 'console'"
      class="flex flex-1 flex-col overflow-hidden"
    >
      <!-- Editor -->
      <div
        class="flex-1 overflow-hidden border-b border-gray-200 dark:border-gray-800"
      >
        <!-- SQL editor -->
        <CodeEditor
          v-if="consoleMode === 'sql'"
          v-model="sqlQuery"
          language="sql"
          aria-label="Bosun SQL query"
          test-id="bosun-sql-editor"
          height="fill"
          submit-on-mod-enter
          placeholder="SELECT * FROM ..."
          @submit="executeQuery"
        />
        <!-- Helm editor -->
        <CodeEditor
          v-else
          ref="helmEditor"
          v-model="helmCode"
          language="javascript"
          aria-label="Bosun Helm code"
          test-id="bosun-helm-editor"
          height="fill"
          submit-on-mod-enter
          placeholder="// Access Slipway models and helpers&#10;await User.find()"
          @selection-change="helmSelection = $event"
          @submit="executeHelm"
        />
      </div>

      <!-- Actions bar -->
      <div
        class="flex items-center justify-between border-b border-gray-200 px-4 py-2 dark:border-gray-800 sm:px-6"
      >
        <div class="flex items-center gap-4">
          <!-- Mode toggle pills -->
          <div
            class="flex items-center gap-1 rounded-md border border-gray-200 p-0.5 dark:border-gray-700"
          >
            <button
              @click="consoleMode = 'sql'"
              :class="[
                'rounded px-2 py-0.5 text-xs font-medium transition-colors',
                consoleMode === 'sql'
                  ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                  : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
              ]"
            >
              SQL
            </button>
            <button
              @click="consoleMode = 'helm'"
              :class="[
                'rounded px-2 py-0.5 text-xs font-medium transition-colors',
                consoleMode === 'helm'
                  ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                  : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
              ]"
            >
              Helm
            </button>
          </div>
          <!-- Database selector pills (SQL mode only) -->
          <div v-if="consoleMode === 'sql'" class="flex items-center gap-1">
            <button
              v-for="db in ['app', 'observability', 'cache']"
              :key="db"
              @click="selectedDatabase = db"
              :class="[
                'rounded px-2 py-0.5 text-xs font-medium transition-colors',
                selectedDatabase === db
                  ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                  : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
              ]"
            >
              {{ db }}
            </button>
          </div>
          <div
            class="hidden items-center space-x-2 text-xs text-gray-500 dark:text-gray-400 sm:flex"
          >
            <kbd
              class="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-gray-600 dark:bg-gray-800 dark:text-gray-400"
              >&#8984;</kbd
            >
            <kbd
              class="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-gray-600 dark:bg-gray-800 dark:text-gray-400"
              >Enter</kbd
            >
            <span>to run</span>
          </div>
        </div>
        <button
          data-test="bosun-console-run"
          @click="executeCurrentMode"
          :disabled="
            consoleMode === 'sql'
              ? consoleLoading || !sqlQuery.trim()
              : !canExecuteHelm
          "
          :title="
            consoleMode === 'helm'
              ? `${helmRunLabel} · ${
                  navigator?.platform?.includes('Mac') ? '⌘' : 'Ctrl'
                }+Enter`
              : 'Run · ⌘+Enter'
          "
          class="rounded-md bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
        >
          <span v-if="consoleLoading || helmLoading">Running...</span>
          <span v-else>{{
            consoleMode === 'helm' ? helmRunLabel : 'Run'
          }}</span>
        </button>
      </div>

      <!-- Results -->
      <div class="flex-1 overflow-auto">
        <!-- ─── SQL Results ─── -->
        <template v-if="consoleMode === 'sql'">
          <!-- Error -->
          <div v-if="consoleError" class="p-4">
            <div
              class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-900/50 dark:bg-red-950/30"
            >
              <p class="font-mono text-sm text-red-600 dark:text-red-400">
                {{ consoleError }}
              </p>
            </div>
          </div>

          <!-- Results table/json -->
          <div v-else-if="consoleResults" class="flex h-full min-h-0 flex-col">
            <!-- Table view -->
            <div
              v-if="consoleResults.columns && resultView === 'table'"
              class="flex-1 overflow-auto"
            >
              <table class="min-w-full">
                <thead class="sticky top-0">
                  <tr
                    class="border-b border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900"
                  >
                    <th
                      v-for="col in consoleResults.columns"
                      :key="col"
                      class="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400"
                    >
                      {{ col }}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="(row, i) in consoleResults.rows"
                    :key="i"
                    class="border-b border-gray-100 hover:bg-gray-50 dark:border-gray-800/50 dark:hover:bg-gray-900/30"
                  >
                    <td
                      v-for="col in consoleResults.columns"
                      :key="col"
                      class="whitespace-nowrap px-4 py-2 font-mono text-sm text-gray-700 dark:text-gray-300"
                    >
                      <span
                        v-if="row[col] === null"
                        class="text-gray-400 dark:text-gray-600"
                        >NULL</span
                      >
                      <span
                        v-else-if="typeof row[col] === 'number'"
                        class="text-purple-600 dark:text-purple-400"
                        >{{ row[col] }}</span
                      >
                      <span
                        v-else-if="typeof row[col] === 'boolean'"
                        class="text-blue-600 dark:text-blue-400"
                        >{{ row[col] }}</span
                      >
                      <span v-else>{{ row[col] }}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- JSON view -->
            <div
              v-else-if="consoleResults.columns && resultView === 'json'"
              class="flex-1 overflow-auto p-4"
            >
              <pre
                class="font-mono text-xs text-gray-700 dark:text-gray-300"
                v-html="highlightJSON(consoleResults.rows)"
              ></pre>
            </div>

            <!-- No columns result -->
            <div
              v-else
              class="flex flex-1 items-center justify-center text-sm text-gray-500 dark:text-gray-400"
            >
              Query executed successfully
            </div>
          </div>

          <!-- Empty state -->
          <div
            v-else
            class="flex h-full items-center justify-center text-sm text-gray-500 dark:text-gray-400"
          >
            Run a query to see results
          </div>
        </template>

        <!-- ─── Helm Results ─── -->
        <template v-else>
          <!-- Loading -->
          <div
            v-if="helmLoading"
            class="flex h-full items-center justify-center"
          >
            <SlippyLoader size="h-5 w-5" />
          </div>

          <!-- Error -->
          <div v-else-if="helmError" class="p-4">
            <div
              class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-900/50 dark:bg-red-950/30"
            >
              <pre
                class="whitespace-pre-wrap font-mono text-sm text-red-600 dark:text-red-400"
                >{{ helmError }}</pre
              >
            </div>
            <pre
              v-if="helmResults?.output"
              class="mt-3 whitespace-pre-wrap font-mono text-sm text-gray-700 dark:text-gray-300"
              >{{ helmResults.output }}</pre
            >
          </div>

          <!-- Results output -->
          <div v-else-if="helmResults" class="p-4">
            <pre
              class="whitespace-pre-wrap font-mono text-sm text-gray-700 dark:text-gray-300"
              v-html="highlightedHelmOutput"
            ></pre>
          </div>

          <!-- Empty state -->
          <div
            v-else
            class="flex h-full items-center justify-center text-sm text-gray-500 dark:text-gray-400"
          >
            Run JavaScript to see results
          </div>
        </template>
      </div>

      <!-- Status bar -->
      <div
        v-if="
          (consoleMode === 'sql' && consoleResults) ||
          (consoleMode === 'helm' && helmResults)
        "
        class="flex items-center justify-between border-t border-gray-200 bg-gray-50 px-4 py-2 dark:border-gray-800 dark:bg-gray-900/50"
      >
        <!-- SQL status bar content -->
        <template v-if="consoleMode === 'sql'">
          <div class="flex items-center gap-4">
            <!-- Table / JSON toggle -->
            <div
              v-if="consoleResults?.columns"
              class="flex overflow-hidden rounded-md border border-gray-300 dark:border-gray-700"
            >
              <Tooltip text="Table view" position="top">
                <button
                  @click="resultView = 'table'"
                  :class="[
                    'p-1.5',
                    resultView === 'table'
                      ? 'bg-gray-200 text-gray-900 dark:bg-gray-700 dark:text-white'
                      : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
                  ]"
                >
                  <svg
                    class="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    stroke-width="1.5"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h7.5c.621 0 1.125-.504 1.125-1.125m-9.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-7.5A1.125 1.125 0 0112 18.375m9.75-12.75c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125m19.5 0v1.5c0 .621-.504 1.125-1.125 1.125M2.25 5.625v1.5c0 .621.504 1.125 1.125 1.125m0 0h17.25m-17.25 0h7.5c.621 0 1.125.504 1.125 1.125M3.375 8.25c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m17.25-3.75h-7.5c-.621 0-1.125.504-1.125 1.125m8.625-1.125c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h7.5m-7.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125M12 10.875v-1.5m0 1.5c0 .621-.504 1.125-1.125 1.125M12 10.875c0 .621.504 1.125 1.125 1.125m-2.25 0c.621 0 1.125.504 1.125 1.125M13.125 12h7.5m-7.5 0c-.621 0-1.125.504-1.125 1.125M20.625 12c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h7.5M12 14.625v-1.5m0 1.5c0 .621-.504 1.125-1.125 1.125M12 14.625c0 .621.504 1.125 1.125 1.125m-2.25 0c.621 0 1.125.504 1.125 1.125m0 0v1.5c0 .621-.504 1.125-1.125 1.125"
                    />
                  </svg>
                </button>
              </Tooltip>
              <Tooltip text="JSON view" position="top">
                <button
                  @click="resultView = 'json'"
                  :class="[
                    'border-l border-gray-300 px-1.5 py-1 font-mono text-sm font-bold dark:border-gray-700',
                    resultView === 'json'
                      ? 'bg-gray-200 text-gray-900 dark:bg-gray-700 dark:text-white'
                      : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
                  ]"
                >
                  {}
                </button>
              </Tooltip>
            </div>
            <!-- Row info -->
            <span
              v-if="consoleResults"
              class="text-xs text-gray-500 dark:text-gray-400"
            >
              {{ consoleResults.rowCount }} row{{
                consoleResults.rowCount !== 1 ? 's' : ''
              }}
              <span v-if="consoleResults.truncated">
                (showing first 1,000)</span
              >
              &middot; {{ consoleResults.durationMs }}ms
            </span>
          </div>
          <!-- Actions -->
          <div v-if="consoleResults?.columns" class="flex items-center gap-1">
            <Tooltip text="Re-run query" position="top">
              <button
                @click="executeQuery"
                class="rounded p-1.5 text-gray-500 hover:bg-gray-200 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
              >
                <svg
                  class="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  stroke-width="1.5"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
                  />
                </svg>
              </button>
            </Tooltip>
            <Tooltip
              :text="resultView === 'json' ? 'Copy as JSON' : 'Copy as CSV'"
              position="top"
            >
              <button
                @click="resultView === 'json' ? copyAsJSON() : copyAsCSV()"
                class="rounded p-1.5 text-gray-500 hover:bg-gray-200 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
              >
                <svg
                  class="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  stroke-width="1.5"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184"
                  />
                </svg>
              </button>
            </Tooltip>
            <!-- Export dropdown -->
            <div class="relative" data-export-menu>
              <Tooltip text="Download" position="top">
                <button
                  @click="showExportMenu = !showExportMenu"
                  class="rounded p-1.5 text-gray-500 hover:bg-gray-200 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                >
                  <svg
                    class="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    stroke-width="1.5"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
                    />
                  </svg>
                </button>
              </Tooltip>
              <div
                v-if="showExportMenu"
                class="absolute bottom-full right-0 z-10 mb-1 w-40 rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800"
              >
                <button
                  @click="exportAction(copyAsJSON)"
                  class="block w-full px-3 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  Copy as JSON
                </button>
                <button
                  @click="exportAction(copyAsCSV)"
                  class="block w-full px-3 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  Copy as CSV
                </button>
                <div
                  class="my-1 border-t border-gray-200 dark:border-gray-700"
                ></div>
                <button
                  @click="exportAction(downloadAsJSON)"
                  class="block w-full px-3 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  Download JSON
                </button>
                <button
                  @click="exportAction(downloadAsCSV)"
                  class="block w-full px-3 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  Download CSV
                </button>
              </div>
            </div>
          </div>
        </template>

        <!-- Helm status bar content -->
        <template v-else>
          <span
            v-if="helmResults"
            class="text-xs text-gray-500 dark:text-gray-400"
          >
            {{ helmResults.success ? 'Success' : 'Error' }}
            &middot; {{ helmResults.durationMs }}ms
          </span>
          <Tooltip v-if="helmResults" text="Copy output" position="top">
            <button
              @click="copyHelmOutput"
              class="rounded p-1.5 text-gray-500 hover:bg-gray-200 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
            >
              <svg
                class="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="1.5"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184"
                />
              </svg>
            </button>
          </Tooltip>
        </template>
      </div>
    </div>

    <!-- ═══ Scrollable tabs (Overview, Environment, Activity) ═══ -->
    <div
      v-if="activeTab !== 'console'"
      class="flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8"
    >
      <div class="mx-auto max-w-6xl">
        <!-- ═══ Overview Tab ═══ -->
        <div v-if="activeTab === 'overview'">
          <!-- Status line -->
          <div
            class="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-gray-50/50 px-4 py-3 dark:border-gray-800 dark:bg-gray-900/50"
          >
            <span class="flex items-center gap-1.5 text-xs">
              <span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
              <span class="font-medium text-gray-900 dark:text-white"
                >Running</span
              >
            </span>
            <span class="text-gray-300 dark:text-gray-700">&middot;</span>
            <span class="text-xs text-gray-500 dark:text-gray-400">
              <span class="font-medium text-gray-900 dark:text-white">{{
                formatUptime(processInfo.uptime)
              }}</span>
              uptime
            </span>
            <span class="text-gray-300 dark:text-gray-700">&middot;</span>
            <span class="text-xs text-gray-500 dark:text-gray-400">
              Node
              <span class="font-medium text-gray-900 dark:text-white">{{
                processInfo.nodeVersion
              }}</span>
            </span>
            <span class="text-gray-300 dark:text-gray-700">&middot;</span>
            <span class="text-xs text-gray-500 dark:text-gray-400">
              PID
              <span
                class="font-mono font-medium text-gray-900 dark:text-white"
                >{{ processInfo.pid }}</span
              >
            </span>
            <span class="hidden text-gray-300 dark:text-gray-700 sm:inline"
              >&middot;</span
            >
            <span
              class="hidden text-xs text-gray-500 dark:text-gray-400 sm:inline"
            >
              {{ processInfo.platform }}
            </span>
          </div>

          <!-- Stat cards -->
          <div class="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div
              v-for="stat in statCards"
              :key="stat.label"
              class="rounded-lg border border-gray-200 px-4 py-3 dark:border-gray-800"
            >
              <div
                class="text-2xl font-semibold tabular-nums text-gray-900 dark:text-white"
              >
                {{ stat.value.toLocaleString() }}
              </div>
              <div class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                {{ stat.label }}
              </div>
            </div>
          </div>

          <!-- Memory + Databases -->
          <div class="mb-8 grid gap-6 lg:grid-cols-2">
            <!-- Memory -->
            <div class="rounded-lg border border-gray-200 dark:border-gray-800">
              <div
                class="border-b border-gray-200 px-4 py-3 dark:border-gray-800"
              >
                <h3 class="text-sm font-medium text-gray-900 dark:text-white">
                  Memory
                </h3>
              </div>
              <div class="space-y-4 px-4 py-4">
                <!-- Heap usage with bar -->
                <div>
                  <div class="flex items-center justify-between text-xs">
                    <span class="text-gray-500 dark:text-gray-400"
                      >Heap Used</span
                    >
                    <span
                      class="font-mono font-medium text-gray-900 dark:text-white"
                    >
                      {{ formatBytes(processInfo.memoryUsage?.heapUsed) }}
                      <span class="text-gray-400 dark:text-gray-600"
                        >/
                        {{
                          formatBytes(processInfo.memoryUsage?.heapTotal)
                        }}</span
                      >
                    </span>
                  </div>
                  <div
                    class="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800"
                  >
                    <div
                      class="h-full rounded-full bg-blue-500 transition-all"
                      :style="{ width: heapPercent + '%' }"
                    ></div>
                  </div>
                  <div
                    class="mt-1 flex justify-between text-[10px] text-gray-400 dark:text-gray-500"
                  >
                    <span>{{ heapPercent }}% used</span>
                    <span
                      >{{
                        formatBytes(
                          processInfo.memoryUsage?.heapTotal -
                            processInfo.memoryUsage?.heapUsed
                        )
                      }}
                      free</span
                    >
                  </div>
                </div>
                <!-- RSS -->
                <div class="flex items-center justify-between">
                  <span class="text-xs text-gray-500 dark:text-gray-400"
                    >RSS (Total)</span
                  >
                  <span
                    class="font-mono text-sm font-medium text-gray-900 dark:text-white"
                    >{{ formatBytes(processInfo.memoryUsage?.rss) }}</span
                  >
                </div>
              </div>
            </div>

            <!-- Databases -->
            <div class="rounded-lg border border-gray-200 dark:border-gray-800">
              <div
                class="border-b border-gray-200 px-4 py-3 dark:border-gray-800"
              >
                <h3 class="text-sm font-medium text-gray-900 dark:text-white">
                  Databases
                </h3>
              </div>
              <div class="space-y-1 px-4 pb-3">
                <div
                  v-for="(db, name) in databases"
                  :key="name"
                  class="flex items-center justify-between py-1.5"
                >
                  <div class="flex items-center gap-2">
                    <span
                      class="text-sm font-medium text-gray-900 dark:text-white"
                      >{{ name }}</span
                    >
                    <span class="text-xs text-gray-400 dark:text-gray-500">{{
                      db.path.split('/').pop()
                    }}</span>
                  </div>
                  <span
                    class="font-mono text-sm font-medium text-gray-900 dark:text-white"
                    >{{ formatBytes(db.sizeBytes) }}</span
                  >
                </div>
              </div>
            </div>
          </div>

          <!-- Logs Accordion -->
          <div class="rounded-lg border border-gray-200 dark:border-gray-800">
            <div class="flex items-center justify-between px-4 py-3">
              <button
                @click="logsOpen = !logsOpen"
                class="flex flex-1 items-center space-x-3 text-left hover:opacity-80"
              >
                <h2 class="text-sm font-medium text-gray-900 dark:text-white">
                  Logs
                </h2>
                <span
                  v-if="logsConnected"
                  class="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                >
                  <span
                    class="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500"
                  ></span>
                  Live
                </span>
              </button>
              <div class="flex items-center gap-2">
                <label
                  v-if="logsOpen"
                  class="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500"
                >
                  <input
                    v-model="autoScroll"
                    type="checkbox"
                    class="text-brand focus:ring-brand h-3.5 w-3.5 rounded border-gray-300 dark:border-gray-600 dark:bg-gray-800"
                  />
                  Auto-scroll
                </label>
                <button
                  @click="logsOpen = !logsOpen"
                  class="rounded p-0.5 hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  <svg
                    :class="[
                      'h-4 w-4 text-gray-400 transition-transform duration-200',
                      logsOpen ? 'rotate-90' : ''
                    ]"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </button>
              </div>
            </div>

            <div v-show="logsOpen">
              <div
                v-if="logsError"
                class="border-t border-gray-200 px-4 py-6 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400"
              >
                {{ logsError }}
              </div>

              <div v-else class="border-t border-gray-200 dark:border-gray-800">
                <div
                  ref="logContainer"
                  class="h-80 overflow-y-auto bg-gray-100 p-4 font-mono text-xs leading-5 text-gray-700 dark:bg-gray-950 dark:text-gray-300"
                  @scroll="
                    autoScroll =
                      logContainer &&
                      logContainer.scrollHeight -
                        logContainer.scrollTop -
                        logContainer.clientHeight <
                        40
                  "
                >
                  <div
                    v-if="!logsConnected && logLines.length === 0"
                    class="flex h-full items-center justify-center text-gray-500"
                  >
                    <SlippyLoader size="h-4 w-4" class="mr-2" />
                    Connecting to logs...
                  </div>
                  <div
                    v-else-if="logLines.length === 0 && logsConnected"
                    class="text-gray-500"
                  >
                    Waiting for output...
                  </div>
                  <template v-else>
                    <div
                      v-for="(line, i) in logLines"
                      :key="i"
                      class="whitespace-pre-wrap break-all hover:bg-gray-200/50 dark:hover:bg-gray-900/50"
                      v-html="highlightLogLine(line)"
                    ></div>
                  </template>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- ═══ Environment Tab ═══ -->
        <div v-if="activeTab === 'environment'">
          <div class="mb-6">
            <h1 class="text-xl font-semibold text-gray-900 dark:text-white">
              Instance Environment
            </h1>
            <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Configuration variables for this Slipway instance.
            </p>
          </div>

          <!-- Variables list -->
          <div class="rounded-lg border border-gray-200 dark:border-gray-800">
            <div class="flex items-center justify-between px-4 py-3">
              <h2 class="text-sm font-medium text-gray-900 dark:text-white">
                Environment variables
              </h2>
              <span
                class="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400"
              >
                {{ sortedEnvKeys.length }}
              </span>
            </div>

            <!-- Variable rows -->
            <div v-if="sortedEnvKeys.length > 0" class="space-y-1 px-4 pb-2">
              <div v-for="key in sortedEnvKeys" :key="key" class="group py-2">
                <div class="flex items-center justify-between">
                  <span
                    class="font-mono text-sm font-medium text-gray-900 dark:text-white"
                    >{{ key }}</span
                  >
                  <div
                    class="flex items-center space-x-1 opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <button
                      @click="toggleReveal(key)"
                      class="rounded p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    >
                      <svg
                        v-if="revealedKeys.has(key)"
                        class="h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L6.5 6.5m7.378 7.378L17.5 17.5M3 3l18 18"
                        />
                      </svg>
                      <svg
                        v-else
                        class="h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                        />
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                        />
                      </svg>
                    </button>
                    <button
                      @click="removeEnvVar(key)"
                      class="rounded p-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400"
                    >
                      <svg
                        class="h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
                <p
                  class="mt-1 truncate font-mono text-sm text-gray-500 dark:text-gray-400"
                >
                  {{
                    revealedKeys.has(key)
                      ? localVars[key]
                      : '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022'
                  }}
                </p>
              </div>
            </div>

            <div
              v-else
              class="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400"
            >
              No instance environment variables configured.
            </div>

            <!-- Add new variable -->
            <div class="px-4 pb-3">
              <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  v-model="envNewKey"
                  type="text"
                  placeholder="KEY"
                  class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 font-mono text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500 sm:flex-1"
                  @keydown.enter="addEnvVar"
                />
                <input
                  v-model="envNewValue"
                  type="text"
                  placeholder="value"
                  class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 font-mono text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500 sm:flex-1"
                  @keydown.enter="addEnvVar"
                />
                <button
                  @click="addEnvVar"
                  :disabled="!envNewKey.trim() || envSaving"
                  class="w-full rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100 sm:w-auto"
                >
                  Add
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- ═══ Migrate Tab ═══ -->
        <div v-if="activeTab === 'migrate'">
          <div
            class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"
          >
            <div>
              <h1 class="text-xl font-semibold text-gray-900 dark:text-white">
                Migrate
              </h1>
              <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Review pending SQLite schema changes for Bosun and apply them
                when you are ready.
              </p>
            </div>

            <div
              class="flex items-center space-x-1 rounded-md border border-gray-200 p-0.5 dark:border-gray-800"
            >
              <button
                v-for="db in ['app', 'observability', 'cache']"
                :key="db"
                @click="selectedDatabase = db"
                :class="[
                  'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                  selectedDatabase === db
                    ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                    : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                ]"
              >
                {{ db }}
              </button>
            </div>
          </div>

          <div v-if="diffLoading" class="py-16 text-center">
            <SlippyLoader class="mx-auto text-gray-400 dark:text-gray-600" />
          </div>

          <div
            v-else-if="diffError"
            class="rounded-lg border border-red-200 bg-red-50 px-5 py-4 dark:border-red-900/50 dark:bg-red-950/30"
          >
            <p class="text-sm font-medium text-red-700 dark:text-red-300">
              Migrate diff failed
            </p>
            <p class="mt-1 text-sm text-red-600 dark:text-red-400">
              {{ diffError }}
            </p>
          </div>

          <div
            v-else-if="diff?.modelCount === 0"
            class="rounded-lg border border-gray-200 bg-gray-50 px-6 py-8 text-center dark:border-gray-800 dark:bg-gray-900/50"
          >
            <h3 class="text-sm font-medium text-gray-900 dark:text-white">
              Nothing to compare for {{ selectedDatabase }}
            </h3>
            <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {{ diff?.message || 'No Waterline models use this datastore.' }}
            </p>
          </div>

          <div
            v-else-if="!diff?.hasPendingChanges"
            class="rounded-lg border border-green-200 bg-green-50 px-6 py-8 text-center dark:border-green-900/50 dark:bg-green-950/30"
          >
            <h3 class="text-sm font-medium text-green-800 dark:text-green-300">
              No pending schema changes
            </h3>
            <p class="mt-1 text-sm text-green-700 dark:text-green-400">
              Bosun’s {{ selectedDatabase }} datastore matches the current
              Waterline models.
            </p>
          </div>

          <div v-else class="space-y-6">
            <div class="rounded-lg border border-gray-200 dark:border-gray-800">
              <div
                class="flex flex-col gap-4 border-b border-gray-200 px-4 py-4 dark:border-gray-800 sm:flex-row sm:items-start sm:justify-between"
              >
                <div>
                  <h2 class="text-sm font-medium text-gray-900 dark:text-white">
                    Pending schema changes
                  </h2>
                  <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    {{ filteredStatements.length }} statement{{
                      filteredStatements.length !== 1 ? 's' : ''
                    }}
                    ready for the {{ selectedDatabase }} SQLite database.
                  </p>
                </div>

                <button
                  @click="confirmMigration"
                  :disabled="migrateLoading || filteredStatements.length === 0"
                  class="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
                >
                  {{ migrateLoading ? 'Applying...' : 'Apply migration' }}
                </button>
              </div>

              <div class="grid gap-4 px-4 py-4 sm:grid-cols-4">
                <div
                  class="rounded-md bg-gray-50 px-3 py-3 dark:bg-gray-900/60"
                >
                  <div
                    class="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400"
                  >
                    Tables
                  </div>
                  <div
                    class="mt-1 text-lg font-semibold text-gray-900 dark:text-white"
                  >
                    {{ diffSummary.tables }}
                  </div>
                </div>
                <div
                  class="rounded-md bg-gray-50 px-3 py-3 dark:bg-gray-900/60"
                >
                  <div
                    class="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400"
                  >
                    Rename columns
                  </div>
                  <div
                    class="mt-1 text-lg font-semibold text-gray-900 dark:text-white"
                  >
                    {{ diffSummary.columnsToRename }}
                  </div>
                </div>
                <div
                  class="rounded-md bg-gray-50 px-3 py-3 dark:bg-gray-900/60"
                >
                  <div
                    class="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400"
                  >
                    Add columns
                  </div>
                  <div
                    class="mt-1 text-lg font-semibold text-gray-900 dark:text-white"
                  >
                    {{ diffSummary.columnsToAdd }}
                  </div>
                </div>
                <div
                  class="rounded-md bg-gray-50 px-3 py-3 dark:bg-gray-900/60"
                >
                  <div
                    class="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400"
                  >
                    Alter columns
                  </div>
                  <div
                    class="mt-1 text-lg font-semibold text-gray-900 dark:text-white"
                  >
                    {{ diffSummary.columnsToModify }}
                  </div>
                </div>
                <div
                  class="rounded-md bg-gray-50 px-3 py-3 dark:bg-gray-900/60"
                >
                  <div
                    class="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400"
                  >
                    Indexes
                  </div>
                  <div
                    class="mt-1 text-lg font-semibold text-gray-900 dark:text-white"
                  >
                    {{ diffSummary.indexes }}
                  </div>
                </div>
              </div>

              <div
                v-if="diffModels.length > 0"
                class="border-t border-gray-200 px-4 py-4 dark:border-gray-800"
              >
                <div class="mb-3 flex items-center justify-between">
                  <div>
                    <h3
                      class="text-sm font-medium text-gray-900 dark:text-white"
                    >
                      Models
                    </h3>
                    <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Filter which tables are included before you apply.
                    </p>
                  </div>
                  <div class="flex items-center gap-2 text-xs">
                    <button
                      @click="selectAllModels"
                      class="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                    >
                      Select all
                    </button>
                    <button
                      @click="deselectAllModels"
                      class="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <div class="flex flex-wrap gap-2">
                  <button
                    v-for="model in diffModels"
                    :key="model"
                    @click="toggleModel(model)"
                    :class="[
                      'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                      selectedModels.has(model)
                        ? 'border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:text-gray-900 dark:border-gray-700 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:text-white'
                    ]"
                  >
                    {{ model }}
                  </button>
                </div>
              </div>
            </div>

            <div class="space-y-4">
              <div
                v-for="(statement, index) in filteredStatements"
                :key="`${statement.type}-${
                  statement.table || 'global'
                }-${index}`"
                class="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800"
              >
                <div
                  class="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-800 dark:bg-gray-900/60"
                >
                  <div>
                    <p
                      class="text-sm font-medium text-gray-900 dark:text-white"
                    >
                      {{ statement.table || 'database' }}
                    </p>
                    <p
                      class="mt-0.5 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400"
                    >
                      {{ statement.type.replace(/_/g, ' ') }}
                    </p>
                  </div>
                  <span
                    v-if="statement.column"
                    class="rounded bg-gray-100 px-2 py-1 font-mono text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                  >
                    {{ statement.column }}
                  </span>
                </div>

                <div class="overflow-x-auto bg-white dark:bg-gray-950">
                  <pre
                    class="min-w-full p-4 font-mono text-xs leading-6 text-gray-700 dark:text-gray-200"
                    v-html="highlightSQL(statement.sql)"
                  ></pre>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- ═══ Activity Tab ═══ -->
        <div v-if="activeTab === 'activity'">
          <div class="mb-6 flex items-start justify-between">
            <div>
              <h1 class="text-xl font-semibold text-gray-900 dark:text-white">
                Activity
              </h1>
              <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Recent deployments, backups, and audit events.
              </p>
            </div>

            <!-- Filter -->
            <div
              class="flex items-center space-x-1 rounded-md border border-gray-200 p-0.5 dark:border-gray-800"
            >
              <button
                v-for="f in [
                  { id: 'all', label: 'All' },
                  { id: 'deployments', label: 'Deploys' },
                  { id: 'backups', label: 'Backups' },
                  { id: 'audit', label: 'Audit' }
                ]"
                :key="f.id"
                @click="changeActivityFilter(f.id)"
                :class="[
                  'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                  activityFilter === f.id
                    ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                    : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                ]"
              >
                {{ f.label }}
              </button>
            </div>
          </div>

          <!-- Loading -->
          <div v-if="activityLoading" class="py-16 text-center">
            <SlippyLoader class="mx-auto text-gray-400 dark:text-gray-600" />
          </div>

          <!-- Empty state -->
          <div v-else-if="activities.length === 0" class="py-20 text-center">
            <svg
              class="mx-auto h-12 w-12 text-gray-300 dark:text-gray-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.5"
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <h3 class="mt-4 text-sm font-medium text-gray-900 dark:text-white">
              No activity yet
            </h3>
            <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Deploy an application or create a backup to see activity here.
            </p>
          </div>

          <!-- Activity feed -->
          <div
            v-else
            class="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800"
          >
            <div
              v-for="(activity, i) in activities"
              :key="activity.id"
              :class="[
                'flex items-center gap-4 px-4 py-3',
                i > 0 ? 'border-t border-gray-100 dark:border-gray-800' : ''
              ]"
            >
              <!-- Type badge -->
              <span
                :class="[
                  'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-[10px] font-bold',
                  activityTypeColor(activity.type)
                ]"
              >
                {{ activityTypeIcon(activity.type) }}
              </span>

              <!-- Description -->
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span
                    class="truncate text-sm font-medium text-gray-900 dark:text-white"
                    >{{ activity.description }}</span
                  >
                  <span
                    v-if="activity.status"
                    :class="[
                      'inline-flex shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                      statusColor(activity.status)
                    ]"
                    >{{ activity.status }}</span
                  >
                </div>
                <div
                  class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400"
                >
                  <span>{{ activity.resource }}</span>
                  <span
                    v-if="activity.user"
                    class="text-gray-300 dark:text-gray-600"
                    >&middot;</span
                  >
                  <span v-if="activity.user">{{
                    activity.user.fullName || activity.user.email
                  }}</span>
                  <span
                    v-if="activity.metadata?.environment"
                    class="text-gray-300 dark:text-gray-600"
                    >&middot;</span
                  >
                  <span v-if="activity.metadata?.environment">{{
                    activity.metadata.environment
                  }}</span>
                </div>
              </div>

              <!-- Metadata badges -->
              <div class="hidden items-center space-x-1.5 lg:flex">
                <span
                  v-if="activity.metadata?.gitCommit"
                  class="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                >
                  {{ activity.metadata.gitCommit }}
                </span>
                <span
                  v-if="activity.metadata?.triggerType"
                  class="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                >
                  {{ activity.metadata.triggerType }}
                </span>
                <span
                  v-if="activity.metadata?.sizeBytes"
                  class="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                >
                  {{ formatBytes(activity.metadata.sizeBytes) }}
                </span>
              </div>

              <!-- Timestamp -->
              <span
                class="w-14 shrink-0 text-right text-xs text-gray-400 dark:text-gray-500"
              >
                {{ timeAgo(activity.createdAt) }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
    <ConfirmModal
      :show="showMigrateConfirm"
      title="Apply migration?"
      :message="`This will execute ${
        filteredStatements.length
      } SQLite statement${
        filteredStatements.length !== 1 ? 's' : ''
      } against Bosun's ${selectedDatabase} database.`"
      confirmLabel="Apply"
      :loading="migrateLoading"
      @confirm="applyMigration"
      @cancel="showMigrateConfirm = false"
    />
    <ToastContainer :toasts="toasts" @dismiss="dismissToast" />
  </div>
</template>
