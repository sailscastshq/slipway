<script setup>
import { Link, Head } from '@inertiajs/vue3'
import {
  inject,
  ref,
  computed,
  watch,
  onMounted,
  onUnmounted,
  nextTick
} from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import ToastContainer from '@/components/ToastContainer.vue'
import Tooltip from '@/components/Tooltip.vue'
import CodeEditor from '@/components/CodeEditor.vue'
import DockResultStatusIcon from '@/components/DockResultStatusIcon.vue'
import { highlightSQL } from '@/lib/highlightSQL'
import { highlightJSON } from '@/lib/highlightJSON'
import SlippyLoader from '@/components/SlippyLoader.vue'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  project: Object,
  environment: Object,
  databaseService: Object, // null when in picker mode
  availableServices: Array,
  appRunning: Boolean
})

const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')

// Service picker mode (no service selected)
const isPickerMode = computed(() => !props.databaseService)

// Database type helpers
const isMongoDB = computed(() => props.databaseService?.type === 'mongodb')
const isSQL = computed(() =>
  ['postgresql', 'mysql'].includes(props.databaseService?.type)
)
const isRedis = computed(() => props.databaseService?.type === 'redis')
const hasMultipleServices = computed(
  () => (props.availableServices?.length || 0) > 1
)

// Build dock URL for a service
function dockUrl(serviceId) {
  const envPath =
    props.environment.slug !== 'production'
      ? `/environments/${props.environment.slug}`
      : ''
  return `/projects/${props.project.slug}${envPath}/dock/${serviceId}`
}

// Navigate to a different service
function switchService(serviceId) {
  window.location.href = dockUrl(serviceId)
}

// Active tab - initialize from URL query param
// Redis: only console
// MongoDB: shell, collections, migrate (for creating collections)
// SQL: console, tables, schema, migrate
const validTabs = computed(() => {
  if (isRedis.value) return ['console']
  if (isMongoDB.value) return ['console', 'collections', 'migrate']
  return ['console', 'tables', 'schema', 'migrate']
})
const initialTab = new URLSearchParams(window.location.search).get('tab')
const activeTab = ref(
  validTabs.value.includes(initialTab) ? initialTab : 'console'
)

// Sync tab to URL
watch(activeTab, (tab) => {
  const url = new URL(window.location)
  if (tab === 'console') {
    url.searchParams.delete('tab')
  } else {
    url.searchParams.set('tab', tab)
  }
  window.history.replaceState({}, '', url)
})

// Default query based on database type
const defaultQuery = computed(() =>
  isMongoDB.value
    ? 'db.users.find().limit(10).toArray()'
    : 'SELECT * FROM users LIMIT 10;'
)

// Console state
const query = ref('')
const queryResult = ref(null)
const queryError = ref(null)
const queryLoading = ref(false)
const queryHistory = ref([])
const resultView = ref('table') // 'table' or 'json'
const showExportMenu = ref(false)
const activeQueryResultIndex = ref(0)

const queryResults = computed(() => {
  if (!queryResult.value) return []
  if (queryResult.value.results?.length) return queryResult.value.results
  return [queryResult.value]
})
const activeQueryResult = computed(
  () => queryResults.value[activeQueryResultIndex.value] || null
)
const hasMultipleQueryResults = computed(() => queryResults.value.length > 1)
const hasOnlyCommandResults = computed(
  () =>
    isSQL.value &&
    queryResults.value.length > 0 &&
    queryResults.value.every((result) => !result.columns?.length)
)
const commandBatchSummary = computed(() => {
  const total = queryResults.value.length
  const failed = queryResults.value.filter(
    (result) => result.status === 'error'
  ).length
  const completed = total - failed
  const statements = total === 1 ? 'statement' : 'statements'
  const duration = formatQueryDuration(queryResult.value?.duration)

  const summary =
    failed > 0
      ? `${completed} of ${total} ${statements} completed · ${failed} failed`
      : `${total} ${statements} completed`

  return duration ? `${summary} · ${duration}` : summary
})

// Redis console state
const redisCommand = ref('')
const redisRunning = ref(false)
const redisHistory = ref([])
const redisHistoryIndex = ref(-1)
const redisOutputContainer = ref(null)
const redisCommandInput = ref(null)

const redisQuickCommands = [
  { label: 'PING', cmd: 'PING' },
  { label: 'INFO', cmd: 'INFO server' },
  { label: 'DBSIZE', cmd: 'DBSIZE' },
  { label: 'KEYS *', cmd: 'KEYS *' },
  { label: 'CONFIG GET maxmemory', cmd: 'CONFIG GET maxmemory' }
]

// Schema state
const schema = ref(null)
const schemaLoading = ref(false)
const schemaError = ref(null)
const schemaFilterOpen = ref(false)

// Initialize selected schema tables from URL
const initialSchemaTables = new URLSearchParams(window.location.search).get(
  'schemaTables'
)
const selectedSchemaTables = ref(
  new Set(initialSchemaTables ? initialSchemaTables.split(',') : [])
)

// All available table names for the dropdown
const allSchemaTableNames = computed(() => {
  if (!schema.value?.tables) return []
  return Object.keys(schema.value.tables).sort()
})

// Filtered schema tables based on selection
const filteredSchemaTables = computed(() => {
  if (!schema.value?.tables) return {}
  // If no tables selected, show all
  if (selectedSchemaTables.value.size === 0) return schema.value.tables

  const filtered = {}
  for (const tableName of selectedSchemaTables.value) {
    if (schema.value.tables[tableName]) {
      filtered[tableName] = schema.value.tables[tableName]
    }
  }
  return filtered
})

// Toggle table selection
function toggleSchemaTable(tableName) {
  if (selectedSchemaTables.value.has(tableName)) {
    selectedSchemaTables.value.delete(tableName)
  } else {
    selectedSchemaTables.value.add(tableName)
  }
  selectedSchemaTables.value = new Set(selectedSchemaTables.value) // Trigger reactivity
  syncSchemaFilterToUrl()
}

function selectAllSchemaTables() {
  selectedSchemaTables.value = new Set(allSchemaTableNames.value)
  syncSchemaFilterToUrl()
}

function clearSchemaTableSelection() {
  selectedSchemaTables.value = new Set()
  syncSchemaFilterToUrl()
}

function syncSchemaFilterToUrl() {
  const url = new URL(window.location)
  if (selectedSchemaTables.value.size === 0) {
    url.searchParams.delete('schemaTables')
  } else {
    url.searchParams.set(
      'schemaTables',
      Array.from(selectedSchemaTables.value).join(',')
    )
  }
  window.history.replaceState({}, '', url)
}

// Diff state
const diff = ref(null)
const diffLoading = ref(false)
const diffError = ref(null)
const migrateLoading = ref(false)
const selectedModels = ref(new Set())
const showMigrateConfirm = ref(false)

// Export/Import state
const exportLoading = ref(false)
const exportDropdownOpen = ref(false)
const selectedExportTables = ref(new Set())
const exportMode = ref('full') // 'full', 'schema', 'data'
const importMode = ref('paste') // 'paste' or 'upload'
const importSql = ref('')
const importFile = ref(null) // Raw File object for binary .dmp uploads
const importLoading = ref(false)
const showImportModal = ref(false)
const showImportConfirm = ref(false)

// Toast state
const toasts = ref([])
let toastId = 0

function showToast(message, type = 'success') {
  const id = ++toastId
  toasts.value.push({ id, message, type })
  setTimeout(() => dismissToast(id), 5000)
}

function dismissToast(id) {
  toasts.value = toasts.value.filter((t) => t.id !== id)
}

// Tables state
const tables = ref([])
const tablesLoading = ref(false)
const initialTable = new URLSearchParams(window.location.search).get('table')
const selectedTable = ref(initialTable)
const tableData = ref(null)
const tableDataLoading = ref(false)

// Sync selected table to URL
watch(selectedTable, (table) => {
  const url = new URL(window.location)
  if (table) {
    url.searchParams.set('table', table)
  } else {
    url.searchParams.delete('table')
  }
  window.history.replaceState({}, '', url)
})

const apiBasePath = computed(() => {
  const envPath =
    props.environment.slug !== 'production'
      ? `/environments/${props.environment.slug}`
      : ''
  return `/api/v1/projects/${props.project.slug}${envPath}/dock`
})

// Query string with service ID for all API calls
const serviceQuery = computed(() => {
  return props.databaseService?.id ? `?service=${props.databaseService.id}` : ''
})

// Helper to build API URL with service param
function apiUrl(endpoint, extraParams = '') {
  const hasQuery = serviceQuery.value || extraParams
  const queryPart =
    serviceQuery.value +
    (extraParams
      ? (serviceQuery.value ? '&' : '?') + extraParams.replace(/^\?/, '')
      : '')
  return `${apiBasePath.value}${endpoint}${queryPart}`
}

