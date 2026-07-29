<script setup>
import { computed, ref, watch } from 'vue'
import ActionMenu from '@/components/ActionMenu.vue'
import HelmResultTreeNode from '@/components/HelmResultTreeNode.vue'
import SlippyLoader from '@/components/SlippyLoader.vue'
import ToastContainer from '@/components/ToastContainer.vue'
import Tooltip from '@/components/Tooltip.vue'
import { highlightJSON } from '@/lib/highlightJSON'
import {
  formatHelmError,
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
  }
})

const emit = defineEmits(['clear'])
const activeView = ref('raw')
const logsOpen = ref(false)
const toasts = ref([])
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
const errorText = computed(
  () =>
    props.error ||
    (props.result && !props.result.success
      ? formatHelmError(props.result.error)
      : '')
)
const logs = computed(() =>
  Array.isArray(props.result?.logs) ? props.result.logs : []
)
const metadata = computed(() => {
  if (!props.result) return []

  const items = []
  if (tableCompatible.value) {
    items.push(`${rows.value.length} row${rows.value.length === 1 ? '' : 's'}`)
  } else {
    items.push(props.result.success ? 'Success' : 'Error')
  }
  if (props.result.truncated) items.push('Truncated')
  if (Number.isFinite(props.result.durationMs)) {
    items.push(`${props.result.durationMs}ms`)
  }
  return items
})
const actionItems = computed(() => {
  const items = []
  if (props.result?.success) {
    items.push({ key: 'copy-json', label: 'Copy as JSON' })
    if (tableCompatible.value) {
      items.push({ key: 'export-csv', label: 'Export CSV' })
    }
  }
  if (props.clearable && (props.result || props.error)) {
    items.push({ key: 'clear', label: 'Clear result' })
  }
  return items
})

watch(
  () => props.result,
  () => {
    activeView.value = tableCompatible.value
      ? 'table'
      : structured.value
      ? 'tree'
      : 'raw'
    logsOpen.value = Boolean(
      logs.value.length && props.result?.success === false
    )
  },
  { immediate: true }
)

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
  if (item.key === 'clear') emit('clear')
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
</script>

<template>
  <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
    <div
      :data-test="`${testId}-output-scroll`"
      class="relative min-h-0 min-w-0 flex-1 overflow-auto bg-white dark:bg-gray-950"
    >
      <div
        v-if="loading"
        class="flex h-full items-center justify-center"
        aria-live="polite"
        aria-label="Running Helm"
      >
        <SlippyLoader size="h-4 w-4" />
      </div>

      <template v-else-if="result || errorText">
        <pre
          v-if="errorText"
          :data-test="`${testId}-error`"
          class="m-4 whitespace-pre-wrap rounded-md bg-red-50 px-3 py-2 font-mono text-sm leading-6 text-red-700 dark:bg-red-950/30 dark:text-red-400"
          >{{ errorText }}</pre
        >

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
      v-if="logs.length"
      :open="logsOpen"
      :data-test="`${testId}-logs`"
      class="shrink-0 border-t border-gray-200 bg-gray-50/70 dark:border-gray-800 dark:bg-gray-900/40"
      @toggle="logsOpen = $event.currentTarget.open"
    >
      <summary
        class="cursor-pointer px-4 py-2 text-xs font-medium text-gray-500 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-300 dark:text-gray-400 dark:focus-visible:ring-gray-700"
      >
        Console
        <span class="font-normal text-gray-400 dark:text-gray-600"
          >{{ logs.length }} line{{ logs.length === 1 ? '' : 's' }}</span
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
      class="min-h-10 flex shrink-0 items-center justify-between gap-3 border-t border-gray-200 bg-gray-50 px-3 py-1.5 dark:border-gray-800 dark:bg-gray-900/50"
    >
      <div class="flex min-w-0 items-center gap-3">
        <div
          v-if="views.length > 1"
          class="flex shrink-0 overflow-hidden rounded-md border border-gray-300 dark:border-gray-700"
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
                'flex h-7 w-8 items-center justify-center outline-none transition-colors focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-400 motion-reduce:transition-none dark:focus-visible:ring-gray-600',
                view !== views[0]
                  ? 'border-l border-gray-300 dark:border-gray-700'
                  : '',
                activeView === view
                  ? 'bg-gray-200 text-gray-900 dark:bg-gray-700 dark:text-white'
                  : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
              ]"
              @click="activeView = view"
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
          <template v-for="(item, index) in metadata" :key="item">
            <span
              :class="
                item === 'Truncated'
                  ? 'font-medium text-amber-600 dark:text-amber-400'
                  : ''
              "
              >{{ item }}</span
            >
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
