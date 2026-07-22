<script setup>
import { Link, router } from '@inertiajs/vue3'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  history: {
    type: Object,
    required: true
  },
  baseUrl: {
    type: String,
    required: true
  },
  currentTitle: {
    type: String,
    default: 'Current release'
  },
  currentEmpty: {
    type: String,
    default: 'No release is currently serving traffic.'
  }
})

const statusFilters = [
  { value: 'all', label: 'All' },
  { value: 'in-progress', label: 'In progress' },
  { value: 'succeeded', label: 'Succeeded' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' }
]

const items = ref([...(props.history.items || [])])
const activeDeployments = ref([...(props.history.activeDeployments || [])])
const selectedStatus = ref(props.history.filters?.status || 'all')
const selectedEnvironment = ref(props.history.filters?.environment || '')
const selectedApp = ref(props.history.filters?.app || '')
const selectedSource = ref(props.history.filters?.source || '')
const loadingMore = ref(false)
const appendNextPage = ref(false)
const updateAvailable = ref(false)
const liveRegionMessage = ref('')
const activeSources = new Map()
const clock = ref(Date.now())
let clockInterval = null

const showEnvironmentFilter = computed(
  () => (props.history.options?.environments || []).length > 1
)
const showAppFilter = computed(
  () => (props.history.options?.apps || []).length > 1
)
const hasSecondaryFilters = computed(
  () => showEnvironmentFilter.value || showAppFilter.value
)

function filterQuery(cursor = null) {
  const query = {}
  if (selectedStatus.value !== 'all') {
    query.deploymentStatus = selectedStatus.value
  }
  if (selectedEnvironment.value) {
    query.deploymentEnvironment = selectedEnvironment.value
  }
  if (selectedApp.value) query.deploymentApp = selectedApp.value
  if (selectedSource.value) query.deploymentSource = selectedSource.value
  if (cursor) query.deploymentCursor = cursor
  return query
}

function applyFilters() {
  appendNextPage.value = false
  updateAvailable.value = false
  router.get(props.baseUrl, filterQuery(), {
    preserveScroll: true,
    preserveState: true,
    replace: true
  })
}

function chooseStatus(status) {
  if (selectedStatus.value === status) return
  selectedStatus.value = status
  applyFilters()
}

function loadMore() {
  if (!props.history.nextCursor || loadingMore.value) return
  loadingMore.value = true
  appendNextPage.value = true
  router.get(props.baseUrl, filterQuery(props.history.nextCursor), {
    only: ['deploymentHistory'],
    preserveScroll: true,
    preserveState: true,
    replace: true,
    onFinish: () => {
      loadingMore.value = false
    }
  })
}

function refreshActivity() {
  updateAvailable.value = false
  router.reload({
    only: ['deploymentHistory'],
    preserveScroll: true,
    onSuccess: () => {
      liveRegionMessage.value = 'Deployment history updated.'
    }
  })
}

function statusFromEvent(deploymentId, status) {
  const labels = {
    pending: 'Queued',
    building: 'Building',
    pushing: 'Publishing',
    deploying: 'Deploying',
    running: 'Completed',
    failed: 'Failed',
    cancelled: 'Cancelled',
    stopped: 'Stopped'
  }
  const activeStatuses = ['pending', 'building', 'pushing', 'deploying']
  const outcomes = {
    running: 'succeeded',
    failed: 'failed',
    cancelled: 'cancelled',
    stopped: 'succeeded'
  }
  const patch = (deployment) =>
    deployment.id === deploymentId
      ? {
          ...deployment,
          status,
          isActive: activeStatuses.includes(status),
          outcome: outcomes[status] || deployment.outcome,
          outcomeLabel: labels[status] || deployment.outcomeLabel
        }
      : deployment

  activeDeployments.value = activeDeployments.value.map(patch)
  items.value = items.value.map(patch)
}

function connectActiveDeployments() {
  const activeIds = new Set(activeDeployments.value.map((item) => item.id))

  for (const [id, source] of activeSources) {
    if (!activeIds.has(id)) {
      source.close()
      activeSources.delete(id)
    }
  }

  for (const deployment of activeDeployments.value) {
    if (activeSources.has(deployment.id)) continue
    const source = new EventSource(
      `/api/v1/deployments/${deployment.id}/stream`
    )

    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (!data.status) return
        statusFromEvent(deployment.id, data.status)
        liveRegionMessage.value = `Deployment ${deployment.id} is ${data.status}.`

        if (
          ['running', 'failed', 'cancelled', 'stopped'].includes(data.status)
        ) {
          source.close()
          activeSources.delete(deployment.id)
          if (window.scrollY > 240) {
            updateAvailable.value = true
            liveRegionMessage.value =
              'Deployment activity changed. Refresh the history when ready.'
          } else {
            refreshActivity()
          }
        }
      } catch {
        // Ignore malformed stream events and allow EventSource to continue.
      }
    }
    source.onerror = () => {
      // EventSource reconnects automatically while the deployment is active.
    }
    activeSources.set(deployment.id, source)
  }
}

