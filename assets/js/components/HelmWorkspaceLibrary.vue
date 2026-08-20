<script setup>
import Input from '@/components/ui/input/Input.vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ActionMenu from '@/components/ActionMenu.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import HelmSnippetDialog from '@/components/HelmSnippetDialog.vue'
import Spinner from '@/components/SlipwaySpinner.vue'
import Tooltip from '@/components/ui/tooltip/Tooltip.vue'
import ToastContainer from '@/components/ToastContainer.vue'

const props = defineProps({
  tab: {
    type: String,
    default: 'history',
    validator: (value) => ['history', 'snippets'].includes(value)
  },
  baseUrl: {
    type: String,
    required: true
  },
  csrf: {
    type: String,
    default: ''
  },
  currentSource: {
    type: String,
    default: ''
  }
})

const emit = defineEmits([
  'update:tab',
  'close',
  'load',
  'rerun',
  'insert',
  'snippet-saved'
])
const history = ref([])
const snippets = ref([])
const historyQuery = ref('')
const snippetQuery = ref('')
const historyLoading = ref(false)
const snippetsLoading = ref(false)
const requestError = ref('')
const retentionDays = ref(30)
const snippetDialog = ref({ show: false, snippet: null })
const snippetSaving = ref(false)
const confirm = ref({ show: false, type: '', item: null })
const confirmLoading = ref(false)
const toasts = ref([])
let historySearchTimer
let snippetSearchTimer
let toastId = 0

const activeQuery = computed({
  get: () =>
    props.tab === 'history' ? historyQuery.value : snippetQuery.value,
  set: (value) => {
    if (props.tab === 'history') historyQuery.value = value
    else snippetQuery.value = value
  }
})
const activeLoading = computed(() =>
  props.tab === 'history' ? historyLoading.value : snippetsLoading.value
)
const libraryTabs = computed(() => [
  {
    key: 'history',
    label: 'History',
    countLabel: `${history.value.length} ${
      history.value.length === 1 ? 'run' : 'runs'
    }`
  },
  {
    key: 'snippets',
    label: 'Snippets',
    countLabel: `${snippets.value.length} ${
      snippets.value.length === 1 ? 'snippet' : 'snippets'
    }`
  }
])
const hasCurrentSource = computed(() => Boolean(props.currentSource.trim()))
const clearableHistoryCount = computed(
  () => history.value.filter((entry) => !entry.pinned).length
)
const confirmDetails = computed(() => {
  if (confirm.value.type === 'clear-history') {
    return {
      title: 'Clear recent Helm history?',
      message:
        'Unpinned runs in this environment will be removed. Pinned runs and audit records stay intact.',
      label: 'Clear history'
    }
  }
  return {
    title: `Delete “${confirm.value.item?.name || 'snippet'}”?`,
    message:
      'This removes the saved snippet. It does not change anything already in the editor.',
    label: 'Delete snippet'
  }
})

onMounted(() => {
  refreshHistory()
  refreshSnippets()
})

onBeforeUnmount(() => {
  window.clearTimeout(historySearchTimer)
  window.clearTimeout(snippetSearchTimer)
})

watch(historyQuery, () => {
  window.clearTimeout(historySearchTimer)
  historySearchTimer = window.setTimeout(refreshHistory, 180)
})

watch(snippetQuery, () => {
  window.clearTimeout(snippetSearchTimer)
  snippetSearchTimer = window.setTimeout(refreshSnippets, 180)
})

async function api(path, options = {}) {
  const headers = {
    Accept: 'application/json',
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.method && options.method !== 'GET'
      ? { 'x-csrf-token': props.csrf }
      : {})
  }
  const response = await fetch(path, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
    cache: 'no-store'
  })
  const text = await response.text()
  let data = {}
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = { message: text }
    }
  }
  if (!response.ok) {
    throw new Error(
      data.message ||
        data.error ||
        text ||
        'The request could not be completed.'
    )
  }
  return data
}

async function refreshHistory() {
  historyLoading.value = true
  requestError.value = ''
  try {
    const query = historyQuery.value.trim()
    const data = await api(
      `${props.baseUrl}/history${
        query ? `?q=${encodeURIComponent(query)}` : ''
      }`
    )
    history.value = data.entries || []
    retentionDays.value = data.retentionDays || 30
  } catch (error) {
    requestError.value = error.message
  } finally {
    historyLoading.value = false
  }
}

