<script setup>
import { Head, Link, router } from '@inertiajs/vue3'
import { computed, inject, onBeforeUnmount, ref, watch } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'
import Pagination from '@/components/ui/pagination/Pagination.vue'
import Select from '@/components/ui/select/Select.vue'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  logs: {
    type: Array,
    default: () => []
  },
  pagination: Object,
  filters: {
    type: Object,
    default: () => ({ q: '', group: 'all' })
  },
  helmAuditRetentionDays: {
    type: Number,
    default: 90
  }
})

const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')
const query = ref(props.filters.q || '')
const group = ref(props.filters.group || 'all')
let searchTimer

const actionLabels = {
  'deployment.triggered': 'Triggered deployment',
  'backup.created': 'Created backup',
  'service.created': 'Created service',
  'service.destroyed': 'Destroyed service',
  'environment.updated': 'Updated environment',
  'project.destroyed': 'Destroyed project',
  'cleanup.started': 'Started cleanup',
  'cleanup.stage.completed': 'Completed cleanup stage',
  'cleanup.stage.failed': 'Cleanup stage failed',
  'cleanup.completed': 'Completed cleanup',
  'settings.updated': 'Updated settings',
  'helm.executed': 'Ran Helm',
  'helm.execution.blocked': 'Blocked Helm write',
  'helm.writes.armed': 'Armed Helm writes',
  'helm.history.cleared': 'Cleared Helm history',
  'helm.snippet.created': 'Created Helm snippet'
}

const resultRange = computed(() => {
  if (!props.pagination.totalCount) return null
  return {
    first: (props.pagination.page - 1) * props.pagination.perPage + 1,
    last: Math.min(
      props.pagination.page * props.pagination.perPage,
      props.pagination.totalCount
    )
  }
})

watch([query, group], ([, nextGroup], [, previousGroup]) => {
  window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(
    () => refreshLogs(),
    nextGroup !== previousGroup ? 0 : 220
  )
})

onBeforeUnmount(() => window.clearTimeout(searchTimer))

function refreshLogs() {
  router.get(
    '/settings/audit-log',
    {
      q: query.value.trim() || undefined,
      group: group.value === 'all' ? undefined : group.value
    },
    {
      preserveState: true,
      preserveScroll: true,
      replace: true,
      only: ['logs', 'pagination', 'filters', 'helmAuditRetentionDays']
    }
  )
}

function actionLabel(action) {
  return actionLabels[action] || action
}

function eventTone(action) {
  if (action.includes('blocked') || action.includes('failed')) return 'danger'
  if (action === 'helm.writes.armed') return 'warning'
  if (action.includes('completed') || action === 'helm.executed')
    return 'success'
  return 'neutral'
}

function dotClass(action) {
  return {
    danger: 'bg-red-500',
    warning: 'bg-amber-500',
    success: 'bg-green-500',
    neutral: 'bg-gray-400'
  }[eventTone(action)]
}

function formatTime(date) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(date))
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

function targetLabel(log) {
  const details = log.details || {}
  if (details.project && details.environment && details.app) {
    return `${details.project.slug} / ${details.environment.slug} / ${details.app.slug}`
  }
  if (details.name) return details.name
  return `${log.resourceType}${log.resourceId ? ` · ${log.resourceId}` : ''}`
}