watch(
  () => props.history,
  (history) => {
    const nextItems = history.items || []
    if (appendNextPage.value) {
      const seen = new Set(items.value.map((item) => item.id))
      items.value = [
        ...items.value,
        ...nextItems.filter((item) => !seen.has(item.id))
      ]
      appendNextPage.value = false
    } else {
      items.value = [...nextItems]
    }

    activeDeployments.value = [...(history.activeDeployments || [])]
    selectedStatus.value = history.filters?.status || 'all'
    selectedEnvironment.value = history.filters?.environment || ''
    selectedApp.value = history.filters?.app || ''
    selectedSource.value = history.filters?.source || ''
    connectActiveDeployments()
  },
  { deep: true }
)

watch(
  activeDeployments,
  () => {
    connectActiveDeployments()
  },
  { deep: true, immediate: true }
)

onMounted(() => {
  clockInterval = setInterval(() => {
    clock.value = Date.now()
  }, 1000)
})

onBeforeUnmount(() => {
  if (clockInterval) clearInterval(clockInterval)
  for (const source of activeSources.values()) source.close()
  activeSources.clear()
})

function outcomeClasses(outcome) {
  return {
    current:
      'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950/50 dark:text-emerald-300 dark:ring-emerald-400/20',
    succeeded:
      'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950/50 dark:text-emerald-300 dark:ring-emerald-400/20',
    'in-progress':
      'bg-blue-50 text-blue-700 ring-blue-600/20 dark:bg-blue-950/50 dark:text-blue-300 dark:ring-blue-400/20',
    failed:
      'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-950/50 dark:text-red-300 dark:ring-red-400/20',
    cancelled:
      'bg-gray-100 text-gray-600 ring-gray-500/20 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-400/20',
    neutral:
      'bg-gray-100 text-gray-600 ring-gray-500/20 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-400/20'
  }[outcome]
}

function healthClasses(health) {
  if (health === 'Healthy') {
    return 'text-emerald-700 dark:text-emerald-300'
  }
  if (health === 'Unhealthy' || health === 'Failed') {
    return 'text-red-700 dark:text-red-300'
  }
  return 'text-gray-600 dark:text-gray-300'
}

function progressFor(status) {
  return { pending: 12, building: 38, pushing: 64, deploying: 84 }[status] || 8
}

function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return '—'
  if (seconds < 1) return '<1s'
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  if (minutes < 60)
    return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

function displayDuration(deployment) {
  if (deployment.isActive && deployment.startedAt) {
    return Math.max(
      0,
      Math.round((clock.value - Number(deployment.startedAt)) / 1000)
    )
  }
  return deployment.duration
}

function relativeTime(value) {
  if (!value) return 'Unknown'
  const seconds = Math.max(0, Math.floor((Date.now() - Number(value)) / 1000))
  const intervals = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60]
  ]
  for (const [label, size] of intervals) {
    const count = Math.floor(seconds / size)
    if (count >= 1) return `${count} ${label}${count === 1 ? '' : 's'} ago`
  }
  return 'Just now'
}

