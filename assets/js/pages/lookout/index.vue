<script setup>
import { Link, Head, router, usePoll } from '@inertiajs/vue3'
import { inject, ref, computed } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  containers: {
    type: Array,
    default: () => []
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
    result = result.filter(c => c.project?.slug === selectedProject.value)
  }
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    result = result.filter(c =>
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
  return projects.value.find(p => p.slug === selectedProject.value)?.name || 'All projects'
})

function formatBytes(bytes) {
  if (!bytes) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
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

function timeAgo(timestamp) {
  if (!timestamp) return ''
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

function serviceIcon(type) {
  const icons = { postgresql: 'PG', mysql: 'My', redis: 'Rd', mongodb: 'Mg' }
  return icons[type] || 'Sv'
}
</script>

<template>
  <Head title="Lookout | Slipway"></Head>
  <div class="flex h-full flex-col">
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-gray-200 py-4 pl-4 pr-4 dark:border-gray-800 sm:pl-4 sm:pr-8">
      <div class="flex items-center space-x-3">
        <button
          @click="toggleMobileMenu"
          class="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white md:hidden"
        >
          <svg class="h-5 w-5" viewBox="-0.5 -0.5 16 16" fill="none" stroke="currentColor">
            <path d="M12.777 14.285H2.223c-.833 0-1.508-.675-1.508-1.508V2.223c0-.833.675-1.508 1.508-1.508h10.554c.833 0 1.508.675 1.508 1.508v10.554c0 .833-.675 1.508-1.508 1.508Z" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" />
            <path d="M5.615 14.285V.715" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" />
            <path d="M2.6 5.992 3.919 7.5 2.6 9.008" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" />
          </svg>
        </button>
        <button
          @click="toggleSidebar"
          class="hidden text-gray-400 dark:text-gray-500 md:block"
        >
          <svg v-if="sidebarCollapsed" class="h-5 w-5" viewBox="-0.5 -0.5 16 16" fill="none" stroke="currentColor">
            <path d="M12.777 14.285H2.223c-.833 0-1.508-.675-1.508-1.508V2.223c0-.833.675-1.508 1.508-1.508h10.554c.833 0 1.508.675 1.508 1.508v10.554c0 .833-.675 1.508-1.508 1.508Z" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" />
            <path d="M5.615 14.285V.715" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" />
            <path d="M2.6 5.992 3.919 7.5 2.6 9.008" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" />
          </svg>
          <svg v-else class="h-5 w-5" viewBox="-0.5 -0.5 16 16" fill="none" stroke="currentColor">
            <path d="M12.777 14.285H2.223c-.833 0-1.508-.675-1.508-1.508V2.223c0-.833.675-1.508 1.508-1.508h10.554c.833 0 1.508.675 1.508 1.508v10.554c0 .833-.675 1.508-1.508 1.508Z" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" />
            <path d="M5.615 14.285V.715" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" />
            <path d="M3.919 5.992 2.6 7.5l1.319 1.508" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" />
          </svg>
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
            <h1 class="text-xl font-semibold text-gray-900 dark:text-white">Infrastructure</h1>
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
              <svg class="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              <span>{{ selectedProjectName }}</span>
              <svg
                :class="['h-3.5 w-3.5 text-gray-400 transition-transform', filterOpen ? 'rotate-180' : '']"
                fill="none" stroke="currentColor" viewBox="0 0 24 24"
              >
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
              </svg>
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
                    selectedProject === 'all' ? 'text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-400'
                  ]"
                >
                  All projects
                  <svg v-if="selectedProject === 'all'" class="ml-auto h-4 w-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                  </svg>
                </button>
                <div class="my-1 border-t border-gray-100 dark:border-gray-800"></div>
                <button
                  v-for="p in projects"
                  :key="p.slug"
                  @click="selectProject(p.slug)"
                  :class="[
                    'flex w-full items-center px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800',
                    selectedProject === p.slug ? 'text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-400'
                  ]"
                >
                  {{ p.name }}
                  <svg v-if="selectedProject === p.slug" class="ml-auto h-4 w-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                  </svg>
                </button>
              </div>
            </Transition>
          </div>
        </div>

        <!-- Search -->
        <div v-if="containers.length > 0" class="mb-6">
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Filter containers..."
            class="w-full max-w-xs border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
          />
        </div>

        <!-- Empty state -->
        <div v-if="containers.length === 0" class="py-20 text-center">
          <svg class="mx-auto h-12 w-12 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <h3 class="mt-4 text-sm font-medium text-gray-900 dark:text-white">No running containers</h3>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Deploy an application to start seeing infrastructure metrics.
          </p>
        </div>

        <!-- Grouped by project -->
        <div v-for="group in groupedByProject" :key="group.project?.slug" class="mb-8">
          <!-- Project heading -->
          <div class="mb-2 flex items-center space-x-2">
            <Link
              :href="`/projects/${group.project?.slug}`"
              class="text-sm font-medium text-gray-900 underline decoration-dashed decoration-gray-300 underline-offset-2 hover:text-gray-700 dark:text-white dark:decoration-gray-600 dark:hover:text-gray-300"
            >
              {{ group.project?.name }}
            </Link>
            <span class="text-xs text-gray-400 dark:text-gray-500">
              {{ group.apps.length + group.services.length }} container{{ group.apps.length + group.services.length !== 1 ? 's' : '' }}
            </span>
          </div>

          <!-- Container rows -->
          <div class="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
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
                class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded bg-brand/10 text-[10px] font-bold text-brand"
              >AP</span>
              <span
                v-else
                class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded bg-gray-100 text-[10px] font-bold text-gray-600 dark:bg-gray-800 dark:text-gray-300"
              >{{ serviceIcon(container.serviceType) }}</span>

              <!-- Name + environment -->
              <div class="min-w-0 flex-1">
                <div class="truncate text-sm font-medium text-gray-900 dark:text-white">
                  {{ container.type === 'app' ? (container.project?.name || container.name) : container.name }}
                </div>
                <div class="text-xs text-gray-500 dark:text-gray-400">{{ container.environment?.name }}</div>
              </div>

              <!-- Status dot -->
              <span class="h-2 w-2 shrink-0 rounded-full bg-emerald-500"></span>

              <!-- CPU -->
              <div class="hidden w-16 shrink-0 text-right sm:block">
                <div class="text-[10px] text-gray-400 dark:text-gray-500">CPU</div>
                <div v-if="container.metric" :class="['text-sm font-mono font-medium', cpuColor(container.metric.cpuPercent)]">
                  {{ container.metric.cpuPercent.toFixed(1) }}%
                </div>
                <div v-else class="text-xs text-gray-300 dark:text-gray-600">—</div>
              </div>

              <!-- Memory bar -->
              <div class="hidden w-36 shrink-0 sm:block">
                <div class="flex items-center justify-between">
                  <span class="text-[10px] text-gray-400 dark:text-gray-500">Mem</span>
                  <span v-if="container.metric" :class="['text-xs font-mono font-medium', memColor(container.metric.memoryPercent)]">
                    {{ container.metric.memoryPercent.toFixed(1) }}%
                  </span>
                </div>
                <div v-if="container.metric" class="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                  <div
                    :class="['h-full rounded-full transition-all', memBarColor(container.metric.memoryPercent)]"
                    :style="{ width: Math.min(container.metric.memoryPercent, 100) + '%' }"
                  ></div>
                </div>
                <div v-if="container.metric" class="mt-0.5 flex justify-between text-[10px] text-gray-400 dark:text-gray-500">
                  <span>{{ formatBytes(container.metric.memoryUsage) }}</span>
                  <span>{{ formatBytes(container.metric.memoryLimit) }}</span>
                </div>
                <div v-else class="text-xs text-gray-300 dark:text-gray-600">—</div>
              </div>

              <!-- Net I/O -->
              <div class="hidden w-28 shrink-0 text-right lg:block">
                <div class="text-[10px] text-gray-400 dark:text-gray-500">Net I/O</div>
                <div class="text-xs text-gray-600 dark:text-gray-400">{{ container.metric?.netIO || '—' }}</div>
              </div>

              <!-- Updated -->
              <div class="w-14 shrink-0 text-right">
                <div class="text-[10px] text-gray-400 dark:text-gray-500">{{ container.metric ? timeAgo(container.metric.recordedAt) : '' }}</div>
              </div>
            </Link>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
