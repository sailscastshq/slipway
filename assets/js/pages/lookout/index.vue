<script setup>
import SidebarOpen from '@/components/ui/icons/SidebarOpen.vue'
import SidebarClose from '@/components/ui/icons/SidebarClose.vue'
import Filter from '@/components/ui/icons/Filter.vue'
import ChevronDown from '@/components/ui/icons/ChevronDown.vue'
import Check from '@/components/ui/icons/Check.vue'
import ChartBar from '@/components/ui/icons/ChartBar.vue'
import Input from '@/components/ui/input/Input.vue'
import { Link, Head, router, usePoll } from '@inertiajs/vue3'
import { inject, ref, computed } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'
import Badge from '@/components/ui/badge/Badge.vue'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  containers: {
    type: Array,
    default: () => []
  },
  hostDisk: {
    type: Object,
    default: null
  },
  telemetrySummary: {
    type: Object,
    default: () => ({})
  },
  observabilityHealth: {
    type: Object,
    default: () => ({
      collector: { status: 'waiting', rowCount: 0 },
      retention: { status: 'waiting', rowCount: 0 }
    })
  }
})

const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')

// Auto-refresh every 30 seconds
usePoll(30000)

// Search + project filter
const searchQuery = ref('')
const selectedProject = ref('all')
const filterOpen = ref(false)

const projects = computed(() => {
  const map = {}
  for (const c of props.containers) {
    if (c.project?.slug && !map[c.project.slug]) {
      map[c.project.slug] = { slug: c.project.slug, name: c.project.name }
    }
  }
  return Object.values(map).sort((a, b) => a.name.localeCompare(b.name))
})

const filteredContainers = computed(() => {
  let result = props.containers
  if (selectedProject.value !== 'all') {
    result = result.filter((c) => c.project?.slug === selectedProject.value)
  }
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    result = result.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.project?.name?.toLowerCase().includes(q) ||
        c.environment?.name?.toLowerCase().includes(q)
    )
  }
  return result
})

// Group containers by project
const groupedByProject = computed(() => {
  const groups = {}
  for (const c of filteredContainers.value) {
    const key = c.project?.slug || '_unknown'
    if (!groups[key]) {
      groups[key] = {
        project: c.project,
        apps: [],
        services: []
      }
    }
    if (c.type === 'app') {
      groups[key].apps.push(c)
    } else {
      groups[key].services.push(c)
    }
  }
  return Object.values(groups).sort((a, b) =>
    (a.project?.name || '').localeCompare(b.project?.name || '')
  )
})

const totalContainers = computed(() => filteredContainers.value.length)

function selectProject(slug) {
  selectedProject.value = slug
  filterOpen.value = false
}

const selectedProjectName = computed(() => {
  if (selectedProject.value === 'all') return 'All projects'
  return (
    projects.value.find((p) => p.slug === selectedProject.value)?.name ||
    'All projects'
  )
})

