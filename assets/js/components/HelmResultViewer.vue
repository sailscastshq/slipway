<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import ActionMenu from '@/components/ActionMenu.vue'
import HelmResultTreeNode from '@/components/HelmResultTreeNode.vue'
import { Spinner } from '@/components/ui/spinner'
import ToastContainer from '@/components/ToastContainer.vue'
import Tooltip from '@/components/Tooltip.vue'
import { highlightJSON } from '@/lib/highlightJSON'
import {
  helmRowsToCsv,
  helmScalarPresentation,
  helmTableColumns,
  isHelmBranch,
  isHelmTableValue,
  rawHelmValue,
  serializeHelmValue
} from '@/lib/helmResult'

const props = defineProps({
  result: {
    type: Object,
    default: null
  },
  error: {
    type: String,
    default: ''
  },
  loading: Boolean,
  clearable: Boolean,
  emptyText: {
    type: String,
    default: 'Run JavaScript to see results'
  },
  testId: {
    type: String,
    default: 'helm'
  },
  target: {
    type: Object,
    default: null
  },
  view: {
    type: String,
    default: 'auto',
    validator: (value) => ['auto', 'raw', 'tree', 'table'].includes(value)
  }
})

const emit = defineEmits(['clear', 'update:view'])
const activeView = ref(props.view === 'auto' ? 'raw' : props.view)
const logsOpen = ref(false)
const queriesOpen = ref(false)
const toasts = ref([])
const runningDurationMs = ref(0)
let runningStartedAt = 0
let runningTimer
let toastId = 0

const value = computed(() => props.result?.value)
const tableCompatible = computed(
  () => props.result?.success && isHelmTableValue(value.value)
)
const columns = computed(() => helmTableColumns(value.value))
const rows = computed(() => (tableCompatible.value ? value.value : []))
const presentedRows = computed(() =>
  rows.value.map((row) =>
    columns.value.map((column) => ({
      column,
      ...helmScalarPresentation(row[column])
    }))
  )
)
const numericColumns = computed(
  () =>
    new Set(
      columns.value.filter((column, columnIndex) => {
        const populated = presentedRows.value
          .map((row) => row[columnIndex]?.type)
          .filter((type) => !['null', 'undefined'].includes(type))
        return (
          populated.length > 0 &&
          populated.every((type) => ['number', 'bigint'].includes(type))
        )
      })
    )
)
const structured = computed(
  () => props.result?.success && isHelmBranch(value.value)
)
const views = computed(() => {
  if (!props.result?.success) return []
  if (tableCompatible.value) return ['table', 'tree', 'raw']
  if (structured.value) return ['tree', 'raw']
  return ['raw']
})
const rawText = computed(() => rawHelmValue(value.value))
const rawHighlighted = computed(() =>
  structured.value ? highlightJSON(value.value) : ''
)
const treeEntries = computed(() =>
  structured.value ? Object.entries(value.value) : []
)
const structuredError = computed(() =>
  props.result && !props.result.success && props.result.error
    ? props.result.error
    : null
)
const errorText = computed(
  () =>
    props.error ||
    (structuredError.value
      ? ['cancelled', 'timeout'].includes(props.result?.status)
        ? structuredError.value.message || 'Execution stopped.'
        : `${structuredError.value.name || 'Error'}: ${
            structuredError.value.message || 'Execution failed'
          }`
      : '')
)
const errorLocation = computed(() => {
  const line = structuredError.value?.line
  const column = structuredError.value?.column
  if (!Number.isSafeInteger(line) || !Number.isSafeInteger(column)) return ''
  return `Line ${line}, column ${column}`
})
const errorStack = computed(() =>
  typeof structuredError.value?.stack === 'string'
    ? structuredError.value.stack
    : ''
)
const logs = computed(() =>
  Array.isArray(props.result?.logs) ? props.result.logs : []
)
const queryTrace = computed(() =>
  props.result?.queryTrace?.enabled ? props.result.queryTrace : null
)
const queryEntries = computed(() =>
  Array.isArray(queryTrace.value?.entries) ? queryTrace.value.entries : []
)
const queryDurationMs = computed(() =>
  queryEntries.value.reduce(
    (total, entry) =>
      total + (Number.isFinite(entry.durationMs) ? entry.durationMs : 0),
    0
  )
)
const metadata = computed(() => {
  if (!props.result) return []

  const status =
    props.result.status || (props.result.success ? 'success' : 'error')
  const labels = {
    cancelled: 'Cancelled',
    error: 'Error',
    success: 'Success',
    timeout: 'Timed out'
  }
  const items = [
    {
      label: labels[status] || labels.error,
      tone:
        status === 'success'
          ? 'success'
          : status === 'cancelled'
          ? 'neutral'
          : status === 'timeout'
          ? 'warning'
          : 'danger'
    }
  ]
  const rowCount = Number.isSafeInteger(props.result.rowCount)
    ? props.result.rowCount
    : tableCompatible.value
    ? rows.value.length
    : null
  if (rowCount !== null) {
    items.push({
      label: `${rowCount} row${rowCount === 1 ? '' : 's'}`
    })
  }
  const outputBytes = Number.isFinite(props.result.outputBytes)
    ? props.result.outputBytes
    : new TextEncoder().encode(String(props.result.output || '')).length
  items.push({ label: formatBytes(outputBytes) })
  if (props.result.truncated) {
    items.push({ label: 'Truncated', tone: 'warning' })
  }
  if (props.result.logsPartial) {
    items.push({ label: 'Partial console', tone: 'warning' })
  }
  if (Number.isFinite(props.result.durationMs)) {
    items.push({ label: formatDuration(props.result.durationMs) })
  }
  return items
})
const errorSummaryClasses = computed(() => {
  if (props.result?.status === 'cancelled') {
    return 'text-gray-700 dark:text-gray-300'
  }
  if (props.result?.status === 'timeout') {
    return 'text-amber-700 dark:text-amber-400'
  }
  return 'text-red-700 dark:text-red-400'
})
const actionItems = computed(() => {
  const items = []
  if (props.result?.success) {
    items.push({ key: 'copy-json', label: 'Copy as JSON' })
    if (tableCompatible.value) {
      items.push({ key: 'export-csv', label: 'Export CSV' })
    }
  }
  if (props.result) {
    items.push({ key: 'copy-diagnostics', label: 'Copy diagnostics' })
  }
  if (props.clearable && (props.result || props.error)) {
    items.push({ key: 'clear', label: 'Clear result' })
  }
  return items
})