function formatDuration(durationMs) {
  if (!Number.isFinite(durationMs)) return null
  if (durationMs < 1000) return `${Math.max(0, durationMs)}ms`
  return `${(durationMs / 1000).toFixed(durationMs < 10000 ? 1 : 0)}s`
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return null
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function shortHash(hash) {
  return hash ? `${hash.slice(0, 12)}…` : null
}
</script>

<template>
  <Head title="Audit Log | Slipway" />
  <div class="flex h-full flex-col">
    <header
      class="flex items-center justify-between border-b border-gray-200 py-4 pl-4 pr-4 dark:border-gray-800 sm:pl-4 sm:pr-8"
    >
      <div class="flex items-center space-x-3">
        <button
          type="button"
          aria-label="Open navigation"
          class="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white md:hidden"
          @click="toggleMobileMenu"
        >
          <svg
            class="h-5 w-5"
            viewBox="-0.5 -0.5 16 16"
            fill="none"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              d="M12.777 14.285H2.223c-.833 0-1.508-.675-1.508-1.508V2.223c0-.833.675-1.508 1.508-1.508h10.554c.833 0 1.508.675 1.508 1.508v10.554c0 .833-.675 1.508-1.508 1.508Z"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <path d="M5.615 14.285V.715" stroke-linecap="round" />
            <path
              d="M2.6 5.992 3.919 7.5 2.6 9.008"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
        <button
          type="button"
          aria-label="Toggle sidebar"
          class="hidden text-gray-400 dark:text-gray-500 md:block"
          @click="toggleSidebar"
        >
          <svg
            class="h-5 w-5"
            viewBox="-0.5 -0.5 16 16"
            fill="none"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              d="M12.777 14.285H2.223c-.833 0-1.508-.675-1.508-1.508V2.223c0-.833.675-1.508 1.508-1.508h10.554c.833 0 1.508.675 1.508 1.508v10.554c0 .833-.675 1.508-1.508 1.508Z"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <path d="M5.615 14.285V.715" stroke-linecap="round" />
            <path
              :d="
                sidebarCollapsed
                  ? 'M2.6 5.992 3.919 7.5 2.6 9.008'
                  : 'M3.919 5.992 2.6 7.5l1.319 1.508'
              "
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
        <nav class="flex items-center space-x-2 text-sm">
          <Link
            href="/settings"
            class="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
            >settings</Link
          >
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <span class="font-medium text-gray-900 dark:text-white"
            >audit log</span
          >
        </nav>
      </div>
    </header>

    <main class="flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
      <div class="mx-auto max-w-5xl">
        <div
          class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"
        >
          <div>
            <h1 class="text-xl font-semibold text-gray-950 dark:text-white">
              Audit log
            </h1>
            <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Operational events visible to team owners and admins.
            </p>
          </div>

          <div class="flex items-center gap-2">
            <label class="relative min-w-0 flex-1 sm:w-64">
              <span class="sr-only">Search audit events</span>
              <svg
                class="pointer-events-none absolute left-1 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.75"
                  d="m21 21-4.35-4.35m2.35-5.65a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z"
                />
              </svg>
              <input
                v-model="query"
                data-test="audit-search"
                type="search"
                autocomplete="off"
                placeholder="Search events or people"
                class="focus:border-brand min-h-10 w-full border-0 border-b border-dashed border-gray-200 bg-transparent py-2 pl-7 pr-1 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-0 dark:border-gray-700 dark:text-white dark:placeholder:text-gray-500"
              />
            </label>
            <label>
              <span class="sr-only">Filter audit events</span>
              <Select
                v-model="group"
                :options="[
                  { value: 'all', label: 'All events' },
                  { value: 'helm', label: 'Helm' }
                ]"
                data-test="audit-group"
                class="rounded-md border-0 bg-gray-50 py-2 pl-3 pr-8 text-sm text-gray-700 outline-none ring-1 ring-inset ring-gray-200 focus:ring-gray-400 dark:bg-gray-900 dark:text-gray-300 dark:ring-gray-800 dark:focus:ring-gray-600"
              />
            </label>
          </div>
        </div>

        <div
          v-if="logs.length === 0"
          data-test="audit-empty"
          class="min-h-56 flex flex-col items-center justify-center text-center"
        >
          <p class="text-sm font-medium text-gray-700 dark:text-gray-300">
            {{ query ? 'No matching events' : 'No audit events yet' }}
          </p>
          <p class="mt-1 text-xs text-gray-400 dark:text-gray-600">
            {{
              query
                ? 'Try a person, action, resource, or IP address.'
                : 'Important team activity will appear here.'
            }}
          </p>
        </div>

        <ol v-else data-test="audit-events" class="mt-6">
          <li
            v-for="log in logs"
            :key="log.id"
            data-test="audit-event"
            class="group border-b border-gray-100 py-3.5 last:border-b-0 dark:border-gray-900"
          >
            <details>
              <summary
                class="flex cursor-pointer list-none items-start gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-gray-300 dark:focus-visible:ring-gray-700 [&::-webkit-details-marker]:hidden"
              >
                <span
                  :class="[
                    'mt-2 h-1.5 w-1.5 shrink-0 rounded-full',
                    dotClass(log.action)
                  ]"
                  aria-hidden="true"
                />
                <span class="min-w-0 flex-1">
                  <span class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span
                      class="text-sm font-medium text-gray-800 dark:text-gray-200"
                      >{{ actionLabel(log.action) }}</span
                    >
                    <span
                      class="truncate font-mono text-xs text-gray-400 dark:text-gray-600"
                      >{{ targetLabel(log) }}</span
                    >
                  </span>
                  <span
                    class="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-gray-400 dark:text-gray-600"
                  >
                    <span>{{ log.userName }}</span>
                    <span aria-hidden="true">&middot;</span>
                    <time
                      :datetime="new Date(log.createdAt).toISOString()"
                      :title="formatTime(log.createdAt)"
                      >{{ relativeTime(log.createdAt) }}</time
                    >
                    <template v-if="log.details?.status">
                      <span aria-hidden="true">&middot;</span>
                      <span>{{ log.details.status }}</span>
                    </template>
                    <template v-if="formatDuration(log.details?.durationMs)">
                      <span aria-hidden="true">&middot;</span>
                      <span>{{ formatDuration(log.details.durationMs) }}</span>
                    </template>
                  </span>
                </span>
                <svg
                  class="mt-1.5 h-4 w-4 shrink-0 text-gray-300 transition-transform group-open:rotate-180 motion-reduce:transition-none dark:text-gray-700"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  stroke-width="1.75"
                  aria-hidden="true"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="m8 10 4 4 4-4"
                  />
                </svg>
              </summary>

              <dl
                class="ml-4 mt-3 grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-2 rounded-lg bg-gray-50 px-3 py-3 text-xs dark:bg-gray-950/70 sm:ml-5 sm:max-w-2xl"
              >
                <dt class="text-gray-400 dark:text-gray-600">Actor</dt>
                <dd class="truncate text-gray-700 dark:text-gray-300">
                  {{ log.userName
                  }}<span v-if="log.userEmail" class="text-gray-400">
                    · {{ log.userEmail }}</span
                  >
                </dd>
                <dt class="text-gray-400 dark:text-gray-600">Time</dt>
                <dd class="text-gray-700 dark:text-gray-300">
                  {{ formatTime(log.createdAt) }}
                </dd>
                <dt class="text-gray-400 dark:text-gray-600">IP address</dt>
                <dd class="font-mono text-gray-700 dark:text-gray-300">
                  {{ log.ipAddress || 'Unavailable' }}
                </dd>
                <template v-if="log.details?.sourceHash">
                  <dt class="text-gray-400 dark:text-gray-600">Source hash</dt>
                  <dd
                    class="font-mono text-gray-700 dark:text-gray-300"
                    :title="log.details.sourceHash"
                  >
                    {{ shortHash(log.details.sourceHash) }}
                  </dd>
                </template>
                <template v-if="formatBytes(log.details?.outputBytes)">
                  <dt class="text-gray-400 dark:text-gray-600">Output size</dt>
                  <dd class="text-gray-700 dark:text-gray-300">
                    {{ formatBytes(log.details.outputBytes) }}
                  </dd>
                </template>
                <template v-if="log.details?.mutationMethods?.length">
                  <dt class="text-gray-400 dark:text-gray-600">Detected</dt>
                  <dd class="text-gray-700 dark:text-gray-300">
                    {{ log.details.mutationMethods.join(', ') }}
                  </dd>
                </template>
              </dl>
            </details>
          </li>
        </ol>

        <footer
          class="mt-5 flex flex-col gap-3 border-t border-gray-100 pt-4 text-xs text-gray-400 dark:border-gray-900 dark:text-gray-600 sm:flex-row sm:items-center sm:justify-between"
        >
          <p>
            <template v-if="resultRange">
              {{ resultRange.first }}–{{ resultRange.last }} of
              {{ pagination.totalCount }} events.
            </template>
            Helm audit events are retained for
            {{ helmAuditRetentionDays }} days.
          </p>
          <Pagination
            :page="pagination.page"
            :pages="pagination.totalPages"
            :only="['logs', 'pagination', 'filters', 'helmAuditRetentionDays']"
            data-test="audit-pagination"
            class="[&_[data-slot=ellipsis]]:min-h-8 [&_[data-slot=ellipsis]]:min-w-6 [&_[data-slot=next]]:min-h-8 [&_[data-slot=next]]:min-w-8 [&_[data-slot=page]]:min-h-8 [&_[data-slot=page]]:min-w-8 [&_[data-slot=previous]]:min-h-8 [&_[data-slot=previous]]:min-w-8 w-auto [&>ul]:justify-end [&_[data-slot=next]]:border-0 [&_[data-slot=next]]:bg-transparent [&_[data-slot=next]]:px-2.5 [&_[data-slot=next]]:text-xs [&_[data-slot=page]]:border-0 [&_[data-slot=page]]:px-2 [&_[data-slot=page]]:text-xs [&_[data-slot=previous]]:border-0 [&_[data-slot=previous]]:bg-transparent [&_[data-slot=previous]]:px-2.5 [&_[data-slot=previous]]:text-xs"
          />
        </footer>
      </div>
    </main>
  </div>
</template>