function exactTime(value) {
  if (!value) return 'Unknown time'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(Number(value)))
}

function isoTime(value) {
  if (!value) return undefined
  return new Date(Number(value)).toISOString()
}

function targetLabel(deployment) {
  return [deployment.environment?.name, deployment.app?.name]
    .filter(Boolean)
    .join(' / ')
}
</script>

<template>
  <section class="space-y-8" data-testid="deployment-overview">
    <p class="sr-only" aria-live="polite">{{ liveRegionMessage }}</p>

    <div>
      <div class="mb-3 flex items-center justify-between gap-4">
        <div>
          <h2 class="text-sm font-semibold text-gray-900 dark:text-white">
            {{ currentTitle }}
          </h2>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            The release currently serving application traffic.
          </p>
        </div>
      </div>

      <div
        v-if="history.currentReleases?.length"
        class="grid gap-3 lg:grid-cols-2"
      >
        <article
          v-for="release in history.currentReleases"
          :key="release.id"
          class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm shadow-gray-950/[0.02] dark:border-gray-800 dark:bg-gray-950"
          data-testid="current-release"
        >
          <div
            class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"
          >
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <span
                  :class="[
                    'inline-flex rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset',
                    outcomeClasses('current')
                  ]"
                >
                  Current
                </span>
                <span
                  :class="[
                    'text-xs font-medium',
                    healthClasses(release.health)
                  ]"
                >
                  {{ release.health }}
                </span>
              </div>
              <h3
                class="mt-3 truncate text-base font-semibold text-gray-950 dark:text-white"
              >
                {{ release.title }}
              </h3>
              <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {{ targetLabel(release) }}
                <template v-if="release.gitBranch || release.gitCommit">
                  <span aria-hidden="true"> · </span>
                  <span v-if="release.gitBranch">{{ release.gitBranch }}</span>
                  <code
                    v-if="release.gitCommit"
                    class="ml-1 font-mono text-xs"
                    >{{ release.gitCommit.slice(0, 7) }}</code
                  >
                </template>
              </p>
            </div>
            <div class="flex w-full shrink-0 items-center gap-2 sm:w-auto">
              <Link
                v-if="release.appHref"
                :href="release.appHref"
                class="min-h-11 inline-flex flex-1 items-center justify-center rounded-lg border border-gray-200 px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-900 sm:flex-none"
              >
                View app
              </Link>
              <Link
                :href="release.href"
                aria-label="Open current deployment"
                class="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-gray-950 text-white hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 dark:bg-white dark:text-gray-950 dark:hover:bg-gray-100"
              >
                <svg
                  class="h-4 w-4"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path
                    d="m7 4 6 6-6 6"
                    stroke-width="1.7"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </Link>
            </div>
          </div>
          <dl class="mt-5 grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-4">
            <div>
              <dt class="text-xs text-gray-400 dark:text-gray-500">Source</dt>
              <dd class="mt-1 text-sm text-gray-700 dark:text-gray-200">
                {{ release.sourceLabel }}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-gray-400 dark:text-gray-500">Actor</dt>
              <dd
                class="mt-1 truncate text-sm text-gray-700 dark:text-gray-200"
              >
                {{ release.actor }}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-gray-400 dark:text-gray-500">Duration</dt>
              <dd class="mt-1 text-sm text-gray-700 dark:text-gray-200">
                {{ formatDuration(release.duration) }}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-gray-400 dark:text-gray-500">Deployed</dt>
              <dd class="mt-1 text-sm text-gray-700 dark:text-gray-200">
                <time
                  :datetime="isoTime(release.deployedAt)"
                  :title="exactTime(release.deployedAt)"
                >
                  {{ relativeTime(release.deployedAt) }}
                </time>
              </dd>
            </div>
          </dl>
        </article>
      </div>

      <div
        v-else
        class="rounded-xl border border-dashed border-gray-300 px-5 py-6 dark:border-gray-700"
        data-testid="no-current-release"
      >
        <p class="text-sm font-medium text-gray-700 dark:text-gray-200">
          No current release
        </p>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {{ currentEmpty }}
        </p>
      </div>
    </div>

    <div v-if="activeDeployments.length" aria-live="polite">
      <div class="mb-3">
        <h2 class="text-sm font-semibold text-gray-900 dark:text-white">
          Active work
        </h2>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Live deployment progress. This does not change history ordering.
        </p>
      </div>
      <div class="space-y-2">
        <Link
          v-for="deployment in activeDeployments"
          :key="deployment.id"
          :href="deployment.href"
          class="block rounded-xl border border-blue-200 bg-blue-50/50 p-4 hover:border-blue-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 dark:border-blue-900 dark:bg-blue-950/20 dark:hover:border-blue-800"
          data-testid="active-deployment"
        >
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <span
                  :class="[
                    'inline-flex rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset',
                    outcomeClasses('in-progress')
                  ]"
                >
                  {{ deployment.outcomeLabel }}
                </span>
                <span class="text-xs text-gray-500 dark:text-gray-400">
                  {{ targetLabel(deployment) }}
                </span>
              </div>
              <p
                class="mt-2 truncate text-sm font-medium text-gray-900 dark:text-white"
              >
                {{ deployment.title }}
              </p>
            </div>
            <span class="shrink-0 text-xs text-gray-500 dark:text-gray-400">
              {{ formatDuration(displayDuration(deployment)) }}
            </span>
          </div>
          <div
            class="mt-4 h-1.5 overflow-hidden rounded-full bg-blue-100 dark:bg-blue-950"
            aria-hidden="true"
          >
            <div
              class="h-full rounded-full bg-blue-600 transition-[width] duration-500 dark:bg-blue-400"
              :style="{ width: `${progressFor(deployment.status)}%` }"
            ></div>
          </div>
        </Link>
      </div>
    </div>

    <div>
      <div
        class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"
      >
        <div>
          <h2 class="text-sm font-semibold text-gray-900 dark:text-white">
            Deployment history
          </h2>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Newest first, with deployment outcome separate from runtime state.
          </p>
        </div>

        <div class="flex flex-wrap items-end gap-2">
          <label v-if="showEnvironmentFilter" class="block">
            <span class="sr-only">Filter by environment</span>
            <select
              v-model="selectedEnvironment"
              class="min-h-11 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200"
              @change="applyFilters"
            >
              <option value="">All environments</option>
              <option
                v-for="option in history.options.environments"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select>
          </label>
          <label v-if="showAppFilter" class="block">
            <span class="sr-only">Filter by app</span>
            <select
              v-model="selectedApp"
              class="min-h-11 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200"
              @change="applyFilters"
            >
              <option value="">All apps</option>
              <option
                v-for="option in history.options.apps"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select>
          </label>
          <label class="block">
            <span class="sr-only">Filter by source</span>
            <select
              v-model="selectedSource"
              class="min-h-11 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200"
              @change="applyFilters"
            >
              <option value="">All sources</option>
              <option
                v-for="option in history.options.sources"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select>
          </label>
        </div>
      </div>

      <fieldset class="mt-4 min-w-0">
        <legend class="sr-only">Filter deployments by outcome</legend>
        <div
          class="flex max-w-full gap-1 overflow-x-auto rounded-lg bg-gray-100 p-1 dark:bg-gray-900"
          :class="hasSecondaryFilters ? 'lg:max-w-xl' : 'lg:max-w-lg'"
        >
          <button
            v-for="filter in statusFilters"
            :key="filter.value"
            type="button"
            :data-test="`deployment-filter-${filter.value}`"
            :aria-pressed="selectedStatus === filter.value"
            :class="[
              'min-h-11 shrink-0 rounded-md px-3 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1',
              selectedStatus === filter.value
                ? 'bg-white text-gray-950 shadow-sm dark:bg-gray-800 dark:text-white'
                : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
            ]"
            @click="chooseStatus(filter.value)"
          >
            {{ filter.label }}
          </button>
        </div>
      </fieldset>

      <div
        v-if="updateAvailable"
        class="mt-4 flex items-center justify-between gap-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-900 dark:bg-blue-950/30"
        role="status"
      >
        <p class="text-sm text-blue-800 dark:text-blue-200">
          Deployment activity changed while you were reading.
        </p>
        <button
          type="button"
          class="min-h-11 shrink-0 rounded-lg bg-blue-700 px-3 text-sm font-medium text-white hover:bg-blue-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:bg-blue-500 dark:text-blue-950"
          @click="refreshActivity"
        >
          Refresh
        </button>
      </div>

      <div
        v-if="items.length"
        class="mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950"
      >
        <div class="hidden overflow-x-auto lg:block">
          <table class="w-full table-fixed text-left">
            <caption class="sr-only">
              Deployment history ordered newest first
            </caption>
            <thead
              class="border-b border-gray-200 bg-gray-50/80 dark:border-gray-800 dark:bg-gray-900/60"
            >
              <tr>
                <th class="w-[30%] px-4 py-3 text-xs font-medium text-gray-500">
                  Deployment
                </th>
                <th class="w-[15%] px-3 py-3 text-xs font-medium text-gray-500">
                  Target
                </th>
                <th class="w-[12%] px-3 py-3 text-xs font-medium text-gray-500">
                  Outcome
                </th>
                <th class="w-[9%] px-3 py-3 text-xs font-medium text-gray-500">
                  Source
                </th>
                <th class="w-[11%] px-3 py-3 text-xs font-medium text-gray-500">
                  Actor
                </th>
                <th class="w-[8%] px-3 py-3 text-xs font-medium text-gray-500">
                  Duration
                </th>
                <th class="w-[15%] px-3 py-3 text-xs font-medium text-gray-500">
                  Deployed
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 dark:divide-gray-900">
              <tr
                v-for="deployment in items"
                :key="deployment.id"
                class="transition-colors hover:bg-gray-50/80 dark:hover:bg-gray-900/50"
                data-testid="deployment-row"
              >
                <td class="px-4 py-4 align-top">
                  <Link
                    :href="deployment.href"
                    class="block truncate text-sm font-medium text-gray-950 hover:underline focus:outline-none focus-visible:rounded focus-visible:ring-2 focus-visible:ring-sky-500 dark:text-white"
                  >
                    {{ deployment.title }}
                  </Link>
                  <p
                    class="mt-1 truncate text-xs text-gray-500 dark:text-gray-400"
                  >
                    <span v-if="deployment.gitBranch">{{
                      deployment.gitBranch
                    }}</span>
                    <code v-if="deployment.gitCommit" class="ml-1 font-mono">{{
                      deployment.gitCommit.slice(0, 7)
                    }}</code>
                    <span v-if="!deployment.gitBranch && !deployment.gitCommit"
                      >#{{ deployment.id }}</span
                    >
                  </p>
                </td>
                <td
                  class="px-3 py-4 align-top text-sm text-gray-600 dark:text-gray-300"
                >
                  <span class="block truncate">{{
                    deployment.environment?.name || 'Unknown'
                  }}</span>
                  <span class="mt-1 block truncate text-xs text-gray-400">{{
                    deployment.app?.name || 'Default app'
                  }}</span>
                </td>
                <td class="px-3 py-4 align-top">
                  <span
                    :class="[
                      'inline-flex rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset',
                      outcomeClasses(deployment.outcome)
                    ]"
                  >
                    {{ deployment.outcomeLabel }}
                  </span>
                </td>
                <td
                  class="px-3 py-4 align-top text-sm text-gray-600 dark:text-gray-300"
                >
                  {{ deployment.sourceLabel }}
                </td>
                <td
                  class="truncate px-3 py-4 align-top text-sm text-gray-600 dark:text-gray-300"
                >
                  {{ deployment.actor }}
                </td>
                <td
                  class="px-3 py-4 align-top font-mono text-xs text-gray-500 dark:text-gray-400"
                >
                  {{ formatDuration(displayDuration(deployment)) }}
                </td>
                <td class="px-3 py-4 align-top">
                  <time
                    :datetime="isoTime(deployment.deployedAt)"
                    :title="exactTime(deployment.deployedAt)"
                    class="block text-sm text-gray-600 dark:text-gray-300"
                  >
                    {{ relativeTime(deployment.deployedAt) }}
                  </time>
                  <span
                    class="mt-1 block text-xs text-gray-400 dark:text-gray-500"
                  >
                    {{ exactTime(deployment.deployedAt) }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="divide-y divide-gray-100 dark:divide-gray-900 lg:hidden">
          <article
            v-for="deployment in items"
            :key="deployment.id"
            class="p-4"
            data-testid="deployment-card"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <Link
                  :href="deployment.href"
                  class="block truncate text-sm font-semibold text-gray-950 focus:outline-none focus-visible:rounded focus-visible:ring-2 focus-visible:ring-sky-500 dark:text-white"
                >
                  {{ deployment.title }}
                </Link>
                <p
                  class="mt-1 truncate text-xs text-gray-500 dark:text-gray-400"
                >
                  {{ targetLabel(deployment) || 'Unknown target' }}
                </p>
              </div>
              <span
                :class="[
                  'inline-flex shrink-0 rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset',
                  outcomeClasses(deployment.outcome)
                ]"
              >
                {{ deployment.outcomeLabel }}
              </span>
            </div>
            <dl class="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div>
                <dt class="text-xs text-gray-400">Source</dt>
                <dd class="mt-1 text-gray-700 dark:text-gray-200">
                  {{ deployment.sourceLabel }}
                </dd>
              </div>
              <div>
                <dt class="text-xs text-gray-400">Actor</dt>
                <dd class="mt-1 truncate text-gray-700 dark:text-gray-200">
                  {{ deployment.actor }}
                </dd>
              </div>
              <div>
                <dt class="text-xs text-gray-400">Duration</dt>
                <dd
                  class="mt-1 font-mono text-xs text-gray-700 dark:text-gray-200"
                >
                  {{ formatDuration(displayDuration(deployment)) }}
                </dd>
              </div>
              <div>
                <dt class="text-xs text-gray-400">Deployed</dt>
                <dd class="mt-1 text-gray-700 dark:text-gray-200">
                  <time
                    :datetime="isoTime(deployment.deployedAt)"
                    :title="exactTime(deployment.deployedAt)"
                  >
                    {{ relativeTime(deployment.deployedAt) }}
                  </time>
                </dd>
              </div>
            </dl>
            <p
              class="mt-3 truncate border-t border-gray-100 pt-3 text-xs text-gray-400 dark:border-gray-900 dark:text-gray-500"
            >
              <span v-if="deployment.gitBranch">{{
                deployment.gitBranch
              }}</span>
              <code v-if="deployment.gitCommit" class="ml-1 font-mono">{{
                deployment.gitCommit.slice(0, 7)
              }}</code>
              <span v-if="!deployment.gitBranch && !deployment.gitCommit"
                >Deployment #{{ deployment.id }}</span
              >
              <span aria-hidden="true"> · </span>
              {{ exactTime(deployment.deployedAt) }}
            </p>
          </article>
        </div>
      </div>

      <div
        v-else
        class="mt-4 rounded-xl border border-dashed border-gray-300 px-6 py-10 text-center dark:border-gray-700"
        data-testid="empty-deployment-history"
      >
        <p class="text-sm font-medium text-gray-700 dark:text-gray-200">
          No matching deployments
        </p>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Try another filter, or deploy an application to start its history.
        </p>
      </div>

      <div v-if="history.nextCursor" class="mt-4 flex justify-center">
        <button
          type="button"
          class="min-h-11 inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900"
          :disabled="loadingMore"
          @click="loadMore"
        >
          {{ loadingMore ? 'Loading…' : 'Load more' }}
        </button>
      </div>
    </div>
  </section>
</template>