async function refreshSnippets() {
  snippetsLoading.value = true
  requestError.value = ''
  try {
    const query = snippetQuery.value.trim()
    const data = await api(
      `${props.baseUrl}/snippets${
        query ? `?q=${encodeURIComponent(query)}` : ''
      }`
    )
    snippets.value = data.snippets || []
  } catch (error) {
    requestError.value = error.message
  } finally {
    snippetsLoading.value = false
  }
}

function historyActions(entry) {
  return [
    { key: 'load', label: 'Load in editor' },
    { key: 'rerun', label: 'Run again' },
    {
      key: 'pin',
      label: entry.pinned ? 'Unpin' : 'Pin'
    },
    { key: 'save', label: 'Save as snippet' },
    { key: 'delete', label: 'Delete', destructive: true }
  ]
}

function snippetActions(snippet) {
  const actions = [{ key: 'insert', label: 'Insert in editor' }]
  if (snippet.canManage) {
    actions.push(
      { key: 'edit', label: 'Edit' },
      { key: 'delete', label: 'Delete', destructive: true }
    )
  }
  return actions
}

async function handleHistoryAction(entry, action) {
  if (action.key === 'load') emit('load', entry.source)
  if (action.key === 'rerun') emit('rerun', entry.source)
  if (action.key === 'save') openSnippetDialog(entry.source)
  if (action.key === 'pin') await setPinned(entry, !entry.pinned)
  if (action.key === 'delete') await deleteHistoryEntry(entry)
}

function handleSnippetAction(snippet, action) {
  if (action.key === 'insert') emit('insert', snippet.source)
  if (action.key === 'edit') {
    requestError.value = ''
    snippetDialog.value = { show: true, snippet: { ...snippet } }
  }
  if (action.key === 'delete') {
    confirm.value = { show: true, type: 'delete-snippet', item: snippet }
  }
}