// Execute SQL query
async function executeQuery() {
  if (!query.value.trim()) return

  queryLoading.value = true
  queryResult.value = null
  queryError.value = null

  try {
    const res = await fetch(apiUrl('/sql'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: query.value })
    })

    let data
    const text = await res.text()
    try {
      data = JSON.parse(text)
    } catch {
      queryError.value = text || 'Query failed'
      return
    }

    if (data.results?.length) {
      queryResult.value = data
      const failedResultIndex = data.results.findIndex(
        (result) => result.status === 'error'
      )
      activeQueryResultIndex.value =
        failedResultIndex === -1 ? 0 : failedResultIndex
      resultView.value = 'table'
    } else if (!res.ok || !data.success) {
      queryError.value = data?.error || data?.message || text || 'Query failed'
    } else {
      queryResult.value = data
      activeQueryResultIndex.value = 0
      resultView.value = 'table'
    }

    if (queryResult.value && !queryHistory.value.includes(query.value)) {
      queryHistory.value.unshift(query.value)
      if (queryHistory.value.length > 20) queryHistory.value.pop()
    }
  } catch (e) {
    queryError.value = e.message
  } finally {
    queryLoading.value = false
  }
}

// Redis command execution
async function executeRedisCommand() {
  if (!redisCommand.value.trim() || redisRunning.value) return

  const cmd = redisCommand.value
  redisRunning.value = true
  redisHistoryIndex.value = -1

  try {
    const res = await fetch(
      `/api/v1/services/${props.databaseService.id}/redis`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd })
      }
    )

    const result = await res.json()

    redisHistory.value.push({
      command: cmd,
      output: result.output || '',
      error: result.error || null,
      success: result.success,
      duration: result.duration,
      time: new Date()
    })

    // Cap at 200 entries
    if (redisHistory.value.length > 200) {
      redisHistory.value = redisHistory.value.slice(-150)
    }

    redisCommand.value = ''
  } catch (err) {
    redisHistory.value.push({
      command: cmd,
      output: '',
      error: err.message,
      success: false,
      duration: 0,
      time: new Date()
    })
  } finally {
    redisRunning.value = false
    nextTick(() => {
      redisCommandInput.value?.focus()
      if (redisOutputContainer.value) {
        redisOutputContainer.value.scrollTop =
          redisOutputContainer.value.scrollHeight
      }
    })
  }
}

function handleRedisKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    executeRedisCommand()
  }
  // Up arrow to navigate history
  if (e.key === 'ArrowUp' && redisHistory.value.length > 0) {
    e.preventDefault()
    if (redisHistoryIndex.value < redisHistory.value.length - 1) {
      redisHistoryIndex.value++
    }
    const entry =
      redisHistory.value[
        redisHistory.value.length - 1 - redisHistoryIndex.value
      ]
    if (entry) redisCommand.value = entry.command
  }
  // Down arrow to navigate history
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (redisHistoryIndex.value > 0) {
      redisHistoryIndex.value--
      const entry =
        redisHistory.value[
          redisHistory.value.length - 1 - redisHistoryIndex.value
        ]
      if (entry) redisCommand.value = entry.command
    } else {
      redisHistoryIndex.value = -1
      redisCommand.value = ''
    }
  }
}

function runRedisQuickCommand(cmd) {
  redisCommand.value = cmd
  nextTick(() => executeRedisCommand())
}

function clearRedisHistory() {
  redisHistory.value = []
}

// Fetch schema
async function fetchSchema() {
  schemaLoading.value = true
  schemaError.value = null

  try {
    const res = await fetch(apiUrl('/schema'))
    const data = await res.json()

    if (!res.ok) {
      schemaError.value = data.message || 'Failed to load schema'
    } else {
      schema.value = data
    }
  } catch (e) {
    schemaError.value = e.message
  } finally {
    schemaLoading.value = false
  }
}

// Fetch diff
async function fetchDiff() {
  diffLoading.value = true
  diffError.value = null

  try {
    const res = await fetch(apiUrl('/diff'))
    const data = await res.json()

    if (!res.ok) {
      diff.value = null
      selectedModels.value = new Set()
      diffError.value = data.error || data.message || 'Failed to load diff'
    } else if (!Array.isArray(data.statements)) {
      diff.value = null
      selectedModels.value = new Set()
      diffError.value = data.error || data.message || 'Failed to load diff'
    } else {
      diff.value = data
      // Initialize all models as selected
      const models = new Set()
      data.statements.forEach((stmt) => {
        if (stmt.table) models.add(stmt.table)
      })
      selectedModels.value = models
    }
  } catch (e) {
    diffError.value = e.message
  } finally {
    diffLoading.value = false
  }
}

// Get unique models from diff
const diffModels = computed(() => {
  if (!diff.value?.statements) return []
  const models = new Set()
  diff.value.statements.forEach((stmt) => {
    if (stmt.table) models.add(stmt.table)
  })
  return Array.from(models).sort()
})

// Filter statements by selected models
const filteredStatements = computed(() => {
  if (!diff.value?.statements) return []
  return diff.value.statements.filter(
    (stmt) => !stmt.table || selectedModels.value.has(stmt.table)
  )
})

function toggleModel(model) {
  if (selectedModels.value.has(model)) {
    selectedModels.value.delete(model)
  } else {
    selectedModels.value.add(model)
  }
  // Trigger reactivity
  selectedModels.value = new Set(selectedModels.value)
}

function selectAllModels() {
  selectedModels.value = new Set(diffModels.value)
}

function deselectAllModels() {
  selectedModels.value = new Set()
}

// Show migration confirmation modal
function confirmMigration() {
  if (!filteredStatements.value.length) return
  showMigrateConfirm.value = true
}

// Apply migration
async function applyMigration() {
  showMigrateConfirm.value = false
  migrateLoading.value = true

  try {
    const res = await fetch(apiUrl('/migrate'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ statements: filteredStatements.value })
    })

    const data = await res.json()

    if (!res.ok || !data.success) {
      showToast(data.error || data.message || 'Migration failed', 'error')
    } else {
      showToast(
        `Migration applied: ${data.executed} statement(s) executed`,
        'success'
      )
      await fetchDiff()
    }
  } catch (e) {
    showToast(e.message, 'error')
  } finally {
    migrateLoading.value = false
  }
}

// Export database
async function exportDatabase(mode = 'full') {
  exportLoading.value = true
  exportDropdownOpen.value = false

  try {
    const tablesToExport =
      selectedExportTables.value.size > 0
        ? Array.from(selectedExportTables.value)
        : null

    const res = await fetch(apiUrl('/export'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tables: tablesToExport,
        dataOnly: mode === 'data',
        schemaOnly: mode === 'schema'
      })
    })

    const data = await res.json()

    if (!res.ok || !data.success) {
      showToast(data.error || 'Export failed', 'error')
      return
    }

    // Download the export file
    const ext = isMongoDB.value ? 'json' : 'sql'
    const mimeType = isMongoDB.value ? 'application/json' : 'application/sql'
    const filename = `${props.project.slug}-${props.environment.slug}-${
      mode === 'schema' ? 'schema' : mode === 'data' ? 'data' : 'backup'
    }.${ext}`
    downloadFile(data.sql, filename, mimeType)
    showToast(
      `Exported ${data.lines} lines (${formatBytes(data.size)})`,
      'success'
    )
  } catch (e) {
    showToast(e.message, 'error')
  } finally {
    exportLoading.value = false
  }
}

function toggleExportTable(tableName) {
  if (selectedExportTables.value.has(tableName)) {
    selectedExportTables.value.delete(tableName)
  } else {
    selectedExportTables.value.add(tableName)
  }
  selectedExportTables.value = new Set(selectedExportTables.value)
}

function selectAllExportTables() {
  selectedExportTables.value = new Set(tables.value.map((t) => t.name))
}

function clearExportTableSelection() {
  selectedExportTables.value = new Set()
}

// Import modal — synced with ?import query param
const initialImport = new URLSearchParams(window.location.search).get('import')

function openImportModal() {
  importSql.value = ''
  importFile.value = null
  importMode.value = 'paste'
  showImportModal.value = true
  const url = new URL(window.location)
  url.searchParams.set('import', '1')
  window.history.replaceState({}, '', url)
}

function openImportModalFromExportActions() {
  exportDropdownOpen.value = false
  openImportModal()
}

function closeImportModal() {
  showImportModal.value = false
  importSql.value = ''
  importFile.value = null
  const url = new URL(window.location)
  url.searchParams.delete('import')
  window.history.replaceState({}, '', url)
}

