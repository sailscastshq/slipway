<script setup>
import { Link, Head, router, usePoll } from '@inertiajs/vue3'
import { inject, ref, computed } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  project: Object,
  environment: Object,
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

// Expanded container for detail view
const expandedContainer = ref(null)
const detailMetrics = ref(null)
const loadingDetail = ref(false)

function toggleExpand(containerName) {
  if (expandedContainer.value === containerName) {
    expandedContainer.value = null
    detailMetrics.value = null
    return
  }
  expandedContainer.value = containerName
  loadDetailMetrics(containerName)
}

async function loadDetailMetrics(containerName) {
  loadingDetail.value = true
  try {
    const res = await fetch(`/api/v1/lookout/metrics/${encodeURIComponent(containerName)}`)
    if (res.ok) {
      const data = await res.json()
      detailMetrics.value = data.metrics
    }
  } catch (err) {
    // Silently fail
  } finally {
    loadingDetail.value = false
  }
}

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

/**
 * Generate SVG sparkline points from history array.
 * Returns a string for polyline points attribute.
 */
function sparklinePoints(history, key, width = 120, height = 24) {
  if (!history || history.length < 2) return ''
  const values = history.map(h => h[key])
  const max = Math.max(...values, 1)
  const step = width / (values.length - 1)
  return values.map((v, i) => `${i * step},${height - (v / max) * height}`).join(' ')
}