async function setPinned(entry, pinned) {
  requestError.value = ''
  try {
    await api(`${props.baseUrl}/history/${entry.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ pinned })
    })
    entry.pinned = pinned
    history.value = [...history.value].sort(
      (left, right) =>
        Number(right.pinned) - Number(left.pinned) ||
        right.executedAt - left.executedAt
    )
  } catch (error) {
    requestError.value = error.message
  }
}

async function deleteHistoryEntry(entry) {
  requestError.value = ''
  try {
    await api(`${props.baseUrl}/history/${entry.id}`, { method: 'DELETE' })
    history.value = history.value.filter((item) => item.id !== entry.id)
  } catch (error) {
    requestError.value = error.message
  }
}

function openSnippetDialog(source = props.currentSource) {
  if (!source?.trim()) return
  requestError.value = ''
  snippetDialog.value = {
    show: true,
    snippet: { name: '', source, scope: 'personal' }
  }
}

async function saveSnippet(values) {
  snippetSaving.value = true
  requestError.value = ''
  const existing = snippetDialog.value.snippet
  try {
    await api(
      existing?.id
        ? `${props.baseUrl}/snippets/${existing.id}`
        : `${props.baseUrl}/snippets`,
      {
        method: existing?.id ? 'PATCH' : 'POST',
        body: JSON.stringify(values)
      }
    )
    snippetDialog.value = { show: false, snippet: null }
    await refreshSnippets()
    emit('snippet-saved', values.source)
    notify(existing?.id ? 'Snippet updated' : 'Snippet saved')
  } catch (error) {
    requestError.value = error.message
  } finally {
    snippetSaving.value = false
  }
}

async function confirmDestructiveAction() {
  confirmLoading.value = true
  requestError.value = ''
  try {
    if (confirm.value.type === 'clear-history') {
      await api(`${props.baseUrl}/history`, {
        method: 'DELETE',
        body: JSON.stringify({ includePinned: false })
      })
      await refreshHistory()
      notify('Recent history cleared')
    } else {
      await api(`${props.baseUrl}/snippets/${confirm.value.item.id}`, {
        method: 'DELETE'
      })
      snippets.value = snippets.value.filter(
        (snippet) => snippet.id !== confirm.value.item.id
      )
      notify('Snippet deleted')
    }
    confirm.value = { show: false, type: '', item: null }
  } catch (error) {
    requestError.value = error.message
  } finally {
    confirmLoading.value = false
  }
}

function sourcePreview(source) {
  return (
    source
      .split('\n')
      .find((line) => line.trim() && !line.trim().startsWith('//'))
      ?.trim() || source.trim()
  )
}

function statusClass(status) {
  if (status === 'success') return 'bg-green-500'
  if (status === 'timeout') return 'bg-amber-500'
  if (status === 'cancelled') return 'bg-gray-400'
  return 'bg-red-500'
}

function formatDuration(durationMs) {
  if (durationMs < 1000) return `${durationMs}ms`
  return `${(durationMs / 1000).toFixed(durationMs < 10000 ? 1 : 0)}s`
}

function relativeTime(timestamp) {
  const seconds = Math.round((timestamp - Date.now()) / 1000)
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  if (Math.abs(seconds) < 60) return formatter.format(seconds, 'second')
  const minutes = Math.round(seconds / 60)
  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return formatter.format(hours, 'hour')
  return formatter.format(Math.round(hours / 24), 'day')
}

function notify(message, type = 'success') {
  const id = ++toastId
  toasts.value.push({ id, message, type })
  window.setTimeout(() => dismissToast(id), 3500)
}

function dismissToast(id) {
  toasts.value = toasts.value.filter((toast) => toast.id !== id)
}

function handleLibraryTabKeydown(event, index) {
  let nextIndex = index
  if (event.key === 'ArrowRight') {
    nextIndex = (index + 1) % libraryTabs.value.length
  } else if (event.key === 'ArrowLeft') {
    nextIndex =
      (index - 1 + libraryTabs.value.length) % libraryTabs.value.length
  } else if (event.key === 'Home') {
    nextIndex = 0
  } else if (event.key === 'End') {
    nextIndex = libraryTabs.value.length - 1
  } else {
    return
  }

  event.preventDefault()
  const nextTab = libraryTabs.value[nextIndex]
  emit('update:tab', nextTab.key)
  window.requestAnimationFrame(() => {
    document.getElementById(`helm-library-${nextTab.key}-tab`)?.focus()
  })
}

defineExpose({ refreshHistory, openSnippetDialog })
</script>

<template>
  <section
    data-test="helm-library"
    class="flex max-h-[17rem] min-h-0 shrink-0 flex-col border-t border-gray-100 bg-white dark:border-gray-800 dark:bg-gray-950"
  >
    <header class="flex shrink-0 items-center gap-2 px-3 py-2">
      <div
        class="flex shrink-0 items-center gap-0.5"
        role="tablist"
        aria-label="Helm library"
      >
        <Tooltip
          v-for="(item, index) in libraryTabs"
          :key="item.key"
          :text="`${item.label} · ${item.countLabel}`"
          placement="top"
        >
          <button
            :id="`helm-library-${item.key}-tab`"
            type="button"
            role="tab"
            aria-controls="helm-library-panel"
            :aria-label="`${item.label}, ${item.countLabel}`"
            :aria-selected="tab === item.key"
            :tabindex="tab === item.key ? 0 : -1"
            :data-test="`helm-library-${item.key}`"
            :class="[
              'flex h-7 w-7 items-center justify-center rounded-md outline-none transition-colors focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-400 motion-reduce:transition-none dark:focus-visible:ring-gray-600',
              tab === item.key
                ? 'bg-gray-200/80 text-gray-900 dark:bg-gray-800 dark:text-white'
                : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-300'
            ]"
            @click="emit('update:tab', item.key)"
            @keydown="handleLibraryTabKeydown($event, index)"
          >
            <svg
              v-if="item.key === 'history'"
              class="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.75"
                d="M12 8v4l2.5 1.5M3.5 12a8.5 8.5 0 1 0 2.1-5.6M3.5 4.5v4h4"
              />
            </svg>
            <svg
              v-else
              class="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.75"
                d="M6.5 4.5h11v15L12 16l-5.5 3.5v-15Z"
              />
            </svg>
            <span class="sr-only">{{ item.label }}</span>
          </button>
        </Tooltip>
      </div>

      <label class="relative min-w-0 flex-1">
        <span class="sr-only">Search {{ tab }}</span>
        <svg
          class="pointer-events-none absolute left-1 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="m21 21-4.35-4.35m2.35-5.65a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z"
          />
        </svg>
        <Input
          v-model="activeQuery"
          data-test="helm-library-search"
          type="search"
          :placeholder="`Search ${tab}`"
          class="focus:border-brand block w-full border-0 border-b border-dashed border-gray-200 bg-transparent py-1.5 pl-6 pr-1 text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-0 dark:border-gray-700 dark:text-white dark:placeholder:text-gray-500"
        />
      </label>

      <Tooltip
        v-if="tab === 'history' && clearableHistoryCount > 0"
        text="Clear recent history"
        placement="top"
      >
        <button
          type="button"
          data-test="helm-clear-history"
          aria-label="Clear recent history"
          class="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 dark:text-gray-500 dark:hover:bg-red-950/40 dark:hover:text-red-400 dark:focus-visible:ring-gray-700"
          @click="confirm = { show: true, type: 'clear-history', item: null }"
        >
          <svg
            class="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            stroke-width="1.75"
            aria-hidden="true"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M4.5 7.5h15M9 7.5V5.25h6V7.5m-8.25 0 .75 11.25h9l.75-11.25M10 11v4.5m4-4.5v4.5"
            />
          </svg>
        </button>
      </Tooltip>
      <button
        v-if="tab !== 'history'"
        type="button"
        data-test="helm-new-snippet"
        :disabled="!hasCurrentSource"
        class="disabled:opacity-35 rounded-md bg-gray-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
        @click="openSnippetDialog()"
      >
        Save current
      </button>

      <button
        type="button"
        aria-label="Close Helm library"
        class="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-200 dark:focus-visible:ring-gray-700"
        @click="emit('close')"
      >
        <svg
          class="h-4 w-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M6 18 18 6M6 6l12 12"
          />
        </svg>
      </button>
    </header>

    <div
      id="helm-library-panel"
      role="tabpanel"
      :aria-labelledby="`helm-library-${tab}-tab`"
      class="min-h-0 flex-1 overflow-y-auto"
    >
      <div
        v-if="activeLoading"
        role="status"
        class="flex h-24 items-center justify-center"
      >
        <Spinner class="h-4 w-4" />
        <span class="sr-only">
          {{ tab === 'history' ? 'Loading Helm history' : 'Loading snippets' }}
        </span>
      </div>

      <template v-else-if="tab === 'history'">
        <div
          v-if="history.length === 0"
          class="flex h-24 flex-col items-center justify-center px-4 text-center"
        >
          <p class="text-sm text-gray-500 dark:text-gray-400">
            {{ historyQuery ? 'No matching runs' : 'No Helm history yet' }}
          </p>
          <p
            v-if="!historyQuery"
            class="mt-1 text-xs text-gray-400 dark:text-gray-600"
          >
            Runs appear here without their returned data.
          </p>
        </div>
        <div v-else class="space-y-0.5 p-1">
          <div
            v-for="entry in history"
            :key="entry.id"
            data-test="helm-history-entry"
            class="group flex items-center gap-2 rounded-md px-2 py-2 hover:bg-gray-50 dark:hover:bg-gray-900/60"
          >
            <button
              type="button"
              class="flex min-w-0 flex-1 items-center gap-2 text-left"
              :title="entry.source"
              @click="emit('load', entry.source)"
            >
              <span
                data-test="helm-history-status"
                :class="[
                  'h-1.5 w-1.5 shrink-0 rounded-full',
                  statusClass(entry.status)
                ]"
              />
              <span class="min-w-0 flex-1">
                <span
                  class="block truncate font-mono text-xs text-gray-700 dark:text-gray-300"
                  >{{ sourcePreview(entry.source) }}</span
                >
                <span
                  class="mt-0.5 flex items-center gap-1.5 text-[11px] text-gray-400 dark:text-gray-600"
                >
                  <span :title="entry.targetLabel || entry.target">{{
                    entry.targetLabel || entry.target
                  }}</span>
                  <span aria-hidden="true">&middot;</span>
                  <span>{{ formatDuration(entry.durationMs) }}</span>
                  <span aria-hidden="true">&middot;</span>
                  <time
                    :datetime="new Date(entry.executedAt).toISOString()"
                    :title="new Date(entry.executedAt).toLocaleString()"
                    >{{ relativeTime(entry.executedAt) }}</time
                  >
                </span>
              </span>
              <svg
                v-if="entry.pinned"
                class="h-3.5 w-3.5 shrink-0 text-gray-400 dark:text-gray-500"
                fill="currentColor"
                viewBox="0 0 20 20"
                aria-label="Pinned"
              >
                <path
                  d="M7.3 2.4a1 1 0 0 1 .9-.6h3.6a1 1 0 0 1 .9.6l.8 1.8a1 1 0 0 1-.2 1.1l-1 1v3l1.4 1.4a1 1 0 0 1-.7 1.7h-2v4.1a1 1 0 0 1-2 0v-4.1H7a1 1 0 0 1-.7-1.7l1.4-1.4v-3l-1-1a1 1 0 0 1-.2-1.1l.8-1.8Z"
                />
              </svg>
            </button>
            <ActionMenu
              :items="historyActions(entry)"
              :test-id="`helm-history-actions-${entry.id}`"
              label="History actions"
              placement="top"
              @select="handleHistoryAction(entry, $event)"
            />
          </div>
        </div>
      </template>

      <template v-else>
        <div
          v-if="snippets.length === 0"
          class="flex h-24 flex-col items-center justify-center px-4 text-center"
        >
          <p class="text-sm text-gray-500 dark:text-gray-400">
            {{ snippetQuery ? 'No matching snippets' : 'No saved snippets' }}
          </p>
          <p
            v-if="!snippetQuery"
            class="mt-1 text-xs text-gray-400 dark:text-gray-600"
          >
            Save repeatable work, then insert it without running.
          </p>
        </div>
        <div v-else class="space-y-0.5 p-1">
          <div
            v-for="snippet in snippets"
            :key="snippet.id"
            data-test="helm-snippet-entry"
            class="group flex items-center gap-2 rounded-md px-2 py-2 hover:bg-gray-50 dark:hover:bg-gray-900/60"
          >
            <button
              type="button"
              class="min-w-0 flex-1 text-left"
              :title="snippet.source"
              @click="emit('insert', snippet.source)"
            >
              <span
                class="block truncate text-xs font-medium text-gray-800 dark:text-gray-200"
                >{{ snippet.name }}</span
              >
              <span
                class="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-gray-400 dark:text-gray-600"
              >
                <span>{{
                  snippet.scope === 'personal'
                    ? 'Personal'
                    : `Project · ${snippet.owner.name}`
                }}</span>
                <span aria-hidden="true">&middot;</span>
                <code class="truncate">{{
                  sourcePreview(snippet.source)
                }}</code>
              </span>
            </button>
            <ActionMenu
              :items="snippetActions(snippet)"
              :test-id="`helm-snippet-actions-${snippet.id}`"
              label="Snippet actions"
              placement="top"
              @select="handleSnippetAction(snippet, $event)"
            />
          </div>
        </div>
      </template>
    </div>

    <footer
      v-if="requestError || (tab === 'history' && history.length > 0)"
      class="shrink-0 px-3 py-1.5 text-[11px]"
    >
      <p v-if="requestError" class="text-red-600 dark:text-red-400">
        {{ requestError }}
      </p>
      <p v-else class="text-gray-400 dark:text-gray-600">
        Unpinned runs are kept for {{ retentionDays }} days. Results and logs
        are never saved.
      </p>
    </footer>
  </section>

  <HelmSnippetDialog
    :show="snippetDialog.show"
    :snippet="snippetDialog.snippet"
    :loading="snippetSaving"
    :error="requestError"
    @cancel="snippetDialog = { show: false, snippet: null }"
    @save="saveSnippet"
  />

  <ConfirmModal
    :show="confirm.show"
    :title="confirmDetails.title"
    :message="confirmDetails.message"
    :confirm-label="confirmDetails.label"
    destructive
    :loading="confirmLoading"
    @cancel="confirm = { show: false, type: '', item: null }"
    @confirm="confirmDestructiveAction"
  />

  <ToastContainer :toasts="toasts" @dismiss="dismissToast" />
</template>