const isBinaryImport = computed(() => {
  const name = importFile.value?.name
  return name?.endsWith('.dmp') || name?.endsWith('.gz')
})

const importAccept = computed(() => {
  if (isMongoDB.value) return '.json,.gz'
  if (props.databaseService?.type === 'postgresql') return '.sql,.txt,.dmp'
  return '.sql,.txt'
})

const importFileLabel = computed(() => {
  if (isMongoDB.value) return 'Upload a .json or .gz file'
  if (props.databaseService?.type === 'postgresql')
    return 'Upload a .sql or .dmp file'
  return 'Upload a .sql file'
})

async function handleFileUpload(event) {
  const file = event.target.files[0]
  if (!file) return

  try {
    if (file.name.endsWith('.dmp') || file.name.endsWith('.gz')) {
      // Binary dump — store the File object, don't read as text
      importFile.value = file
      importSql.value = '' // Clear any previous text
      showToast(`Loaded ${file.name} (${formatBytes(file.size)})`, 'success')
    } else {
      // Text SQL file — existing behavior
      importFile.value = null
      const text = await file.text()
      importSql.value = text
      showToast(`Loaded ${file.name} (${formatBytes(file.size)})`, 'success')
    }
  } catch (e) {
    showToast('Failed to read file', 'error')
  }
}

function confirmImport() {
  if (!importFile.value && !importSql.value.trim()) {
    showToast('No data to import', 'error')
    return
  }
  showImportConfirm.value = true
}