function sparklineColor(key) {
  return key === 'cpu' ? '#10b981' : '#3b82f6'
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

const logsUrl = computed(() => {
  return `/api/v1/projects/${props.project.slug}/environments/${props.environment.slug}/logs/stream`
})
</script>

<template>
  <Head :title="`Lookout - ${project.name} | Slipway`"></Head>
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
        <nav class="flex items-center space-x-2 text-sm">
          <Link href="/" class="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">
            projects
          </Link>
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
            {{ environment.name.toLowerCase() }}
          </Link>
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <span class="font-medium text-gray-900 dark:text-white">lookout</span>
        </nav>
      </div>
      <div class="flex items-center space-x-4">
        <a
          href="https://docs.sailscasts.com/slipway/lookout"
          target="_blank"
          class="flex items-center space-x-1 text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
        >
          <span>Docs</span>
          <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
      <div class="mx-auto max-w-5xl">
        <!-- Header -->
        <div class="mb-8">
          <h1 class="text-xl font-semibold text-gray-900 dark:text-white">Lookout</h1>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Container resource metrics for {{ environment.name }}.
          </p>
        </div>

        <!-- Empty state -->
        <div v-if="containers.length === 0" class="py-20 text-center">
          <svg class="mx-auto h-12 w-12 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <h3 class="mt-4 text-sm font-medium text-gray-900 dark:text-white">No running containers</h3>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Deploy your application to start monitoring resources.
          </p>
        </div>

        <!-- Container cards -->
        <div class="space-y-4">
          <div
            v-for="container in containers"
            :key="container.name"
            class="rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
          >
            <!-- Card header — clickable to expand -->
            <button
              @click="toggleExpand(container.name)"
              class="flex w-full items-center justify-between p-4 text-left"
            >
              <div class="flex items-center space-x-3">
                <!-- Type badge -->
                <span
                  v-if="container.type === 'app'"
                  class="inline-flex h-8 w-8 items-center justify-center rounded-md bg-brand/10 text-xs font-bold text-brand"
                >
                  AP
                </span>
                <span
                  v-else
                  class="inline-flex h-8 w-8 items-center justify-center rounded-md bg-gray-100 text-xs font-bold text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                >
                  {{ serviceIcon(container.serviceType) }}
                </span>

                <div>
                  <div class="text-sm font-medium text-gray-900 dark:text-white">
                    {{ container.type === 'app' ? 'Application' : container.serviceName || container.name }}
                  </div>
                  <div class="text-xs text-gray-500 dark:text-gray-400">
                    {{ container.name }}
                    <span v-if="container.imageName" class="ml-1 text-gray-400 dark:text-gray-500">
                      ({{ container.imageName }})
                    </span>
                  </div>
                </div>
              </div>

              <!-- Quick stats + sparklines -->
              <div class="flex items-center space-x-6">
                <!-- CPU sparkline -->
                <div v-if="container.history && container.history.length >= 2" class="hidden items-center space-x-3 sm:flex">
                  <div class="flex flex-col items-end">
                    <span class="text-[10px] text-gray-400 dark:text-gray-500">CPU</span>
                    <svg width="120" height="24" class="overflow-visible">
                      <polyline
                        :points="sparklinePoints(container.history, 'cpu')"
                        fill="none"
                        :stroke="sparklineColor('cpu')"
                        stroke-width="1.5"
                        stroke-linejoin="round"
                      />
                    </svg>
                  </div>
                  <!-- Memory sparkline -->
                  <div class="flex flex-col items-end">
                    <span class="text-[10px] text-gray-400 dark:text-gray-500">Mem</span>
                    <svg width="120" height="24" class="overflow-visible">
                      <polyline
                        :points="sparklinePoints(container.history, 'mem')"
                        fill="none"
                        :stroke="sparklineColor('mem')"
                        stroke-width="1.5"
                        stroke-linejoin="round"
                      />
                    </svg>
                  </div>
                </div>

                <!-- Current values -->
                <div v-if="container.metric" class="flex items-center space-x-4 text-right">
                  <div>
                    <div class="text-[10px] text-gray-400 dark:text-gray-500">CPU</div>
                    <div :class="['text-sm font-mono font-medium', cpuColor(container.metric.cpuPercent)]">
                      {{ container.metric.cpuPercent.toFixed(1) }}%
                    </div>
                  </div>
                  <div>
                    <div class="text-[10px] text-gray-400 dark:text-gray-500">Memory</div>
                    <div :class="['text-sm font-mono font-medium', memColor(container.metric.memoryPercent)]">
                      {{ container.metric.memoryPercent.toFixed(1) }}%
                    </div>
                  </div>
                </div>

                <!-- Expand chevron -->
                <svg
                  :class="['h-4 w-4 text-gray-400 transition-transform', expandedContainer === container.name ? 'rotate-180' : '']"
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>

            <!-- Expanded detail -->
            <Transition
              enter-active-class="transition-all duration-200 ease-out"
              enter-from-class="max-h-0 opacity-0"
              enter-to-class="max-h-[800px] opacity-100"
              leave-active-class="transition-all duration-150 ease-in"
              leave-from-class="max-h-[800px] opacity-100"
              leave-to-class="max-h-0 opacity-0"
            >
              <div v-if="expandedContainer === container.name" class="overflow-hidden border-t border-gray-100 dark:border-gray-800">
                <div class="p-4">
                  <!-- Loading state -->
                  <div v-if="loadingDetail" class="py-8 text-center text-sm text-gray-400 dark:text-gray-500">
                    Loading 24h history...
                  </div>

                  <!-- Detail metrics grid -->
                  <div v-else-if="container.metric" class="space-y-6">
                    <!-- Resource bars -->
                    <div class="grid gap-6 sm:grid-cols-2">
                      <!-- CPU -->
                      <div>
                        <div class="mb-2 flex items-center justify-between">
                          <span class="text-sm font-medium text-gray-700 dark:text-gray-300">CPU Usage</span>
                          <span :class="['text-lg font-mono font-semibold', cpuColor(container.metric.cpuPercent)]">
                            {{ container.metric.cpuPercent.toFixed(1) }}%
                          </span>
                        </div>
                        <div class="h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                          <div
                            class="h-full rounded-full bg-emerald-500 transition-all"
                            :style="{ width: Math.min(container.metric.cpuPercent, 100) + '%' }"
                          ></div>
                        </div>
                      </div>

                      <!-- Memory -->
                      <div>
                        <div class="mb-2 flex items-center justify-between">
                          <span class="text-sm font-medium text-gray-700 dark:text-gray-300">Memory Usage</span>
                          <span :class="['text-lg font-mono font-semibold', memColor(container.metric.memoryPercent)]">
                            {{ formatBytes(container.metric.memoryUsage) }} / {{ formatBytes(container.metric.memoryLimit) }}
                          </span>
                        </div>
                        <div class="h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                          <div
                            :class="['h-full rounded-full transition-all', memBarColor(container.metric.memoryPercent)]"
                            :style="{ width: Math.min(container.metric.memoryPercent, 100) + '%' }"
                          ></div>
                        </div>
                      </div>
                    </div>

                    <!-- Additional info -->
                    <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
                      <div class="rounded-md bg-gray-50 p-3 dark:bg-gray-800/50">
                        <div class="text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Network I/O</div>
                        <div class="mt-1 text-sm font-medium text-gray-900 dark:text-white">{{ container.metric.netIO || '—' }}</div>
                      </div>
                      <div class="rounded-md bg-gray-50 p-3 dark:bg-gray-800/50">
                        <div class="text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Block I/O</div>
                        <div class="mt-1 text-sm font-medium text-gray-900 dark:text-white">{{ container.metric.blockIO || '—' }}</div>
                      </div>
                      <div class="rounded-md bg-gray-50 p-3 dark:bg-gray-800/50">
                        <div class="text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Processes</div>
                        <div class="mt-1 text-sm font-medium text-gray-900 dark:text-white">{{ container.metric.pids ?? '—' }}</div>
                      </div>
                      <div class="rounded-md bg-gray-50 p-3 dark:bg-gray-800/50">
                        <div class="text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Last updated</div>
                        <div class="mt-1 text-sm font-medium text-gray-900 dark:text-white">{{ timeAgo(container.metric.recordedAt) }}</div>
                      </div>
                    </div>

                    <!-- 24h chart (simple SVG area chart) -->
                    <div v-if="detailMetrics && detailMetrics.length >= 2">
                      <h3 class="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">24-Hour History</h3>
                      <div class="grid gap-4 sm:grid-cols-2">
                        <!-- CPU chart -->
                        <div class="rounded-md border border-gray-100 p-3 dark:border-gray-800">
                          <div class="mb-2 text-xs text-gray-500 dark:text-gray-400">CPU %</div>
                          <svg :viewBox="`0 0 400 80`" class="w-full" preserveAspectRatio="none">
                            <polyline
                              :points="detailMetrics.map((m, i) => `${(i / (detailMetrics.length - 1)) * 400},${80 - (m.cpuPercent / Math.max(...detailMetrics.map(d => d.cpuPercent), 1)) * 80}`).join(' ')"
                              fill="none"
                              stroke="#10b981"
                              stroke-width="1.5"
                              vector-effect="non-scaling-stroke"
                            />
                          </svg>
                          <div class="mt-1 flex justify-between text-[10px] text-gray-400">
                            <span>{{ formatTime(detailMetrics[0].recordedAt) }}</span>
                            <span>{{ formatTime(detailMetrics[detailMetrics.length - 1].recordedAt) }}</span>
                          </div>
                        </div>
                        <!-- Memory chart -->
                        <div class="rounded-md border border-gray-100 p-3 dark:border-gray-800">
                          <div class="mb-2 text-xs text-gray-500 dark:text-gray-400">Memory %</div>
                          <svg :viewBox="`0 0 400 80`" class="w-full" preserveAspectRatio="none">
                            <polyline
                              :points="detailMetrics.map((m, i) => `${(i / (detailMetrics.length - 1)) * 400},${80 - (m.memoryPercent / Math.max(...detailMetrics.map(d => d.memoryPercent), 1)) * 80}`).join(' ')"
                              fill="none"
                              stroke="#3b82f6"
                              stroke-width="1.5"
                              vector-effect="non-scaling-stroke"
                            />
                          </svg>
                          <div class="mt-1 flex justify-between text-[10px] text-gray-400">
                            <span>{{ formatTime(detailMetrics[0].recordedAt) }}</span>
                            <span>{{ formatTime(detailMetrics[detailMetrics.length - 1].recordedAt) }}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <!-- Container actions -->
                    <div class="flex items-center space-x-3 border-t border-gray-100 pt-4 dark:border-gray-800">
                      <Link
                        v-if="container.type === 'app'"
                        :href="`/projects/${project.slug}/environments/${environment.slug}`"
                        class="text-xs text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                      >
                        View environment
                      </Link>
                    </div>
                  </div>

                  <!-- No metrics available -->
                  <div v-else class="py-8 text-center text-sm text-gray-400 dark:text-gray-500">
                    No metrics available yet. Metrics are collected every 30 seconds.
                  </div>
                </div>
              </div>
            </Transition>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