watch(
  () => props.result,
  () => {
    activeView.value = preferredView()
    logsOpen.value = Boolean(
      logs.value.length && props.result?.success === false
    )
    queriesOpen.value = Boolean(queryTrace.value)
  },
  { immediate: true }
)

watch(
  () => props.view,
  () => {
    activeView.value = preferredView()
  }
)

watch(
  () => props.loading,
  (loading) => {
    clearInterval(runningTimer)
    runningTimer = null

    if (!loading) return
    runningStartedAt = performance.now()
    runningDurationMs.value = 0
    runningTimer = setInterval(() => {
      runningDurationMs.value = Math.round(performance.now() - runningStartedAt)
    }, 100)
  },
  { immediate: true }
)

onBeforeUnmount(() => clearInterval(runningTimer))

function formatDuration(durationMs) {
  if (durationMs < 1000) return `${Math.max(0, Math.round(durationMs))}ms`
  return `${(durationMs / 1000).toFixed(durationMs < 10000 ? 1 : 0)}s`
}

function selectView(view) {
  activeView.value = view
  emit('update:view', view)
}

function preferredView() {
  if (views.value.includes(props.view)) return props.view
  if (tableCompatible.value) return 'table'
  if (structured.value) return 'tree'
  return 'raw'
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function metadataClasses(tone) {
  return {
    danger: 'font-medium text-red-600 dark:text-red-400',
    neutral: 'font-medium text-gray-600 dark:text-gray-300',
    success: 'font-medium text-green-600 dark:text-green-400',
    warning: 'font-medium text-amber-600 dark:text-amber-400'
  }[tone]
}

function scalarClasses(type) {
  return {
    boolean: 'text-blue-600 dark:text-blue-400',
    date: 'text-cyan-600 dark:text-cyan-400',
    number: 'text-purple-600 dark:text-purple-400',
    bigint: 'text-purple-600 dark:text-purple-400',
    null: 'italic text-gray-400 dark:text-gray-600',
    string: 'text-gray-700 dark:text-gray-300',
    undefined: 'italic text-gray-400 dark:text-gray-600'
  }[type]
}

async function handleAction(item) {
  if (item.key === 'copy-json') {
    await navigator.clipboard.writeText(serializeHelmValue(value.value))
    notify('Copied JSON to clipboard')
    return
  }
  if (item.key === 'export-csv') {
    downloadCsv()
    notify('Exported helm-result.csv')
    return
  }
  if (item.key === 'copy-diagnostics') {
    await navigator.clipboard.writeText(
      JSON.stringify(buildDiagnostics(), null, 2)
    )
    notify('Copied diagnostics to clipboard')
    return
  }
  if (item.key === 'clear') emit('clear')
}

function buildDiagnostics() {
  return {
    target: props.target,
    execution: {
      status:
        props.result?.status || (props.result?.success ? 'success' : 'error'),
      durationMs: props.result?.durationMs ?? null,
      outputBytes: Number.isFinite(props.result?.outputBytes)
        ? props.result.outputBytes
        : new TextEncoder().encode(String(props.result?.output || '')).length,
      rowCount: Number.isSafeInteger(props.result?.rowCount)
        ? props.result.rowCount
        : null,
      truncated: Boolean(props.result?.truncated),
      logsPartial: Boolean(props.result?.logsPartial),
      queryTrace: queryTrace.value
        ? {
            count: queryEntries.value.length,
            omittedCount: queryTrace.value.omittedCount || 0,
            truncated: Boolean(queryTrace.value.truncated)
          }
        : null,
      error: props.result?.error
        ? {
            name: props.result.error.name || 'Error',
            message: props.result.error.message || 'Execution failed',
            line: props.result.error.line || null,
            column: props.result.error.column || null,
            code: props.result.error.code || null
          }
        : null
    }
  }
}

function downloadCsv() {
  const csv = helmRowsToCsv(rows.value, columns.value)
  const blob = new Blob([`\uFEFF${csv}`], {
    type: 'text/csv;charset=utf-8'
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'helm-result.csv'
  link.click()
  URL.revokeObjectURL(url)
}

function notify(message) {
  const id = ++toastId
  toasts.value.push({ id, message, type: 'success' })
  setTimeout(() => dismissToast(id), 3500)
}

function dismissToast(id) {
  toasts.value = toasts.value.filter((toast) => toast.id !== id)
}

function queryLabel(entry) {
  return entry.kind === 'native'
    ? `${entry.datastore}.sendNativeQuery`
    : `${entry.model}.${entry.method}`
}

function queryDetail(entry) {
  if (entry.kind === 'native') return entry.statement
  return entry.criteria ? JSON.stringify(entry.criteria) : 'No criteria'
}
</script>

<template>
  <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
    <div
      :data-test="`${testId}-output-scroll`"
      class="relative min-h-0 min-w-0 flex-1 overflow-auto bg-white dark:bg-gray-950"
    >
      <div
        v-if="loading"
        class="flex h-full items-center justify-center gap-2 text-sm text-gray-500 dark:text-gray-400"
        aria-live="polite"
        aria-label="Running Helm"
      >
        <Spinner class="h-4 w-4" />
        <span :data-test="`${testId}-running-status`"
          >Running &middot; {{ formatDuration(runningDurationMs) }}</span
        >
      </div>

      <template v-else-if="result || errorText">
        <div
          v-if="errorText"
          :data-test="`${testId}-error`"
          class="px-4 py-3"
          :role="result?.status === 'cancelled' ? 'status' : 'alert'"
        >
          <p
            :data-test="`${testId}-error-summary`"
            :class="['text-sm font-medium leading-5', errorSummaryClasses]"
          >
            {{ errorText }}
          </p>
          <p
            v-if="errorLocation"
            :data-test="`${testId}-error-location`"
            class="mt-1 font-mono text-xs text-gray-500 dark:text-gray-400"
          >
            {{ errorLocation }}
          </p>
          <details
            v-if="errorStack"
            :data-test="`${testId}-error-stack`"
            class="mt-3 text-xs"
          >
            <summary
              class="w-fit cursor-pointer text-gray-500 outline-none hover:text-gray-700 focus-visible:ring-2 focus-visible:ring-gray-300 dark:text-gray-400 dark:hover:text-gray-200 dark:focus-visible:ring-gray-700"
            >
              Stack trace
            </summary>
            <pre
              :data-test="`${testId}-error-stack-content`"
              class="mt-2 max-h-52 overflow-auto whitespace-pre-wrap font-mono leading-5 text-gray-600 dark:text-gray-400"
              >{{ errorStack }}</pre
            >
          </details>
        </div>

        <div
          v-else-if="activeView === 'table'"
          :data-test="`${testId}-output`"
          class="min-w-max"
        >
          <table
            :data-test="`${testId}-result-table`"
            class="min-w-full font-mono text-sm"
          >
            <caption class="sr-only">
              Helm returned records
            </caption>
            <thead class="sticky top-0 z-10">
              <tr
                class="border-b border-gray-200 bg-gray-50/95 dark:border-gray-800 dark:bg-gray-900/95"
              >
                <th
                  v-for="column in columns"
                  :key="column"
                  scope="col"
                  :class="[
                    'whitespace-nowrap px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400',
                    numericColumns.has(column) ? 'text-right' : 'text-left'
                  ]"
                >
                  {{ column }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(row, rowIndex) in presentedRows"
                :key="rowIndex"
                class="border-b border-gray-100 last:border-b-0 hover:bg-gray-50/70 dark:border-gray-900 dark:hover:bg-gray-900/40"
              >
                <td
                  v-for="cell in row"
                  :key="cell.column"
                  :class="[
                    'max-w-96 whitespace-nowrap px-4 py-2',
                    scalarClasses(cell.type),
                    ['number', 'bigint'].includes(cell.type)
                      ? 'text-right tabular-nums'
                      : ''
                  ]"
                >
                  <time
                    v-if="cell.datetime"
                    :datetime="cell.datetime"
                    :title="cell.title"
                    class="block truncate"
                    >{{ cell.text }}</time
                  >
                  <span v-else :title="cell.title" class="block truncate">{{
                    cell.text
                  }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div
          v-else-if="activeView === 'tree'"
          :data-test="`${testId}-output`"
          class="p-4"
        >
          <ul :data-test="`${testId}-result-tree`" class="min-w-max space-y-0">
            <HelmResultTreeNode
              v-for="([key, entryValue], index) in treeEntries"
              :key="`${key}-${index}`"
              :name="key"
              :value="entryValue"
            />
          </ul>
          <code
            v-if="treeEntries.length === 0"
            class="font-mono text-xs text-gray-500 dark:text-gray-400"
            >{{ Array.isArray(value) ? '[]' : '{}' }}</code
          >
        </div>

        <div v-else :data-test="`${testId}-output`" class="p-4">
          <pre
            v-if="structured"
            :data-test="`${testId}-result-raw`"
            class="whitespace-pre-wrap font-mono text-xs leading-5 text-gray-700 dark:text-gray-300"
            v-html="rawHighlighted"
          ></pre>
          <pre
            v-else
            :data-test="`${testId}-result-raw`"
            class="whitespace-pre-wrap font-mono text-sm leading-6 text-gray-700 dark:text-gray-300"
            >{{ rawText }}</pre
          >
        </div>
      </template>

      <div
        v-else
        class="flex h-full items-center justify-center px-4 text-center text-sm text-gray-500 dark:text-gray-400"
      >
        {{ emptyText }}
      </div>
    </div>

    <details
      v-if="queryTrace"
      :open="queriesOpen"
      :data-test="`${testId}-queries`"
      class="group shrink-0 bg-gray-50/70 dark:bg-gray-900/40"
      @toggle="queriesOpen = $event.currentTarget.open"
    >
      <summary
        class="flex cursor-pointer list-none items-center gap-2 px-4 py-2 text-xs font-medium text-gray-500 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-300 dark:text-gray-400 dark:focus-visible:ring-gray-700"
      >
        <svg
          class="h-3.5 w-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="1.5"
          aria-hidden="true"
        >
          <ellipse cx="12" cy="5" rx="7.5" ry="2.75" />
          <path
            stroke-linecap="round"
            d="M4.5 5v7c0 1.52 3.36 2.75 7.5 2.75s7.5-1.23 7.5-2.75V5m-15 7v7c0 1.52 3.36 2.75 7.5 2.75s7.5-1.23 7.5-2.75v-7"
          />
        </svg>
        <span>Queries</span>
        <span class="font-normal text-gray-400 dark:text-gray-600">
          {{ queryEntries.length
          }}{{
            queryTrace.omittedCount
              ? ` + ${queryTrace.omittedCount} omitted`
              : ''
          }}
          &middot; {{ formatDuration(queryDurationMs) }}
          {{ queryTrace.truncated ? ' · truncated' : '' }}
        </span>
        <svg
          class="ml-auto h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="1.5"
          aria-hidden="true"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="m6 9 6 6 6-6"
          />
        </svg>
      </summary>
      <ol
        v-if="queryEntries.length"
        :data-test="`${testId}-query-list`"
        class="max-h-56 space-y-3 overflow-auto px-4 pb-3"
      >
        <li
          v-for="(entry, index) in queryEntries"
          :key="`${entry.kind}-${entry.model || entry.datastore}-${
            entry.method
          }-${index}`"
          class="min-w-0"
        >
          <div class="flex min-w-0 items-center justify-between gap-4">
            <code
              class="truncate font-mono text-xs font-medium text-gray-700 dark:text-gray-300"
              >{{ queryLabel(entry) }}</code
            >
            <span
              :class="[
                'shrink-0 text-xs tabular-nums',
                entry.status === 'error'
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-gray-400 dark:text-gray-600'
              ]"
            >
              {{ entry.status === 'error' ? 'Error · ' : ''
              }}{{ formatDuration(entry.durationMs) }}
            </span>
          </div>
          <code
            :title="queryDetail(entry)"
            class="mt-0.5 block truncate font-mono text-[0.6875rem] leading-4 text-gray-400 dark:text-gray-600"
            >{{ queryDetail(entry) }}</code
          >
        </li>
      </ol>
      <p
        v-else
        :data-test="`${testId}-query-empty`"
        class="px-4 pb-3 text-xs text-gray-400 dark:text-gray-600"
      >
        No Waterline or native queries ran.
      </p>
    </details>

    <details
      v-if="logs.length"
      :open="logsOpen"
      :data-test="`${testId}-logs`"
      class="group shrink-0 bg-gray-50/70 dark:bg-gray-900/40"
      @toggle="logsOpen = $event.currentTarget.open"
    >
      <summary
        class="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium text-gray-500 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-300 dark:text-gray-400 dark:focus-visible:ring-gray-700"
      >
        <svg
          class="h-3 w-3 shrink-0 -rotate-90 transition-transform group-open:rotate-0 motion-reduce:transition-none"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="1.75"
          aria-hidden="true"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="m6 9 6 6 6-6"
          />
        </svg>
        <span>Console</span>
        <span class="font-normal text-gray-400 dark:text-gray-600"
          >{{ logs.length }} line{{ logs.length === 1 ? '' : 's'
          }}{{ result?.logsPartial ? ' · partial' : '' }}</span
        >
      </summary>
      <pre
        class="max-h-40 overflow-auto whitespace-pre-wrap px-4 pb-3 font-mono text-xs leading-5 text-gray-600 dark:text-gray-400"
        >{{ logs.join('\n') }}</pre
      >
    </details>

    <footer
      v-if="result"
      :data-test="`${testId}-result-status`"
      class="min-h-10 flex shrink-0 items-center justify-between gap-3 bg-gray-50/70 px-3 py-1.5 dark:bg-gray-900/40"
    >
      <div class="flex min-w-0 items-center gap-2">
        <div
          v-if="views.length > 1"
          class="flex shrink-0 items-center gap-0.5"
          role="group"
          aria-label="Result view"
        >
          <Tooltip
            v-for="view in views"
            :key="view"
            :text="`${view[0].toUpperCase()}${view.slice(1)} view`"
            position="top"
          >
            <button
              type="button"
              :data-test="`${testId}-view-${view}`"
              :aria-label="`${view[0].toUpperCase()}${view.slice(1)} view`"
              :aria-pressed="activeView === view"
              :class="[
                'flex h-7 w-7 items-center justify-center rounded-md outline-none transition-colors focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-400 motion-reduce:transition-none dark:focus-visible:ring-gray-600',
                activeView === view
                  ? 'bg-gray-200/80 text-gray-900 dark:bg-gray-800 dark:text-white'
                  : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-300'
              ]"
              @click="selectView(view)"
            >
              <svg
                v-if="view === 'table'"
                class="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="1.5"
                aria-hidden="true"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M3.75 5.25h16.5v13.5H3.75V5.25Zm0 4.5h16.5M9 5.25v13.5"
                />
              </svg>
              <svg
                v-else-if="view === 'tree'"
                class="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="1.5"
                aria-hidden="true"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M5.25 4.5v15m0-10.5h3.5m-3.5 6h3.5M8.75 7.5h10v3h-10v-3Zm0 6h10v3h-10v-3Z"
                />
              </svg>
              <span
                v-else
                class="font-mono text-xs font-bold leading-none"
                aria-hidden="true"
                >{}</span
              >
            </button>
          </Tooltip>
        </div>

        <p
          class="truncate text-xs text-gray-500 dark:text-gray-400"
          aria-live="polite"
        >
          <template
            v-for="(item, index) in metadata"
            :key="`${item.label}-${index}`"
          >
            <span :class="metadataClasses(item.tone)">{{ item.label }}</span>
            <span
              v-if="index < metadata.length - 1"
              aria-hidden="true"
              class="mx-1 text-gray-300 dark:text-gray-700"
              >&middot;</span
            >
          </template>
        </p>
      </div>

      <ActionMenu
        v-if="actionItems.length"
        :items="actionItems"
        :test-id="`${testId}-result-actions`"
        label="Result actions"
        placement="top"
        @select="handleAction"
      />
    </footer>

    <ToastContainer :toasts="toasts" @dismiss="dismissToast" />
  </div>
</template>