async function executeImport() {
  showImportConfirm.value = false
  importLoading.value = true

  try {
    let res
    if (isBinaryImport.value) {
      // Binary dump — send as FormData
      const formData = new FormData()
      formData.append('dump', importFile.value)
      res = await fetch(apiUrl('/import'), {
        method: 'POST',
        body: formData
      })
    } else {
      // Text SQL — existing JSON body
      res = await fetch(apiUrl('/import'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: importSql.value })
      })
    }

    const data = await res.json()

    if (!res.ok || !data.success) {
      showToast(data.error || 'Import failed', 'error')
    } else {
      showToast(
        isBinaryImport.value
          ? `Dump restored in ${data.duration}ms`
          : `Import completed: ${data.statementCount} statement(s) in ${data.duration}ms`,
        'success'
      )
      closeImportModal()
      fetchTables()
      if (schema.value) fetchSchema()
      if (diff.value) fetchDiff()
    }
  } catch (e) {
    showToast(e.message, 'error')
  } finally {
    importLoading.value = false
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

// Fetch tables
async function fetchTables() {
  tablesLoading.value = true

  try {
    const res = await fetch(apiUrl('/tables'))
    const data = await res.json()

    if (res.ok) {
      tables.value = data.tables || []
    }
  } catch (e) {
    console.error('Failed to load tables:', e)
  } finally {
    tablesLoading.value = false
  }
}

// Browse table data
async function browseTable(tableName) {
  selectedTable.value = tableName
  tableDataLoading.value = true
  tableData.value = null

  try {
    const orderBy = isMongoDB.value ? '_id' : 'id'
    const res = await fetch(
      apiUrl(`/tables/${tableName}/data`, `limit=50&orderBy=${orderBy}`)
    )
    const data = await res.json()

    if (res.ok) {
      tableData.value = data
    }
  } catch (e) {
    console.error('Failed to load table data:', e)
  } finally {
    tableDataLoading.value = false
  }
}

function switchTab(tab) {
  activeTab.value = tab
  if (tab === 'schema' && !schema.value && !schemaLoading.value) {
    fetchSchema()
  }
  if (tab === 'migrate' && !diff.value && !diffLoading.value) {
    fetchDiff()
  }
  if (
    (tab === 'tables' || tab === 'collections') &&
    tables.value.length === 0 &&
    !tablesLoading.value
  ) {
    fetchTables()
  }
}

function formatRowCount(count) {
  if (count >= 1000000) return (count / 1000000).toFixed(1) + 'M'
  if (count >= 1000) return (count / 1000).toFixed(1) + 'K'
  return count
}

function selectQueryResult(index) {
  activeQueryResultIndex.value = index
  showExportMenu.value = false
}

function handleQueryResultKeydown(event, index) {
  let nextIndex = index

  if (event.key === 'ArrowRight') {
    nextIndex = (index + 1) % queryResults.value.length
  } else if (event.key === 'ArrowLeft') {
    nextIndex =
      (index - 1 + queryResults.value.length) % queryResults.value.length
  } else if (event.key === 'Home') {
    nextIndex = 0
  } else if (event.key === 'End') {
    nextIndex = queryResults.value.length - 1
  } else {
    return
  }

  event.preventDefault()
  selectQueryResult(nextIndex)
  nextTick(() => {
    document.getElementById(`dock-query-result-tab-${nextIndex}`)?.focus()
  })
}

function queryResultAriaLabel(result, index) {
  return `${index + 1}. ${
    result.statementPreview || result.commandTag || 'SQL statement'
  }. ${result.status || 'success'}`
}

function queryResultCountLabel(result) {
  if (result.status === 'error') return 'Failed'
  if (result.columns?.length) {
    return `${result.rowCount} row${result.rowCount === 1 ? '' : 's'}`
  }
  if (result.affected !== null && result.affected !== undefined) {
    return `${result.affected} row${result.affected === 1 ? '' : 's'} affected`
  }
  return result.commandTag || 'Completed'
}

function formatQueryDuration(duration) {
  if (duration === null || duration === undefined || duration === '') return ''

  const value = Number(duration)
  if (!Number.isFinite(value)) return ''

  const rounded =
    value >= 100 ? Math.round(value) : Math.round(value * 100) / 100
  return `${rounded}ms`
}

function queryResultStatementLabel(result) {
  return (
    result.statementPreview || result.statementSql || result.commandTag || 'SQL'
  )
}

// Export functions
function exportAsJSON() {
  if (!activeQueryResult.value?.rows) return
  const json = JSON.stringify(activeQueryResult.value.rows, null, 2)
  downloadFile(json, queryResultFilename('json'), 'application/json')
}

function exportAsCSV() {
  if (!activeQueryResult.value?.rows || !activeQueryResult.value?.columns)
    return
  const { columns, rows } = activeQueryResult.value
  const csvLines = [columns.join(',')]
  for (const row of rows) {
    const values = columns.map((col) => {
      const val = row[col]
      if (val === null) return ''
      const str = String(val)
      // Quote if contains comma, quote, or newline
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`
      }
      return str
    })
    csvLines.push(values.join(','))
  }
  downloadFile(csvLines.join('\n'), queryResultFilename('csv'), 'text/csv')
}

function downloadQueryResultAsJSON() {
  showExportMenu.value = false
  exportAsJSON()
}

function downloadQueryResultAsCSV() {
  showExportMenu.value = false
  exportAsCSV()
}

function copyAsJSON() {
  if (!activeQueryResult.value?.rows) return
  const json = JSON.stringify(activeQueryResult.value.rows, null, 2)
  navigator.clipboard.writeText(json)
  showToast('Copied JSON to clipboard')
}

function copyAsCSV() {
  if (!activeQueryResult.value?.rows || !activeQueryResult.value?.columns)
    return
  const { columns, rows } = activeQueryResult.value
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

function queryResultFilename(extension) {
  const suffix = hasMultipleQueryResults.value
    ? `-${activeQueryResultIndex.value + 1}`
    : ''
  return `query-result${suffix}.${extension}`
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    a.remove()
    URL.revokeObjectURL(url)
  }, 100)
}

// Close all dropdowns on click outside
const handleClickOutside = (e) => {
  if (showExportMenu.value && !e.target.closest('[ref="exportDropdown"]')) {
    showExportMenu.value = false
  }
  if (schemaFilterOpen.value && !e.target.closest('[data-schema-filter]')) {
    schemaFilterOpen.value = false
  }
  if (exportDropdownOpen.value && !e.target.closest('[data-export-dropdown]')) {
    exportDropdownOpen.value = false
  }
}

// Handle escape key to close menus
function handleEscapeKey(e) {
  if (e.key === 'Escape') {
    showExportMenu.value = false
    schemaFilterOpen.value = false
    exportDropdownOpen.value = false
    if (showImportModal.value && !importLoading.value) {
      closeImportModal()
    }
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
  document.addEventListener('keydown', handleEscapeKey)
  // Set default query based on database type
  if (!query.value) {
    query.value = defaultQuery.value
  }
  if (props.databaseService && !isRedis.value) {
    // Fetch tables/collections for non-Redis services
    fetchTables()
    // Fetch data for initial tab if needed (SQL databases only)
    if (activeTab.value === 'schema' && isSQL.value) {
      fetchSchema()
    } else if (activeTab.value === 'migrate' && isSQL.value) {
      fetchDiff()
    }
    // Load table data if specified in URL
    if (selectedTable.value) {
      browseTable(selectedTable.value)
    }
  }
  // Open import modal if ?import=1 in URL
  if (initialImport) {
    openImportModal()
  }
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
  document.removeEventListener('keydown', handleEscapeKey)
})
</script>

<template>
  <Head :title="`Dock - ${project.name} | Slipway`"></Head>
  <div class="flex h-full flex-col">
    <!-- Header -->
    <div
      class="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800 sm:px-6"
    >
      <div class="flex items-center space-x-3">
        <!-- Mobile menu toggle -->
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
        <!-- Desktop sidebar toggle -->
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
        <!-- Mobile: simplified breadcrumb -->
        <nav class="flex items-center space-x-2 text-sm sm:hidden">
          <Link
            :href="`/projects/${project.slug}/environments/${environment.slug}`"
            class="text-gray-500 dark:text-gray-400"
          >
            {{ project.name.toLowerCase() }}
          </Link>
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <span class="font-medium text-gray-900 dark:text-white">dock</span>
        </nav>
        <!-- Desktop: full breadcrumb -->
        <nav class="hidden items-center space-x-2 text-sm sm:flex">
          <Link
            href="/"
            class="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
            >projects</Link
          >
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <Link
            :href="`/projects/${project.slug}`"
            class="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >
            {{ project.name.toLowerCase() }}
          </Link>
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <Link
            :href="`/projects/${project.slug}/environments/${environment.slug}`"
            class="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >
            {{ environment.slug }}
          </Link>
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <span class="font-medium text-gray-900 dark:text-white">dock</span>
        </nav>
      </div>
      <div class="flex items-center space-x-2 sm:space-x-3">
        <!-- Database selector (when multiple DBs available) -->
        <div
          v-if="databaseService && hasMultipleServices"
          class="relative hidden sm:block"
        >
          <select
            :value="databaseService.id"
            @change="switchService($event.target.value)"
            class="focus:border-brand appearance-none border-b border-dashed border-gray-300 bg-transparent py-1 pl-1 pr-6 text-sm text-gray-600 focus:outline-none dark:border-gray-600 dark:text-gray-400"
          >
            <option
              v-for="svc in availableServices"
              :key="svc.id"
              :value="svc.id"
            >
              {{ svc.name }}
            </option>
          </select>
          <svg
            class="pointer-events-none absolute right-0 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </div>
        <!-- Single DB badge -->
        <span
          v-else-if="databaseService && isRedis"
          class="inline-flex h-6 w-6 items-center justify-center rounded bg-red-100 text-[9px] font-bold text-red-600 dark:bg-red-900/30 dark:text-red-400 sm:inline-flex"
        >
          Rd
        </span>
        <span
          v-else-if="databaseService"
          class="hidden rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400 sm:inline-block"
        >
          {{ databaseService.type }}
        </span>
        <!-- Redis connection status -->
        <span
          v-if="isRedis && databaseService?.status === 'running'"
          class="flex items-center space-x-1.5 text-xs text-green-600 dark:text-green-400"
        >
          <span class="h-1.5 w-1.5 rounded-full bg-green-500"></span>
          <span class="hidden sm:inline">connected</span>
        </span>
        <a
          href="https://docs.sailscasts.com/slipway/dock"
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

    <!-- No services available -->
    <div
      v-if="isPickerMode && availableServices.length === 0"
      class="flex flex-1 items-center justify-center p-8"
    >
      <div class="max-w-md text-center">
        <svg
          class="mx-auto h-12 w-12 text-gray-400 dark:text-gray-600"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.5"
            d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"
          />
        </svg>
        <h3 class="mt-4 text-sm font-medium text-gray-900 dark:text-white">
          No database services
        </h3>
        <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
          Add a PostgreSQL, MySQL, MongoDB, or Redis service to enable Dock.
        </p>
        <Link
          :href="`/projects/${project.slug}/environments/${environment.slug}`"
          class="mt-4 inline-flex items-center text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
        >
          Go to environment
          <svg
            class="ml-1 h-4 w-4"
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
        </Link>
      </div>
    </div>

    <!-- Service Picker (no service selected yet) -->
    <div
      v-else-if="isPickerMode"
      class="flex flex-1 items-center justify-center p-6 sm:p-8"
    >
      <div class="w-full max-w-md">
        <!-- Header -->
        <div class="mb-6 text-center">
          <div
            class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800"
          >
            <svg
              class="h-6 w-6 text-gray-500 dark:text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.5"
                d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"
              />
            </svg>
          </div>
          <h2 class="text-lg font-medium text-gray-900 dark:text-white">
            Dock
          </h2>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Select a service to manage
          </p>
        </div>

        <!-- Service List -->
        <div
          class="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800"
        >
          <Link
            v-for="(service, index) in availableServices"
            :key="service.id"
            :href="dockUrl(service.id)"
            :class="[
              'group flex items-center justify-between px-4 py-3 transition-colors hover:bg-gray-50 dark:hover:bg-gray-900/50',
              index !== availableServices.length - 1
                ? 'border-b border-gray-200 dark:border-gray-800'
                : ''
            ]"
          >
            <div class="flex items-center space-x-3">
              <!-- Service icon -->
              <div
                :class="[
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-xs font-bold',
                  service.type === 'redis'
                    ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                    : service.type === 'mongodb'
                    ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400'
                    : service.type === 'mysql'
                    ? 'bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400'
                    : 'bg-sky-100 text-sky-600 dark:bg-sky-900/30 dark:text-sky-400'
                ]"
              >
                {{
                  service.type === 'redis'
                    ? 'RD'
                    : service.type === 'mongodb'
                    ? 'MG'
                    : service.type === 'mysql'
                    ? 'MY'
                    : 'PG'
                }}
              </div>
              <div>
                <p class="text-sm font-medium text-gray-900 dark:text-white">
                  {{ service.name }}
                </p>
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  {{
                    service.type === 'postgresql'
                      ? 'PostgreSQL'
                      : service.type === 'mysql'
                      ? 'MySQL'
                      : service.type === 'mongodb'
                      ? 'MongoDB'
                      : 'Redis'
                  }}
                  <span
                    v-if="service.database"
                    class="text-gray-400 dark:text-gray-500"
                    >· {{ service.database }}</span
                  >
                </p>
              </div>
            </div>
            <svg
              class="h-4 w-4 text-gray-400 transition-transform group-hover:translate-x-0.5 dark:text-gray-500"
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
          </Link>
        </div>
      </div>
    </div>

    <!-- Database management UI (service selected) -->
    <div v-else class="flex flex-1 flex-col overflow-hidden">
      <!-- Tabs (hidden for Redis since it only has console) -->
      <div
        v-if="validTabs.length > 1"
        class="sticky top-0 z-10 flex items-center space-x-1 border-b border-gray-200/50 bg-white/80 px-4 py-2 backdrop-blur-md dark:border-gray-800/50 dark:bg-gray-950/80 sm:px-6"
      >
        <button
          v-for="tab in validTabs"
          :key="tab"
          @click="switchTab(tab)"
          :class="[
            'rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors',
            activeTab === tab
              ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
              : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-300'
          ]"
        >
          {{ tab === 'console' ? (isMongoDB ? 'Shell' : 'SQL') : tab }}
        </button>
      </div>

      <!-- Redis Console Tab -->
      <div
        v-if="activeTab === 'console' && isRedis"
        class="flex flex-1 flex-col overflow-hidden"
      >
        <!-- Quick actions bar -->
        <div
          class="flex items-center gap-2 border-b border-gray-200 bg-gray-50 px-4 py-2 dark:border-gray-800 dark:bg-gray-900"
        >
          <span
            class="hidden shrink-0 text-xs font-medium text-gray-500 dark:text-gray-400 sm:block"
            >Quick:</span
          >
          <div class="flex flex-1 items-center gap-2 overflow-x-auto">
            <button
              v-for="qc in redisQuickCommands"
              :key="qc.cmd"
              @click="runRedisQuickCommand(qc.cmd)"
              :disabled="redisRunning"
              class="shrink-0 rounded-md border border-gray-200 bg-white px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
            >
              {{ qc.label }}
            </button>
          </div>
          <button
            v-if="redisHistory.length > 0"
            @click="clearRedisHistory"
            class="shrink-0 text-xs text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
          >
            Clear
          </button>
        </div>

        <!-- Output area -->
        <div
          ref="redisOutputContainer"
          class="flex-1 overflow-y-auto bg-gray-100 p-4 font-mono text-sm leading-6 dark:bg-gray-950"
        >
          <!-- Empty state -->
          <div
            v-if="redisHistory.length === 0 && !redisRunning"
            class="text-gray-500 dark:text-gray-600"
          >
            <p>
              Redis CLI console for
              <span class="font-medium text-gray-700 dark:text-gray-400">{{
                databaseService.name
              }}</span>
            </p>
            <p class="mt-2">
              Type a command below or use the quick actions above.
            </p>
            <p class="mt-1 text-gray-400 dark:text-gray-700">
              Use
              <kbd
                class="rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                >Up</kbd
              >/<kbd
                class="rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                >Down</kbd
              >
              arrows to navigate history.
            </p>
          </div>

          <!-- Command history output -->
          <div v-for="(entry, i) in redisHistory" :key="i" class="mb-3">
            <div class="flex items-center gap-2">
              <span class="text-red-500 dark:text-red-400">redis&gt;</span>
              <span class="text-gray-900 dark:text-gray-200">{{
                entry.command
              }}</span>
              <span class="text-xs text-gray-400 dark:text-gray-700"
                >{{ entry.duration }}ms</span
              >
            </div>
            <pre
              v-if="entry.success && entry.output"
              class="mt-0.5 whitespace-pre-wrap text-green-600 dark:text-green-400"
              >{{ entry.output }}</pre
            >
            <pre
              v-if="entry.error"
              class="mt-0.5 whitespace-pre-wrap text-red-500 dark:text-red-400"
              >{{ entry.error }}</pre
            >
            <div
              v-if="entry.success && !entry.output && !entry.error"
              class="mt-0.5 text-gray-400 dark:text-gray-600"
            >
              (empty)
            </div>
          </div>

          <!-- Running indicator -->
          <div
            v-if="redisRunning"
            class="flex items-center space-x-2 text-gray-500"
          >
            <SlippyLoader size="h-4 w-4" />
            <span>Executing...</span>
          </div>
        </div>

        <!-- Command input -->
        <div
          class="border-t border-gray-200 bg-gray-100 dark:border-gray-800 dark:bg-gray-950"
        >
          <div class="flex items-center px-4 py-3">
            <span class="mr-2 font-mono text-sm text-red-500 dark:text-red-400"
              >redis&gt;</span
            >
            <input
              ref="redisCommandInput"
              v-model="redisCommand"
              @keydown="handleRedisKeydown"
              :disabled="redisRunning"
              type="text"
              placeholder="Enter Redis command..."
              spellcheck="false"
              autocomplete="off"
              class="flex-1 border-0 bg-transparent font-mono text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-0 dark:text-gray-200 dark:placeholder-gray-600"
            />
            <button
              @click="executeRedisCommand"
              :disabled="!redisCommand.trim() || redisRunning"
              class="ml-2 flex items-center space-x-1.5 rounded-md bg-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-300 disabled:opacity-50 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              <SlippyLoader v-if="redisRunning" size="h-3 w-3" />
              <span>{{ redisRunning ? 'Running...' : 'Run' }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- SQL/MongoDB Console Tab -->
      <div
        v-if="activeTab === 'console' && !isRedis"
        class="flex flex-1 flex-col overflow-hidden"
      >
        <!-- Editor -->
        <div
          data-test="dock-query-editor-pane"
          class="flex-1 overflow-hidden border-b border-gray-200 dark:border-gray-800"
        >
          <CodeEditor
            v-model="query"
            :language="isMongoDB ? 'javascript' : 'sql'"
            :placeholder="defaultQuery"
            aria-label="Database query"
            test-id="dock-query-editor"
            height="fill"
            submit-on-mod-enter
            @submit="executeQuery"
          />
        </div>

        <!-- Actions bar -->
        <div
          class="flex items-center justify-between border-b border-gray-200 px-4 py-2 dark:border-gray-800 sm:px-6"
        >
          <div
            class="flex items-center space-x-2 text-xs text-gray-500 dark:text-gray-400"
          >
            <kbd
              class="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-gray-600 dark:bg-gray-800 dark:text-gray-400"
              >⌘</kbd
            >
            <kbd
              class="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-gray-600 dark:bg-gray-800 dark:text-gray-400"
              >Enter</kbd
            >
            <span>to run</span>
          </div>
          <button
            @click="executeQuery"
            :disabled="queryLoading || !query.trim()"
            class="rounded-md bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
          >
            <span v-if="queryLoading">Running...</span>
            <span v-else>Run</span>
          </button>
        </div>

        <!-- Results -->
        <div
          data-test="dock-query-results"
          :class="[
            'overflow-auto',
            queryResult && hasOnlyCommandResults
              ? 'max-h-[45%] shrink-0'
              : 'min-h-0 flex-1'
          ]"
        >
          <!-- Error -->
          <div v-if="queryError" class="p-4">
            <div
              class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-900/50 dark:bg-red-950/30"
            >
              <p class="font-mono text-sm text-red-600 dark:text-red-400">
                {{ queryError }}
              </p>
            </div>
          </div>

          <!-- Compact command-only results -->
          <section
            v-else-if="queryResult && hasOnlyCommandResults"
            aria-labelledby="dock-command-summary-heading"
            aria-live="polite"
            data-test="dock-command-summary"
            class="px-4 py-4 sm:px-6"
          >
            <h2 id="dock-command-summary-heading" class="sr-only">
              SQL statement results
            </h2>
            <ol class="space-y-1.5">
              <li
                v-for="(result, index) in queryResults"
                :key="index"
                :data-test="`dock-command-result-${index + 1}`"
                class="rounded-lg bg-gray-50 px-3 py-2.5 dark:bg-gray-900/60"
              >
                <div class="flex items-start gap-3">
                  <DockResultStatusIcon
                    :status="result.status"
                    contained
                    class="mt-0.5"
                  />
                  <span
                    class="mt-0.5 w-4 shrink-0 text-right text-xs font-medium tabular-nums text-gray-400 dark:text-gray-600"
                  >
                    {{ index + 1 }}
                  </span>
                  <div class="min-w-0 flex-1">
                    <div class="flex items-start gap-3">
                      <p
                        class="min-w-0 flex-1 truncate font-mono text-sm text-gray-800 dark:text-gray-200"
                        :title="
                          result.statementSql ||
                          queryResultStatementLabel(result)
                        "
                      >
                        {{ queryResultStatementLabel(result) }}
                      </p>
                      <span
                        v-if="formatQueryDuration(result.duration)"
                        class="shrink-0 text-xs tabular-nums text-gray-400 dark:text-gray-500"
                      >
                        {{ formatQueryDuration(result.duration) }}
                      </span>
                    </div>
                    <div
                      class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
                    >
                      <span
                        :class="
                          result.status === 'error'
                            ? 'font-medium text-red-600 dark:text-red-400'
                            : 'font-medium text-green-700 dark:text-green-400'
                        "
                      >
                        {{ result.status === 'error' ? 'Failed' : 'Completed' }}
                      </span>
                      <span
                        v-if="
                          result.status !== 'error' &&
                          queryResultCountLabel(result) !== 'Completed'
                        "
                        class="text-gray-500 dark:text-gray-400"
                      >
                        {{ queryResultCountLabel(result) }}
                      </span>
                    </div>
                    <p
                      v-if="result.status === 'error'"
                      class="mt-1.5 break-words font-mono text-xs leading-5 text-red-600 dark:text-red-400"
                    >
                      {{
                        result.error ||
                        result.message ||
                        'The statement could not be completed.'
                      }}
                    </p>
                  </div>
                </div>
              </li>
            </ol>
            <p
              data-test="dock-command-summary-total"
              class="mt-3 text-right text-xs tabular-nums text-gray-500 dark:text-gray-400"
            >
              {{ commandBatchSummary }}
            </p>
          </section>

          <!-- Row-returning and mixed results -->
          <div v-else-if="queryResult" class="flex h-full min-h-0 flex-col">
            <div
              v-if="hasMultipleQueryResults"
              role="tablist"
              aria-label="Query results"
              class="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-gray-200 px-2 py-1.5 dark:border-gray-800"
            >
              <button
                v-for="(result, index) in queryResults"
                :id="`dock-query-result-tab-${index}`"
                :key="index"
                role="tab"
                :aria-selected="index === activeQueryResultIndex"
                aria-controls="dock-query-result-panel"
                :aria-label="queryResultAriaLabel(result, index)"
                :tabindex="index === activeQueryResultIndex ? 0 : -1"
                :data-test="`dock-query-result-${index + 1}`"
                :title="result.statementSql"
                :class="[
                  'min-h-8 max-w-64 flex shrink-0 items-center gap-2 rounded-md px-2.5 py-1 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 dark:focus-visible:ring-gray-600',
                  index === activeQueryResultIndex
                    ? 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-white'
                    : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-900 dark:hover:text-gray-200'
                ]"
                @click="selectQueryResult(index)"
                @keydown="handleQueryResultKeydown($event, index)"
              >
                <DockResultStatusIcon :status="result.status" />
                <span class="shrink-0 font-medium tabular-nums">{{
                  index + 1
                }}</span>
                <span class="truncate font-mono">
                  {{
                    result.statementPreview ||
                    result.commandTag ||
                    'SQL statement'
                  }}
                </span>
              </button>
            </div>

            <div
              id="dock-query-result-panel"
              data-test="dock-query-result-panel"
              role="tabpanel"
              :aria-labelledby="
                hasMultipleQueryResults
                  ? `dock-query-result-tab-${activeQueryResultIndex}`
                  : undefined
              "
              class="flex min-h-0 flex-1 flex-col"
            >
              <!-- Table view -->
              <div
                v-if="
                  activeQueryResult.columns &&
                  activeQueryResult.columns.length > 0 &&
                  resultView === 'table'
                "
                class="flex-1 overflow-auto"
              >
                <table class="min-w-full">
                  <caption class="sr-only">
                    Query result
                    {{
                      activeQueryResultIndex + 1
                    }}
                    for
                    {{
                      activeQueryResult.statementPreview ||
                      activeQueryResult.commandTag ||
                      'SQL statement'
                    }}
                  </caption>
                  <thead class="sticky top-0">
                    <tr
                      class="border-b border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900"
                    >
                      <th
                        v-for="col in activeQueryResult.columns"
                        :key="col"
                        scope="col"
                        class="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400"
                      >
                        {{ col }}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="(row, i) in activeQueryResult.rows"
                      :key="i"
                      class="border-b border-gray-100 hover:bg-gray-50 dark:border-gray-800/50 dark:hover:bg-gray-900/30"
                    >
                      <td
                        v-for="col in activeQueryResult.columns"
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
                v-else-if="
                  activeQueryResult.columns &&
                  activeQueryResult.columns.length > 0 &&
                  resultView === 'json'
                "
                class="flex-1 overflow-auto p-4"
              >
                <pre
                  class="font-mono text-xs text-gray-700 dark:text-gray-300"
                  v-html="highlightJSON(activeQueryResult.rows)"
                ></pre>
              </div>

              <!-- Command or error result -->
              <div v-else class="flex flex-1 items-start p-4 text-sm sm:p-6">
                <div class="flex min-w-0 items-start gap-3">
                  <DockResultStatusIcon
                    :status="activeQueryResult.status"
                    contained
                    class="mt-0.5"
                  />
                  <div class="min-w-0">
                    <p
                      :class="
                        activeQueryResult.status === 'error'
                          ? 'font-medium text-red-600 dark:text-red-400'
                          : 'font-medium text-green-700 dark:text-green-400'
                      "
                    >
                      {{
                        activeQueryResult.status === 'error'
                          ? 'Statement failed'
                          : 'Statement completed'
                      }}
                    </p>
                    <p
                      v-if="
                        activeQueryResult.message || activeQueryResult.error
                      "
                      :class="[
                        'mt-1 break-words text-xs leading-5',
                        activeQueryResult.status === 'error'
                          ? 'font-mono text-red-600 dark:text-red-400'
                          : 'text-gray-500 dark:text-gray-400'
                      ]"
                    >
                      {{ activeQueryResult.message || activeQueryResult.error }}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <!-- Bottom status bar -->
            <div
              class="flex items-center justify-between border-t border-gray-200 bg-gray-50 px-4 py-2 dark:border-gray-800 dark:bg-gray-900/50"
            >
              <div class="flex items-center gap-4">
                <!-- View toggle -->
                <div
                  v-if="
                    activeQueryResult.columns &&
                    activeQueryResult.columns.length > 0
                  "
                  class="flex overflow-hidden rounded-md border border-gray-300 dark:border-gray-700"
                >
                  <Tooltip text="Table view" position="top">
                    <button
                      @click="resultView = 'table'"
                      aria-label="Table view"
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
                      aria-label="JSON view"
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
                <span class="text-xs text-gray-500 dark:text-gray-400">
                  {{ queryResultCountLabel(activeQueryResult) }}
                  <template v-if="activeQueryResult.duration != null">
                    • {{ activeQueryResult.duration }}ms
                  </template>
                </span>
              </div>
              <!-- Actions -->
              <div
                v-if="
                  activeQueryResult.columns &&
                  activeQueryResult.columns.length > 0
                "
                class="flex items-center gap-1"
              >
                <Tooltip text="Re-run query" position="top">
                  <button
                    @click="executeQuery"
                    aria-label="Re-run query"
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
                    data-test="dock-copy-query-result"
                    :aria-label="
                      resultView === 'json' ? 'Copy as JSON' : 'Copy as CSV'
                    "
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
                <!-- Download dropdown -->
                <div class="relative inline-flex">
                  <Tooltip
                    :text="
                      resultView === 'json' ? 'Download JSON' : 'Download CSV'
                    "
                    position="top"
                  >
                    <button
                      @click="showExportMenu = !showExportMenu"
                      :aria-label="
                        resultView === 'json' ? 'Download JSON' : 'Download CSV'
                      "
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
                      @click="downloadQueryResultAsJSON"
                      class="block w-full px-3 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                    >
                      Download as JSON
                    </button>
                    <button
                      @click="downloadQueryResultAsCSV"
                      class="block w-full px-3 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                    >
                      Download as CSV
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Empty state -->
          <div
            v-else
            class="flex h-full items-center justify-center text-sm text-gray-500 dark:text-gray-400"
          >
            Run a query to see results
          </div>
        </div>
      </div>

      <!-- Tables / Collections Tab -->
      <div
        v-if="activeTab === 'tables' || activeTab === 'collections'"
        class="flex flex-1 overflow-hidden"
      >
        <!-- Table list sidebar -->
        <div
          class="w-64 flex-shrink-0 overflow-y-auto border-r border-gray-200 dark:border-gray-800"
        >
          <div
            class="p-3 text-xs font-medium uppercase text-gray-500 dark:text-gray-400"
          >
            {{ isMongoDB ? 'Collections' : 'Tables' }} ({{ tables.length }})
          </div>
          <div
            v-if="tablesLoading"
            class="flex items-center justify-center py-8"
          >
            <SlippyLoader class="text-gray-400 dark:text-gray-600" />
          </div>
          <div v-else>
            <button
              v-for="table in tables"
              :key="table.name"
              @click="browseTable(table.name)"
              :class="[
                'flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800/50',
                selectedTable === table.name
                  ? 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-white'
                  : 'text-gray-600 dark:text-gray-400'
              ]"
            >
              <span class="flex items-center gap-2">
                <svg
                  class="h-4 w-4 flex-shrink-0 text-gray-400 dark:text-gray-500"
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
                <span class="font-mono">{{ table.name }}</span>
              </span>
              <span class="text-xs text-gray-400 dark:text-gray-600">{{
                formatRowCount(table.rowCount)
              }}</span>
            </button>
          </div>
        </div>

        <!-- Table data -->
        <div class="flex-1 overflow-auto">
          <div
            v-if="!selectedTable"
            class="flex h-full items-center justify-center text-sm text-gray-500 dark:text-gray-400"
          >
            Select a {{ isMongoDB ? 'collection' : 'table' }} to browse data
          </div>
          <div
            v-else-if="tableDataLoading"
            class="flex h-full items-center justify-center"
          >
            <SlippyLoader
              size="h-6 w-6"
              class="text-gray-400 dark:text-gray-600"
            />
          </div>
          <div v-else-if="tableData" class="flex h-full flex-col">
            <div
              class="sticky top-0 z-10 border-b border-gray-200 bg-white px-4 py-2 dark:border-gray-800 dark:bg-gray-900"
            >
              <span class="font-mono text-sm text-gray-900 dark:text-white">{{
                selectedTable
              }}</span>
              <span class="ml-2 text-xs text-gray-500 dark:text-gray-400"
                >{{ tableData.pagination.total }}
                {{ isMongoDB ? 'documents' : 'rows' }}</span
              >
            </div>
            <div class="flex-1 overflow-x-auto">
              <table class="min-w-full">
                <thead>
                  <tr
                    class="border-b border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900/50"
                  >
                    <th
                      v-for="col in tableData.columns"
                      :key="col"
                      class="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400"
                    >
                      {{ col }}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="(row, i) in tableData.rows"
                    :key="i"
                    class="border-b border-gray-100 hover:bg-gray-50 dark:border-gray-800/50 dark:hover:bg-gray-900/30"
                  >
                    <td
                      v-for="col in tableData.columns"
                      :key="col"
                      class="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-700 dark:text-gray-300"
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
          </div>
        </div>
      </div>

      <!-- Schema Tab -->
      <div
        v-if="activeTab === 'schema'"
        class="flex-1 overflow-auto p-4 sm:p-6"
      >
        <div
          v-if="schemaLoading"
          class="flex items-center justify-center py-12"
        >
          <SlippyLoader
            size="h-6 w-6"
            class="text-gray-400 dark:text-gray-600"
          />
        </div>

        <div
          v-else-if="schemaError"
          class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-900/50 dark:bg-red-950/30"
        >
          <p class="text-sm text-red-600 dark:text-red-400">
            {{ schemaError }}
          </p>
        </div>

        <div v-else-if="schema" class="space-y-4">
          <!-- Filter dropdown -->
          <div class="pb-2">
            <div class="relative inline-block" data-schema-filter>
              <button
                @click.stop="schemaFilterOpen = !schemaFilterOpen"
                class="flex items-center gap-2 border-b border-dashed border-gray-300 bg-transparent px-1 py-1.5 text-sm text-gray-900 focus:border-gray-500 focus:outline-none dark:border-gray-600 dark:text-white dark:focus:border-gray-400"
              >
                <span
                  v-if="selectedSchemaTables.size === 0"
                  class="text-gray-400 dark:text-gray-500"
                  >All tables</span
                >
                <span v-else
                  >{{ selectedSchemaTables.size }} table{{
                    selectedSchemaTables.size > 1 ? 's' : ''
                  }}
                  selected</span
                >
                <svg
                  :class="[
                    'h-4 w-4 text-gray-400 transition-transform',
                    schemaFilterOpen ? 'rotate-180' : ''
                  ]"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>
              <!-- Dropdown -->
              <div
                v-if="schemaFilterOpen"
                @click.stop
                class="absolute left-0 top-full z-20 mt-1 max-h-64 w-56 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
              >
                <div
                  class="flex items-center justify-between border-b border-gray-100 px-3 py-1.5 dark:border-gray-800"
                >
                  <span
                    class="text-xs font-medium text-gray-500 dark:text-gray-400"
                    >Tables</span
                  >
                  <div class="flex gap-2">
                    <button
                      @click="selectAllSchemaTables"
                      class="text-xs text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                    >
                      All
                    </button>
                    <button
                      @click="clearSchemaTableSelection"
                      class="text-xs text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                    >
                      None
                    </button>
                  </div>
                </div>
                <label
                  v-for="tableName in allSchemaTableNames"
                  :key="tableName"
                  class="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <input
                    type="checkbox"
                    :checked="selectedSchemaTables.has(tableName)"
                    @change="toggleSchemaTable(tableName)"
                    class="h-3.5 w-3.5 rounded border-gray-300 text-gray-900 focus:ring-0 focus:ring-offset-0 dark:border-gray-600 dark:bg-gray-800"
                  />
                  <span
                    class="font-mono text-sm text-gray-700 dark:text-gray-300"
                    >{{ tableName }}</span
                  >
                </label>
              </div>
            </div>
          </div>

          <!-- Tables -->
          <div class="space-y-6">
            <div
              v-for="(table, tableName) in filteredSchemaTables"
              :key="tableName"
              class="rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900/30"
            >
              <div
                class="border-b border-gray-200 px-4 py-2 dark:border-gray-800"
              >
                <span
                  class="font-mono text-sm font-medium text-gray-900 dark:text-white"
                  >{{ tableName }}</span
                >
              </div>
              <table class="min-w-full">
                <thead>
                  <tr class="border-b border-gray-200 dark:border-gray-800">
                    <th
                      class="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400"
                    >
                      Column
                    </th>
                    <th
                      class="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400"
                    >
                      Type
                    </th>
                    <th
                      class="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400"
                    >
                      Nullable
                    </th>
                    <th
                      class="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400"
                    >
                      Default
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="col in table.columns"
                    :key="col.name"
                    class="border-b border-gray-100 dark:border-gray-800/50"
                  >
                    <td class="px-4 py-2">
                      <span
                        class="font-mono text-sm text-emerald-600 dark:text-green-400"
                        >{{ col.name }}</span
                      >
                      <span
                        v-if="col.primaryKey"
                        class="ml-2 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/50 dark:text-amber-400"
                        >PK</span
                      >
                    </td>
                    <td
                      class="px-4 py-2 font-mono text-sm text-gray-600 dark:text-gray-400"
                    >
                      {{ col.type
                      }}{{ col.maxLength ? `(${col.maxLength})` : '' }}
                    </td>
                    <td
                      class="px-4 py-2 text-sm text-gray-500 dark:text-gray-500"
                    >
                      {{ col.nullable ? 'YES' : 'NO' }}
                    </td>
                    <td
                      class="px-4 py-2 font-mono text-sm text-gray-500 dark:text-gray-500"
                    >
                      {{ col.defaultValue ?? '-' }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- Empty state when filter has no matches -->
          <div
            v-if="
              Object.keys(filteredSchemaTables).length === 0 &&
              selectedSchemaTables.size > 0
            "
            class="py-8 text-center text-sm text-gray-500 dark:text-gray-400"
          >
            Selected tables not found in schema
          </div>
        </div>
      </div>

      <!-- Migrate Tab -->
      <div
        v-if="activeTab === 'migrate'"
        class="flex-1 overflow-auto p-4 sm:p-6"
      >
        <div v-if="diffLoading" class="flex items-center justify-center py-12">
          <SlippyLoader
            size="h-6 w-6"
            class="text-gray-400 dark:text-gray-600"
          />
        </div>

        <div
          v-else-if="diffError"
          class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-900/50 dark:bg-red-950/30"
        >
          <p class="text-sm text-red-600 dark:text-red-400">{{ diffError }}</p>
          <button
            @click="fetchDiff"
            class="mt-2 text-sm text-red-600 underline hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
          >
            Try again
          </button>
        </div>

        <div v-else-if="diff" class="space-y-6">
          <div class="flex items-center justify-between">
            <div>
              <h3 class="text-sm font-medium text-gray-900 dark:text-white">
                {{ isMongoDB ? 'Collection Diff' : 'Schema Diff' }}
              </h3>
              <p class="text-xs text-gray-500 dark:text-gray-400">
                Comparing models with
                {{ isMongoDB ? 'collections' : 'database' }}
                <span
                  v-if="diff.modelsSource === 'static'"
                  class="text-gray-400 dark:text-gray-500"
                  >(from source files)</span
                >
                <span v-else class="text-gray-400 dark:text-gray-500"
                  >(from running app)</span
                >
              </p>
            </div>
            <button
              @click="fetchDiff"
              class="text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
            >
              Refresh
            </button>
          </div>

          <!-- No changes -->
          <div
            v-if="!diff.hasPendingChanges"
            class="rounded-lg border border-green-200 bg-green-50 px-6 py-8 text-center dark:border-green-900/50 dark:bg-green-950/30"
          >
            <svg
              class="mx-auto h-10 w-10 text-green-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <h3
              class="mt-4 text-sm font-medium text-green-700 dark:text-green-400"
            >
              {{
                isMongoDB
                  ? 'Collections are up to date'
                  : 'Schema is up to date'
              }}
            </h3>
            <p class="mt-1 text-sm text-green-600/70 dark:text-green-500/70">
              {{
                isMongoDB
                  ? 'All model collections exist.'
                  : 'Database matches your Waterline models.'
              }}
            </p>
          </div>

          <!-- Has changes -->
          <div v-else class="space-y-4">
            <!-- Model selection -->
            <div
              class="rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900/30"
            >
              <div
                class="flex items-center justify-between border-b border-gray-200 px-4 py-2 dark:border-gray-800"
              >
                <span
                  class="text-sm font-medium text-gray-900 dark:text-white"
                  >{{
                    isMongoDB ? 'Collections to create' : 'Models to migrate'
                  }}</span
                >
                <div class="flex items-center space-x-2">
                  <button
                    @click="selectAllModels"
                    class="text-xs text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                  >
                    Select all
                  </button>
                  <span class="text-gray-300 dark:text-gray-700">|</span>
                  <button
                    @click="deselectAllModels"
                    class="text-xs text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                  >
                    Deselect all
                  </button>
                </div>
              </div>
              <div class="flex flex-wrap gap-1.5 p-3">
                <label
                  v-for="model in diffModels"
                  :key="model"
                  class="flex cursor-pointer items-center rounded border px-2 py-0.5 text-xs transition-colors"
                  :class="
                    selectedModels.has(model)
                      ? 'border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900'
                      : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:border-gray-600'
                  "
                >
                  <input
                    type="checkbox"
                    :checked="selectedModels.has(model)"
                    @change="toggleModel(model)"
                    class="sr-only"
                  />
                  <span class="font-mono">{{ model }}</span>
                </label>
              </div>
            </div>

            <!-- Status -->
            <div
              v-if="filteredStatements.length > 0"
              class="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/50 dark:bg-amber-950/30"
            >
              <p class="text-sm text-amber-700 dark:text-amber-400">
                {{ filteredStatements.length }} change(s) for
                {{ selectedModels.size }} model(s)
              </p>
            </div>
            <div
              v-else
              class="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-800 dark:bg-gray-900/30"
            >
              <p class="text-sm text-gray-500 dark:text-gray-400">
                No models selected
              </p>
            </div>

            <!-- Migration SQL/Commands with syntax highlighting -->
            <div
              v-if="filteredStatements.length > 0"
              class="overflow-hidden rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900/50"
            >
              <div
                class="border-b border-gray-200 px-4 py-2 dark:border-gray-800"
              >
                <span
                  class="text-sm font-medium text-gray-900 dark:text-white"
                  >{{
                    isMongoDB ? 'Migration Commands' : 'Migration SQL'
                  }}</span
                >
              </div>
              <div class="divide-y divide-gray-200 dark:divide-gray-800">
                <pre
                  v-for="(stmt, i) in filteredStatements"
                  :key="i"
                  class="overflow-x-auto p-4 font-mono text-sm leading-6 text-gray-900 dark:text-gray-100"
                  v-html="highlightSQL(stmt.sql)"
                ></pre>
              </div>
            </div>

            <!-- Confirm migration modal -->
            <ConfirmModal
              :show="showMigrateConfirm"
              title="Apply Migration"
              :message="
                isMongoDB
                  ? `This will create ${filteredStatements.length} collection(s) in your database.`
                  : `This will execute ${filteredStatements.length} SQL statement(s) on your database.`
              "
              confirmLabel="Apply"
              @confirm="applyMigration"
              @cancel="showMigrateConfirm = false"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Bottom-right toolbar (migrate tab only, not for Redis) -->
    <div
      v-if="databaseService && !isRedis && activeTab === 'migrate'"
      class="fixed bottom-4 right-4 z-40"
      data-export-dropdown
    >
      <div
        class="flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-1 shadow-lg dark:border-gray-700 dark:bg-gray-800"
      >
        <!-- Apply migration button (migrate tab only) -->
        <button
          v-if="activeTab === 'migrate' && filteredStatements.length > 0"
          @click="confirmMigration"
          :disabled="migrateLoading"
          class="flex h-8 items-center rounded-md bg-gray-900 px-3 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
        >
          {{ migrateLoading ? 'Applying...' : 'Apply' }}
        </button>
        <!-- Export button -->
        <div class="relative">
          <Tooltip
            :text="exportLoading ? 'Exporting...' : 'Export'"
            position="top"
          >
            <button
              @click.stop="exportDropdownOpen = !exportDropdownOpen"
              :disabled="exportLoading"
              :class="[
                'flex h-8 w-8 items-center justify-center rounded-md transition-colors',
                exportDropdownOpen
                  ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-white',
                exportLoading ? 'opacity-50' : ''
              ]"
            >
              <SlippyLoader v-if="exportLoading" size="h-4 w-4" />
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
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                />
              </svg>
            </button>
          </Tooltip>
          <!-- Export dropdown -->
          <div
            v-if="exportDropdownOpen"
            class="absolute bottom-full right-0 z-50 mb-2 w-44 rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800"
          >
            <button
              @click="exportDatabase('full')"
              class="flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              <svg
                class="h-4 w-4 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.5"
                  d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"
                />
              </svg>
              Full backup
            </button>
            <button
              @click="exportDatabase('schema')"
              class="flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              <svg
                class="h-4 w-4 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.5"
                  d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7"
                />
              </svg>
              Schema only
            </button>
            <button
              @click="exportDatabase('data')"
              class="flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              <svg
                class="h-4 w-4 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.5"
                  d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7"
                />
              </svg>
              Data only
            </button>
          </div>
        </div>

        <!-- Import button -->
        <Tooltip text="Import" position="top">
          <button
            @click="openImportModalFromExportActions"
            class="flex h-8 w-8 items-center justify-center rounded-md text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-white"
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
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
              />
            </svg>
          </button>
        </Tooltip>
      </div>
    </div>

    <!-- Import SQL Modal -->
    <div
      v-if="showImportModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      @click.self="closeImportModal"
    >
      <div
        class="w-full max-w-2xl rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900"
      >
        <div
          class="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700"
        >
          <h3 class="text-sm font-medium text-gray-900 dark:text-white">
            Import
          </h3>
          <button
            @click="closeImportModal"
            class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <svg
              class="h-5 w-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
        <div class="p-4">
          <!-- Mode toggle -->
          <div class="mb-4 flex gap-2">
            <button
              @click="importMode = 'paste'"
              :class="[
                'rounded-md px-3 py-1.5 text-sm font-medium',
                importMode === 'paste'
                  ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                  : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
              ]"
            >
              Paste SQL
            </button>
            <button
              @click="importMode = 'upload'"
              :class="[
                'rounded-md px-3 py-1.5 text-sm font-medium',
                importMode === 'upload'
                  ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                  : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
              ]"
            >
              Upload File
            </button>
          </div>

          <!-- Paste mode -->
          <div v-if="importMode === 'paste'">
            <CodeEditor
              v-model="importSql"
              language="sql"
              placeholder="Paste your SQL statements here..."
              aria-label="SQL import"
              test-id="dock-import-editor"
              min-height="200px"
              max-height="400px"
              padding="compact"
            />
          </div>

          <!-- Upload mode -->
          <div v-else>
            <div
              class="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-200 bg-gray-50 px-6 py-10 dark:border-gray-700 dark:bg-gray-800"
            >
              <svg
                class="h-10 w-10 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.5"
                  d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
                {{ importFileLabel }}
              </p>
              <input
                type="file"
                :accept="importAccept"
                @change="handleFileUpload"
                class="mt-3 text-sm text-gray-500 file:mr-3 file:rounded-md file:border-0 file:bg-gray-900 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-gray-800 dark:file:bg-white dark:file:text-gray-900"
              />
            </div>
            <div v-if="isBinaryImport" class="mt-4">
              <div
                class="flex items-center gap-2 rounded-md bg-gray-50 px-3 py-2 dark:bg-gray-800"
              >
                <svg
                  class="h-4 w-4 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"
                  />
                </svg>
                <span class="text-sm text-gray-700 dark:text-gray-300">{{
                  importFile.name
                }}</span>
                <span class="text-xs text-gray-400"
                  >({{ formatBytes(importFile.size) }})</span
                >
              </div>
              <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Binary dump — will be restored with
                {{ isMongoDB ? 'mongorestore' : 'pg_restore' }}
              </p>
            </div>
            <div v-else-if="importSql" class="mt-4">
              <p
                class="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400"
              >
                Preview:
              </p>
              <pre
                class="max-h-48 overflow-auto p-3 font-mono text-xs leading-5"
                v-html="
                  highlightSQL(importSql.slice(0, 2000)) +
                  (importSql.length > 2000
                    ? '<span class=\'text-gray-400\'>...</span>'
                    : '')
                "
              ></pre>
            </div>
          </div>

          <!-- Info -->
          <p class="mt-3 text-xs text-gray-500 dark:text-gray-400">
            {{
              isBinaryImport
                ? `${formatBytes(importFile.size)} dump file`
                : importSql
                ? `${importSql.length.toLocaleString()} characters`
                : 'No data loaded'
            }}
          </p>
        </div>
        <div
          class="flex justify-end gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-700"
        >
          <button
            @click="closeImportModal"
            class="rounded-md px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >
            Cancel
          </button>
          <button
            @click="confirmImport"
            :disabled="(!importFile && !importSql.trim()) || importLoading"
            class="rounded-md bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
          >
            <span v-if="importLoading">Importing...</span>
            <span v-else>Import</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Import confirmation modal -->
    <ConfirmModal
      :show="showImportConfirm"
      title="Confirm Import"
      :message="
        isBinaryImport
          ? 'This will restore the dump file into your database, replacing existing data. Make sure you have a backup if needed.'
          : 'This will execute the SQL statements on your database. Make sure you have a backup if needed.'
      "
      confirmLabel="Import"
      :loading="importLoading"
      @confirm="executeImport"
      @cancel="showImportConfirm = false"
    />

    <!-- Toasts -->
    <ToastContainer :toasts="toasts" @dismiss="dismissToast" />
  </div>
</template>