function formatBytes(bytes) {
  if (!bytes) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function cpuColor(percent) {
  if (percent > 90) return 'text-red-600 dark:text-red-400'
  if (percent > 70) return 'text-yellow-600 dark:text-yellow-400'
  return 'text-emerald-600 dark:text-emerald-400'
}

function memColor(percent) {
  if (percent > 90) return 'text-red-600 dark:text-red-400'
  if (percent > 70) return 'text-yellow-600 dark:text-yellow-400'
  return 'text-blue-600 dark:text-blue-400'
}

function memBarColor(percent) {
  if (percent > 90) return 'bg-red-500'
  if (percent > 70) return 'bg-yellow-500'
  return 'bg-blue-500'
}

function diskTextColor(percent) {
  if (percent >= 90) return 'text-red-600 dark:text-red-400'
  if (percent >= 75) return 'text-yellow-600 dark:text-yellow-400'
  return 'text-emerald-600 dark:text-emerald-400'
}

function diskBarColor(percent) {
  if (percent >= 90) return 'bg-red-500'
  if (percent >= 75) return 'bg-yellow-500'
  return 'bg-emerald-500'
}

const diskStatusLabel = computed(() => {
  const usedPercent = props.hostDisk?.usedPercent ?? 0
  if (!props.hostDisk) return 'Unavailable'
  if (usedPercent >= 90) return 'Critical'
  if (usedPercent >= 75) return 'Watching'
  return 'Healthy'
})

function timeAgo(timestamp) {
  if (!timestamp) return ''
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

function healthLabel(name, label) {
  const health = props.observabilityHealth?.[name]
  if (!health || health.status === 'waiting') return `${label} waiting`
  if (health.status === 'failed') return `${label} failed`
  if (health.status === 'stale') {
    return `${label} stale · ${timeAgo(health.lastSuccessAt)}`
  }
  return `${label} ${timeAgo(health.lastSuccessAt)}`
}

function healthDot(name) {
  const status = props.observabilityHealth?.[name]?.status
  if (status === 'failed') return 'bg-red-500'
  if (status === 'stale') return 'bg-yellow-500'
  if (status === 'healthy') return 'bg-emerald-500'
  return 'bg-gray-300 dark:bg-gray-600'
}

function compactNumber(number) {
  if (number < 1000) return String(number || 0)
  if (number < 1000000) return `${(number / 1000).toFixed(1)}k`
  return `${(number / 1000000).toFixed(1)}m`
}

function serviceIcon(type) {
  const icons = { postgresql: 'PG', mysql: 'My', redis: 'Rd', mongodb: 'Mg' }
  return icons[type] || 'Sv'
}

// Get telemetry summary for a container's environment
function envTelemetry(container) {
  return props.telemetrySummary[container.environment?.id] || null
}
</script>

<template>
  <Head title="Lookout | Slipway"></Head>
  <div class="flex h-full flex-col">
    <!-- Header -->
    <div
      class="flex items-center justify-between border-b border-gray-200 py-4 pl-4 pr-4 dark:border-gray-800 sm:pl-4 sm:pr-8"
    >
      <div class="flex items-center space-x-3">
        <button
          @click="toggleMobileMenu"
          class="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white md:hidden"
        >
          <SidebarOpen class="h-5 w-5" stroke-width="1" />
        </button>
        <button
          @click="toggleSidebar"
          class="hidden text-gray-400 dark:text-gray-500 md:block"
        >
          <SidebarOpen
            v-if="sidebarCollapsed"
            class="h-5 w-5"
            stroke-width="1"
          />
          <SidebarClose v-else class="h-5 w-5" stroke-width="1" />
        </button>
        <span class="font-medium text-gray-900 dark:text-white">Lookout</span>
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
      <div class="mx-auto max-w-6xl">
        <!-- Header -->
        <div class="mb-8 flex items-start justify-between">
          <div>
            <h1 class="text-xl font-semibold text-gray-900 dark:text-white">
              Infrastructure
            </h1>
            <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Monitor resource usage across all running containers.
            </p>
          </div>

          <!-- Project filter dropdown -->
          <div v-if="projects.length > 1" class="relative">
            <button
              @click.stop="filterOpen = !filterOpen"
              class="flex items-center space-x-2 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <Filter class="h-4 w-4 text-gray-400" stroke-width="2" />
              <span>{{ selectedProjectName }}</span>
              <ChevronDown
                :class="[
                  'h-3.5 w-3.5 text-gray-400 transition-transform',
                  filterOpen ? 'rotate-180' : ''
                ]"
                stroke-width="2"
              />
            </button>
            <Transition
              enter-active-class="transition ease-out duration-100"
              enter-from-class="transform opacity-0 scale-95"
              enter-to-class="transform opacity-100 scale-100"
              leave-active-class="transition ease-in duration-75"
              leave-from-class="transform opacity-100 scale-100"
              leave-to-class="transform opacity-0 scale-95"
            >
              <div
                v-if="filterOpen"
                @click.stop
                class="absolute right-0 top-full z-20 mt-1 w-48 rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
              >
                <button
                  @click="selectProject('all')"
                  :class="[
                    'flex w-full items-center px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800',
                    selectedProject === 'all'
                      ? 'text-gray-900 dark:text-white'
                      : 'text-gray-600 dark:text-gray-400'
                  ]"
                >
                  All projects
                  <Check
                    v-if="selectedProject === 'all'"
                    class="ml-auto h-4 w-4 text-emerald-500"
                    stroke-width="2"
                  />
                </button>
                <div
                  class="my-1 border-t border-gray-100 dark:border-gray-800"
                ></div>
                <button
                  v-for="p in projects"
                  :key="p.slug"
                  @click="selectProject(p.slug)"
                  :class="[
                    'flex w-full items-center px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800',
                    selectedProject === p.slug
                      ? 'text-gray-900 dark:text-white'
                      : 'text-gray-600 dark:text-gray-400'
                  ]"
                >
                  {{ p.name }}
                  <Check
                    v-if="selectedProject === p.slug"
                    class="ml-auto h-4 w-4 text-emerald-500"
                    stroke-width="2"
                  />
                </button>
              </div>
            </Transition>
          </div>
        </div>

        <section
          class="mb-6 overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
        >
          <div
            class="border-b border-gray-100 bg-gray-50/80 px-4 py-3 dark:border-gray-800 dark:bg-gray-900/80 sm:px-5"
          >
            <div class="flex items-center justify-between gap-3">
              <div>
                <p class="text-sm font-medium text-gray-900 dark:text-white">
                  Host disk
                </p>
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  Root volume usage across this Slipway host.
                </p>
              </div>
              <Badge
                :class="[
                  'px-2.5 py-1 text-xs',
                  props.hostDisk
                    ? 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
                    : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                ]"
              >
                {{ diskStatusLabel }}
              </Badge>
            </div>
          </div>

          <div class="px-4 py-4 sm:px-5">
            <div
              class="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between"
            >
              <div>
                <div class="flex items-end gap-3">
                  <span
                    :class="[
                      'text-3xl font-semibold tabular-nums sm:text-4xl',
                      diskTextColor(props.hostDisk?.usedPercent ?? 0)
                    ]"
                  >
                    {{
                      props.hostDisk ? `${props.hostDisk.usedPercent}%` : '—'
                    }}
                  </span>
                  <span class="pb-1 text-sm text-gray-500 dark:text-gray-400">
                    used on {{ props.hostDisk?.mount || '/' }}
                  </span>
                </div>
                <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
                  {{
                    props.hostDisk
                      ? `${props.hostDisk.used} used of ${props.hostDisk.total}`
                      : 'Disk metrics are currently unavailable.'
                  }}
                </p>
              </div>

              <dl
                class="grid grid-cols-2 gap-4 sm:flex sm:flex-wrap sm:justify-end sm:gap-6"
              >
                <div>
                  <dt
                    class="text-xs uppercase tracking-wide text-gray-400 dark:text-gray-500"
                  >
                    Available
                  </dt>
                  <dd
                    class="mt-1 text-sm font-medium text-gray-900 dark:text-white"
                  >
                    {{ props.hostDisk?.available || 'Unavailable' }}
                  </dd>
                </div>
                <div>
                  <dt
                    class="text-xs uppercase tracking-wide text-gray-400 dark:text-gray-500"
                  >
                    Total
                  </dt>
                  <dd
                    class="mt-1 text-sm font-medium text-gray-900 dark:text-white"
                  >
                    {{ props.hostDisk?.total || 'Unavailable' }}
                  </dd>
                </div>
                <div>
                  <dt
                    class="text-xs uppercase tracking-wide text-gray-400 dark:text-gray-500"
                  >
                    Alert
                  </dt>
                  <dd
                    class="mt-1 text-sm font-medium text-gray-900 dark:text-white"
                  >
                    90%
                  </dd>
                </div>
              </dl>
            </div>

            <div class="mt-4">
              <div
                class="mb-1 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400"
              >
                <span>{{
                  props.hostDisk ? 'Current usage' : 'Waiting for disk metrics'
                }}</span>
                <span v-if="props.hostDisk" class="tabular-nums"
                  >{{ props.hostDisk.usedPercent }}%</span
                >
              </div>
              <div
                class="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800"
              >
                <div
                  :class="[
                    'h-full rounded-full transition-all',
                    diskBarColor(props.hostDisk?.usedPercent ?? 0)
                  ]"
                  :style="{
                    width: `${Math.min(props.hostDisk?.usedPercent ?? 0, 100)}%`
                  }"
                ></div>
              </div>
            </div>

            <div
              data-test="lookout-observability-health"
              class="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-gray-100 pt-3 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400"
            >
              <span class="inline-flex items-center gap-1.5">
                <span
                  :class="['h-1.5 w-1.5 rounded-full', healthDot('collector')]"
                ></span>
                {{ healthLabel('collector', 'Collector') }}
              </span>
              <span class="inline-flex items-center gap-1.5">
                <span
                  :class="['h-1.5 w-1.5 rounded-full', healthDot('retention')]"
                ></span>
                {{ healthLabel('retention', 'Retention') }}
              </span>
              <span class="sm:ml-auto">
                {{
                  compactNumber(
                    props.observabilityHealth?.retention?.rowCount || 0
                  )
                }}
                retained rows
              </span>
            </div>
          </div>
        </section>

        <!-- Search -->
        <div v-if="containers.length > 0" class="mb-6">
          <Input
            v-model="searchQuery"
            type="text"
            placeholder="Filter containers..."
            class="focus:border-brand w-full max-w-xs border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
          />
        </div>

        <!-- Empty state -->
        <div v-if="containers.length === 0" class="py-20 text-center">
          <ChartBar
            class="mx-auto h-12 w-12 text-gray-300 dark:text-gray-600"
          />
          <h3 class="mt-4 text-sm font-medium text-gray-900 dark:text-white">
            No running containers
          </h3>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Deploy an application to start seeing infrastructure metrics.
          </p>
        </div>

        <!-- Grouped by project -->
        <div
          v-for="group in groupedByProject"
          :key="group.project?.slug"
          class="mb-8"
        >
          <!-- Project heading -->
          <div class="mb-2 flex items-center space-x-2">
            <Link
              :href="`/projects/${group.project?.slug}`"
              class="text-sm font-medium text-gray-900 underline decoration-gray-300 decoration-dashed underline-offset-2 hover:text-gray-700 dark:text-white dark:decoration-gray-600 dark:hover:text-gray-300"
            >
              {{ group.project?.name }}
            </Link>
            <span class="text-xs text-gray-400 dark:text-gray-500">
              {{ group.apps.length + group.services.length }} container{{
                group.apps.length + group.services.length !== 1 ? 's' : ''
              }}
            </span>
          </div>

          <!-- Container rows -->
          <div
            class="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800"
          >
            <Link
              v-for="(container, i) in [...group.apps, ...group.services]"
              :key="container.name"
              :href="`/projects/${container.project?.slug}/environments/${container.environment?.slug}/lookout`"
              :class="[
                'flex items-center gap-4 px-4 py-3 transition-colors hover:bg-gray-50 dark:hover:bg-gray-900/50',
                i > 0 ? 'border-t border-gray-100 dark:border-gray-800' : ''
              ]"
            >
              <!-- Type badge -->
              <span
                v-if="container.type === 'app'"
                class="bg-brand/10 text-brand inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-[10px] font-bold"
                >AP</span
              >
              <span
                v-else
                class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded bg-gray-100 text-[10px] font-bold text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                >{{ serviceIcon(container.serviceType) }}</span
              >

              <!-- Name + environment -->
              <div class="min-w-0 flex-1">
                <div
                  class="truncate text-sm font-medium text-gray-900 dark:text-white"
                >
                  {{
                    container.type === 'app'
                      ? container.project?.name || container.name
                      : container.name
                  }}
                </div>
                <div class="text-xs text-gray-500 dark:text-gray-400">
                  {{ container.environment?.name }}
                </div>
              </div>

              <!-- Status dot -->
              <span class="h-2 w-2 shrink-0 rounded-full bg-emerald-500"></span>

              <!-- Telemetry badges (if app has telemetry data) -->
              <div
                v-if="container.type === 'app' && envTelemetry(container)"
                class="hidden items-center space-x-1.5 lg:flex"
              >
                <span
                  class="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:bg-blue-900/20 dark:text-blue-400"
                >
                  {{ envTelemetry(container).requests }} req
                </span>
                <span
                  v-if="envTelemetry(container).exceptions > 0"
                  class="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-600 dark:bg-red-900/20 dark:text-red-400"
                >
                  {{ envTelemetry(container).exceptions }} err
                </span>
              </div>

              <!-- CPU -->
              <div class="hidden w-16 shrink-0 text-right sm:block">
                <div class="text-[10px] text-gray-400 dark:text-gray-500">
                  CPU
                </div>
                <div
                  v-if="container.metric"
                  :class="[
                    'font-mono text-sm font-medium',
                    cpuColor(container.metric.cpuPercent)
                  ]"
                >
                  {{ container.metric.cpuPercent.toFixed(1) }}%
                </div>
                <div v-else class="text-xs text-gray-300 dark:text-gray-600">
                  —
                </div>
              </div>

              <!-- Memory bar -->
              <div class="hidden w-36 shrink-0 sm:block">
                <div class="flex items-center justify-between">
                  <span class="text-[10px] text-gray-400 dark:text-gray-500"
                    >Mem</span
                  >
                  <span
                    v-if="container.metric"
                    :class="[
                      'font-mono text-xs font-medium',
                      memColor(container.metric.memoryPercent)
                    ]"
                  >
                    {{ container.metric.memoryPercent.toFixed(1) }}%
                  </span>
                </div>
                <div
                  v-if="container.metric"
                  class="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800"
                >
                  <div
                    :class="[
                      'h-full rounded-full transition-all',
                      memBarColor(container.metric.memoryPercent)
                    ]"
                    :style="{
                      width: Math.min(container.metric.memoryPercent, 100) + '%'
                    }"
                  ></div>
                </div>
                <div
                  v-if="container.metric"
                  class="mt-0.5 flex justify-between text-[10px] text-gray-400 dark:text-gray-500"
                >
                  <span>{{ formatBytes(container.metric.memoryUsage) }}</span>
                  <span>{{ formatBytes(container.metric.memoryLimit) }}</span>
                </div>
                <div v-else class="text-xs text-gray-300 dark:text-gray-600">
                  —
                </div>
              </div>

              <!-- Net I/O -->
              <div class="hidden w-28 shrink-0 text-right lg:block">
                <div class="text-[10px] text-gray-400 dark:text-gray-500">
                  Net I/O
                </div>
                <div class="text-xs text-gray-600 dark:text-gray-400">
                  {{ container.metric?.netIO || '—' }}
                </div>
              </div>

              <!-- Updated -->
              <div class="w-14 shrink-0 text-right">
                <div class="text-[10px] text-gray-400 dark:text-gray-500">
                  {{
                    container.metric ? timeAgo(container.metric.recordedAt) : ''
                  }}
                </div>
              </div>
            </Link>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
