<script setup>
import { Link, Head, router } from '@inertiajs/vue3'
import { inject, ref, computed, watch, onUnmounted } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'
import Breadcrumb from '@/components/Breadcrumb.vue'
import Spinner from '@/components/SlipwaySpinner.vue'
import { useQueryState } from '@/composables/useQueryState'
import { useEventSource } from '@/composables/sse'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  project: Object,
  environment: Object,
  appName: String,
  containers: {
    type: Array,
    default: () => []
  },
  telemetry: {
    type: Object,
    default: () => ({
      requests: {
        total: 0,
        errors: 0,
        errorRate: '0',
        p95: 0,
        avg: 0,
        recent: []
      },
      exceptions: { total: 0, groups: [] },
      queries: { slow: [], total: 0 },
      cache: {
        totalOps: 0,
        hits: 0,
        misses: 0,
        hitRate: '0',
        writes: 0,
        deletes: 0,
        topKeys: [],
        recent: []
      },
      flags: [],
      hasTelemetry: false,
      state: { state: 'not_detected' },
      telemetryToken: null
    })
  }
})

const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')

// Live-updating containers: initialized from Inertia props, updated via SSE
const liveContainers = ref(
  props.containers.map((c) => ({
    ...c,
    history: c.history ? [...c.history] : []
  }))
)
const liveTelemetryState = ref(props.telemetry.state)
const telemetryClock = ref(Date.now())
const telemetryClockTimer = setInterval(() => {
  telemetryClock.value = Date.now()
}, 30_000)
telemetryClockTimer.unref?.()
onUnmounted(() => clearInterval(telemetryClockTimer))

const effectiveTelemetryState = computed(() => {
  const status = liveTelemetryState.value || { state: 'not_detected' }
  if (
    ['connected_quiet', 'receiving'].includes(status.state) &&
    status.lastSeenAt &&
    status.staleAfterMs &&
    telemetryClock.value - Number(status.lastSeenAt) > status.staleAfterMs
  ) {
    return { ...status, state: 'stale' }
  }
  return status
})

// SSE: stream new metric snapshots instead of polling the entire page
const sseUrl = computed(
  () =>
    `/api/v1/projects/${props.project.slug}/environments/${props.environment.slug}/lookout/stream`
)

useEventSource(sseUrl, {
  onMessage(msg) {
    if (msg.telemetryState) {
      liveTelemetryState.value = msg.telemetryState
    }
    if (!msg.metrics) return
    const oneHourAgo = Date.now() - 60 * 60 * 1000
    for (const m of msg.metrics) {
      const container = liveContainers.value.find(
        (c) => c.name === m.containerName
      )
      if (!container) continue

      // Update latest metric snapshot
      container.metric = {
        cpuPercent: m.cpuPercent,
        memoryUsage: m.memoryUsage,
        memoryLimit: m.memoryLimit,
        memoryPercent: m.memoryPercent,
        netIO: m.netIO,
        blockIO: m.blockIO,
        pids: m.pids,
        recordedAt: m.recordedAt
      }

      // Append to sparkline history and trim to 1-hour window
      container.history.push({
        cpu: m.cpuPercent,
        mem: m.memoryPercent,
        t: m.recordedAt
      })
      while (
        container.history.length > 0 &&
        container.history[0].t < oneHourAgo
      ) {
        container.history.shift()
      }
    }
  }
})

// Tabs
const activeTab = useQueryState('tab', 'infrastructure')
const tabs = computed(() => {
  const list = [
    {
      id: 'infrastructure',
      label: 'Infrastructure',
      count: liveContainers.value.length
    }
  ]
  if (effectiveTelemetryState.value.state !== 'not_detected') {
    list.push(
      {
        id: 'requests',
        label: 'Requests',
        count: props.telemetry.requests.total
      },
      {
        id: 'exceptions',
        label: 'Exceptions',
        count: props.telemetry.exceptions.total
      },
      { id: 'queries', label: 'Queries', count: props.telemetry.queries.total }
    )
    if (props.telemetry.cache?.totalOps > 0) {
      list.push({
        id: 'cache',
        label: 'Cache',
        count: props.telemetry.cache.totalOps
      })
    }
  } else {
    list.push({ id: 'setup', label: 'Set up telemetry' })
  }
  return list
})

const telemetryNotice = computed(() => {
  const status = effectiveTelemetryState.value
  const notices = {
    connected_quiet: {
      tone: 'success',
      title: 'Connected — waiting for traffic',
      detail:
        'The Slipway hook is ready. Requests, exceptions, and queries will appear here as the app receives traffic.'
    },
    receiving: {
      tone: 'success',
      title: 'Receiving telemetry',
      detail: status.hookVersion
        ? `sails-hook-slipway ${status.hookVersion} is connected.`
        : 'The deployed app is connected.'
    },
    redeploy_required: {
      tone: 'warning',
      title: 'Redeploy to connect Lookout',
      detail:
        'The hook is present in the source, but the running deployment has not registered this version yet.'
    },
    stale: {
      tone: 'warning',
      title: 'Telemetry connection is stale',
      detail: status.lastSeenAt
        ? `Last heard from the app ${timeAgo(
            status.lastSeenAt
          )}. Check the running container and telemetry configuration.`
        : 'The app previously connected but is no longer sending its heartbeat.'
    },
    disabled: {
      tone: 'neutral',
      title: 'Telemetry is disabled',
      detail:
        'The hook is running, but Lookout telemetry is disabled in the app configuration.'
    },
    incompatible: {
      tone: 'warning',
      title: 'Update sails-hook-slipway',
      detail:
        'This hook version predates connection registration. Upgrade it, then redeploy the app.'
    }
  }
  return notices[status.state] || null
})

const telemetryNoticeClasses = computed(() => {
  const tone = telemetryNotice.value?.tone
  if (tone === 'success') {
    return {
      shell:
        'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/70 dark:bg-emerald-950/20',
      dot: 'bg-emerald-500',
      title: 'text-emerald-950 dark:text-emerald-100',
      detail: 'text-emerald-800/80 dark:text-emerald-300/80'
    }
  }
  if (tone === 'warning') {
    return {
      shell:
        'border-amber-200 bg-amber-50/70 dark:border-amber-900/70 dark:bg-amber-950/20',
      dot: 'bg-amber-500',
      title: 'text-amber-950 dark:text-amber-100',
      detail: 'text-amber-800/80 dark:text-amber-300/80'
    }
  }
  return {
    shell: 'border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900',
    dot: 'bg-gray-400 dark:bg-gray-500',
    title: 'text-gray-900 dark:text-white',
    detail: 'text-gray-500 dark:text-gray-400'
  }
})

watch(tabs, (availableTabs) => {
  if (!availableTabs.some((tab) => tab.id === activeTab.value)) {
    activeTab.value =
      availableTabs.find((tab) => tab.id !== 'infrastructure')?.id ||
      'infrastructure'
  }
})

// Expanded container for detail view (synced with URL query param)
const expandedContainer = useQueryState('container', '')
const detailMetrics = ref(null)
const loadingDetail = ref(false)

function toggleExpand(containerName) {
  if (expandedContainer.value === containerName) {
    expandedContainer.value = ''
    detailMetrics.value = null
    return
  }
  expandedContainer.value = containerName
  loadDetailMetrics(containerName)
}

// Load detail metrics when page opens with ?container= in URL
watch(expandedContainer, (name) => {
  if (name && !detailMetrics.value) {
    loadDetailMetrics(name)
  }
})

async function loadDetailMetrics(containerName) {
  loadingDetail.value = true
  try {
    const res = await fetch(
      `/api/v1/lookout/metrics/${encodeURIComponent(containerName)}`
    )
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

// Request filtering & search
const requestSearch = useQueryState('q', '', { replace: true })
const requestMethodFilter = useQueryState('method', '', { replace: true })
const requestStatusFilter = useQueryState('status', '', { replace: true })

const filteredRequests = computed(() => {
  let list = props.telemetry.requests.recent
  if (requestSearch.value) {
    const q = requestSearch.value.toLowerCase()
    list = list.filter(
      (r) =>
        (r.url || r.name || '').toLowerCase().includes(q) ||
        (r.traceId || '').toLowerCase().includes(q)
    )
  }
  if (requestMethodFilter.value) {
    list = list.filter((r) => r.method === requestMethodFilter.value)
  }
  if (requestStatusFilter.value) {
    const group = requestStatusFilter.value
    list = list.filter((r) => {
      if (group === '2xx') return r.statusCode >= 200 && r.statusCode < 300
      if (group === '3xx') return r.statusCode >= 300 && r.statusCode < 400
      if (group === '4xx') return r.statusCode >= 400 && r.statusCode < 500
      if (group === '5xx') return r.statusCode >= 500
      return true
    })
  }
  return list
})

const activeMethods = computed(() => {
  const methods = new Set(props.telemetry.requests.recent.map((r) => r.method))
  return [...methods].sort()
})

function toggleRequestMethodFilter(method) {
  requestMethodFilter.value = requestMethodFilter.value === method ? '' : method
}

// Request detail (durable via URL query param)
const expandedRequest = useQueryState('request', '', { replace: true })

function toggleRequest(traceId) {
  expandedRequest.value = expandedRequest.value === traceId ? '' : traceId
}

function requestFlags(request) {
  return Object.entries(request.attributes?.['feature.flags'] || {}).map(
    ([key, evaluation]) => ({ key, ...evaluation })
  )
}

// Exception detail
const expandedException = ref(null)

function toggleException(idx) {
  expandedException.value = expandedException.value === idx ? null : idx
}

// Helpers
function compactNumber(n) {
  if (n < 1000) return String(n)
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`
  if (n < 1000000) return `${Math.round(n / 1000)}k`
  return `${(n / 1000000).toFixed(1)}M`
}

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

function methodBg(method) {
  const m = (method || '').toUpperCase()
  if (m === 'GET')
    return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400'
  if (m === 'POST')
    return 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400'
  if (m === 'PUT' || m === 'PATCH')
    return 'bg-yellow-50 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400'
  if (m === 'DELETE')
    return 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'
  return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
}

function statusColor(code) {
  if (code >= 500) return 'text-red-600 dark:text-red-400'
  if (code >= 400) return 'text-yellow-600 dark:text-yellow-400'
  if (code >= 300) return 'text-blue-600 dark:text-blue-400'
  return 'text-emerald-600 dark:text-emerald-400'
}

function statusBg(code) {
  if (code >= 500)
    return 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'
  if (code >= 400)
    return 'bg-yellow-50 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400'
  return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400'
}

function durationColor(ms) {
  if (ms > 2000) return 'text-red-600 dark:text-red-400'
  if (ms > 500) return 'text-yellow-600 dark:text-yellow-400'
  return 'text-gray-600 dark:text-gray-400'
}

function timeAgo(timestamp) {
  if (!timestamp) return ''
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  })
}

function formatDuration(ms) {
  if (ms < 1) return '<1ms'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function serviceIcon(type) {
  const icons = { postgresql: 'PG', mysql: 'My', redis: 'Rd', mongodb: 'Mg' }
  return icons[type] || 'Sv'
}

function cacheOpBg(name) {
  if (name === 'cache.hit')
    return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400'
  if (name === 'cache.miss')
    return 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'
  if (name === 'cache.write')
    return 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400'
  return 'bg-gray-50 text-gray-700 dark:bg-gray-900/20 dark:text-gray-400'
}

function cacheOpLabel(name) {
  if (name === 'cache.hit') return 'HIT'
  if (name === 'cache.miss') return 'MISS'
  if (name === 'cache.write') return 'SET'
  if (name === 'cache.delete') return 'DEL'
  return name
}

function hitRateColor(rate) {
  const r = parseFloat(rate)
  if (r > 80) return 'text-emerald-600 dark:text-emerald-400'
  if (r > 50) return 'text-yellow-600 dark:text-yellow-400'
  return 'text-red-600 dark:text-red-400'
}

function sparklinePoints(history, key, width = 120, height = 24) {
  if (!history || history.length < 2) return ''
  const values = history.map((h) => h[key])
  const max = Math.max(...values, 1)
  const step = width / (values.length - 1)
  return values
    .map((v, i) => `${i * step},${height - (v / max) * height}`)
    .join(' ')
}

function sparklineColor(key) {
  return key === 'cpu' ? '#10b981' : '#3b82f6'
}

function highlightQuery(query) {
  if (!query) return ''
  const escaped = query
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return (
    escaped
      // model.method( → model in pink, method in blue
      .replace(
        /^(\w+)\.(\w+)/,
        '<span class="text-pink-600 dark:text-pink-400">$1</span>.<span class="text-blue-600 dark:text-blue-400">$2</span>'
      )
      // { keys } → keys in amber
      .replace(
        /\{([^}]+)\}/g,
        (_, inner) =>
          `{ <span class="text-amber-600 dark:text-amber-400">${inner.trim()}</span> }`
      )
  )
}

function cleanIp(ip) {
  if (!ip) return ''
  return ip.replace(/^::ffff:/, '')
}

// Chart hover (throttled to one update per animation frame)
const chartHover = ref(null)
let hoverRaf = null

function onChartHover(event, data, key, chartId) {
  if (hoverRaf) return
  // Capture event values synchronously — currentTarget is null after handler returns
  const svg = event.currentTarget
  const clientX = event.clientX
  hoverRaf = requestAnimationFrame(() => {
    hoverRaf = null
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const fraction = Math.max(
      0,
      Math.min(1, (clientX - rect.left) / rect.width)
    )
    const nearest = Math.round(fraction * (data.length - 1))
    // Snap to local peak within ±5 points so spikes are easier to inspect
    const lo = Math.max(0, nearest - 5)
    const hi = Math.min(data.length - 1, nearest + 5)
    let index = nearest
    for (let i = lo; i <= hi; i++) {
      if (data[i][key] > data[index][key]) index = i
    }
    const item = data[index]
    if (!item) return
    const value = item[key]
    const wrapper = svg.parentElement
    const wrapperRect = wrapper.getBoundingClientRect()
    const x = clientX - wrapperRect.left
    const w = wrapperRect.width
    // Clamp tooltip center so it stays within chart bounds
    const isDetail = chartId.startsWith('detail-')
    const tipHalf = isDetail ? 70 : 25
    const tipX = Math.max(tipHalf, Math.min(x, w - tipHalf))
    chartHover.value = {
      chartId,
      index,
      x: tipX,
      value: typeof value === 'number' ? value.toFixed(1) : value,
      label: item.recordedAt ? formatTime(item.recordedAt) : null
    }
  })
}

function onChartLeave() {
  if (hoverRaf) {
    cancelAnimationFrame(hoverRaf)
    hoverRaf = null
  }
  chartHover.value = null
}

// Cached max values — recomputed only when data changes, not on every mousemove
const sparklineMaxCache = new WeakMap()

function getSparklineMax(history, key) {
  let cache = sparklineMaxCache.get(history)
  if (!cache) {
    cache = {}
    sparklineMaxCache.set(history, cache)
  }
  if (cache[key] === undefined) {
    let max = 1
    for (let i = 0; i < history.length; i++) {
      if (history[i][key] > max) max = history[i][key]
    }
    cache[key] = max
  }
  return cache[key]
}

function sparklineHoverPoint(history, key, index, width = 120, height = 24) {
  const max = getSparklineMax(history, key)
  const step = width / (history.length - 1)
  return { x: index * step, y: height - (history[index][key] / max) * height }
}

const detailMaxCache = new WeakMap()

function getDetailMax(data, key) {
  let cache = detailMaxCache.get(data)
  if (!cache) {
    cache = {}
    detailMaxCache.set(data, cache)
  }
  if (cache[key] === undefined) {
    let max = 1
    for (let i = 0; i < data.length; i++) {
      if (data[i][key] > max) max = data[i][key]
    }
    cache[key] = max
  }
  return cache[key]
}

function detailHoverPoint(data, key, index) {
  const max = getDetailMax(data, key)
  const x = (index / (data.length - 1)) * 400
  const y = 80 - (data[index][key] / max) * 80
  return { x, y }
}

function detailChartPoints(data, key) {
  const max = getDetailMax(data, key)
  return data
    .map(
      (m, i) => `${(i / (data.length - 1)) * 400},${80 - (m[key] / max) * 80}`
    )
    .join(' ')
}

const copiedTraceId = ref(null)
async function copyTraceId(traceId) {
  await navigator.clipboard.writeText(traceId)
  copiedTraceId.value = traceId
  setTimeout(() => {
    copiedTraceId.value = null
  }, 2000)
}

const logsUrl = computed(() => {
  return `/api/v1/projects/${props.project.slug}/environments/${props.environment.slug}/logs/stream`
})

// Copy to clipboard
const copied = ref(false)
async function copyToken() {
  if (!props.telemetry.telemetryToken) return
  await navigator.clipboard.writeText(props.telemetry.telemetryToken)
  copied.value = true
  setTimeout(() => {
    copied.value = false
  }, 2000)
}
</script>

<template>
  <Head :title="`Lookout - ${project.name} | Slipway`"></Head>
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
        <Breadcrumb
          :items="[
            { label: 'projects', href: '/' },
            {
              label: project.name.toLowerCase(),
              href: `/projects/${project.slug}`
            },
            {
              label: environment.name.toLowerCase(),
              href: `/projects/${project.slug}/environments/${environment.slug}`
            },
            { label: 'lookout' }
          ]"
        />
      </div>
      <div class="flex items-center space-x-4">
        <a
          href="https://docs.sailscasts.com/slipway/lookout"
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

    <!-- Content -->
    <div class="flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
      <div class="mx-auto max-w-5xl">
        <!-- Header -->
        <div class="mb-6">
          <h1 class="text-xl font-semibold text-gray-900 dark:text-white">
            Lookout
          </h1>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Observability for {{ appName }}.
          </p>
        </div>

        <div
          v-if="telemetryNotice"
          :class="telemetryNoticeClasses.shell"
          class="mb-6 flex items-start gap-3 rounded-lg border px-4 py-3"
        >
          <span
            :class="telemetryNoticeClasses.dot"
            class="mt-1.5 h-2 w-2 shrink-0 rounded-full"
          ></span>
          <div class="min-w-0">
            <p
              :class="telemetryNoticeClasses.title"
              class="text-sm font-medium"
            >
              {{ telemetryNotice.title }}
            </p>
            <p
              :class="telemetryNoticeClasses.detail"
              class="mt-0.5 text-xs leading-5"
            >
              {{ telemetryNotice.detail }}
            </p>
          </div>
        </div>

        <!-- Tabs -->
        <div class="mb-6 border-b border-gray-200 dark:border-gray-800">
          <nav class="-mb-px flex space-x-6">
            <button
              v-for="tab in tabs"
              :key="tab.id"
              @click="activeTab = tab.id"
              :class="[
                'flex items-center space-x-1.5 border-b-2 pb-3 text-sm font-medium transition-colors',
                activeTab === tab.id
                  ? 'border-gray-900 text-gray-900 dark:border-white dark:text-white'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:text-gray-300'
              ]"
            >
              <span>{{ tab.label }}</span>
              <span
                v-if="tab.count !== undefined"
                :class="[
                  'rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                  activeTab === tab.id
                    ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                ]"
                >{{ compactNumber(tab.count) }}</span
              >
            </button>
          </nav>
        </div>

        <!-- INFRASTRUCTURE TAB -->
        <div v-if="activeTab === 'infrastructure'">
          <!-- Empty state -->
          <div v-if="liveContainers.length === 0" class="py-20 text-center">
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
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
              />
            </svg>
            <h3 class="mt-4 text-sm font-medium text-gray-900 dark:text-white">
              No running containers
            </h3>
            <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Deploy your application to start monitoring resources.
            </p>
          </div>

          <!-- Container list -->
          <div class="space-y-4">
            <div
              v-for="container in liveContainers"
              :key="container.name"
              class="rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
            >
              <!-- Card header -->
              <button
                @click="toggleExpand(container.name)"
                class="flex w-full items-center justify-between p-4 text-left"
              >
                <div class="flex items-center space-x-3">
                  <span
                    v-if="container.type === 'app'"
                    class="bg-brand/10 text-brand inline-flex h-8 w-8 items-center justify-center rounded-md text-xs font-bold"
                    >AP</span
                  >
                  <span
                    v-else
                    class="inline-flex h-8 w-8 items-center justify-center rounded-md bg-gray-100 text-xs font-bold text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                    >{{ serviceIcon(container.serviceType) }}</span
                  >

                  <div>
                    <div
                      class="text-sm font-medium text-gray-900 dark:text-white"
                    >
                      {{
                        container.type === 'app'
                          ? 'Application'
                          : container.serviceName || container.name
                      }}
                    </div>
                    <div class="text-xs text-gray-500 dark:text-gray-400">
                      {{ container.name }}
                    </div>
                  </div>
                </div>

                <div class="flex items-center space-x-6">
                  <!-- Sparklines -->
                  <div
                    v-if="container.history && container.history.length >= 2"
                    class="hidden items-center space-x-3 sm:flex"
                  >
                    <div class="flex flex-col items-end">
                      <span class="text-[10px] text-gray-400 dark:text-gray-500"
                        >CPU</span
                      >
                      <div class="relative">
                        <svg
                          width="120"
                          height="24"
                          class="overflow-visible"
                          @mousemove="
                            onChartHover(
                              $event,
                              container.history,
                              'cpu',
                              'spark-cpu-' + container.name
                            )
                          "
                          @mouseleave="onChartLeave"
                        >
                          <polyline
                            :points="sparklinePoints(container.history, 'cpu')"
                            fill="none"
                            :stroke="sparklineColor('cpu')"
                            stroke-width="1.5"
                            stroke-linejoin="round"
                          />
                          <circle
                            v-if="
                              chartHover?.chartId ===
                              'spark-cpu-' + container.name
                            "
                            :cx="
                              sparklineHoverPoint(
                                container.history,
                                'cpu',
                                chartHover.index
                              ).x
                            "
                            :cy="
                              sparklineHoverPoint(
                                container.history,
                                'cpu',
                                chartHover.index
                              ).y
                            "
                            r="3"
                            fill="#10b981"
                          />
                        </svg>
                        <div
                          v-if="
                            chartHover?.chartId ===
                            'spark-cpu-' + container.name
                          "
                          class="pointer-events-none absolute z-10 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white shadow-lg dark:bg-white dark:text-gray-900"
                          :style="{
                            left: chartHover.x + 'px',
                            bottom: '100%',
                            transform: 'translateX(-50%)',
                            marginBottom: '4px'
                          }"
                        >
                          {{ chartHover.value }}%
                        </div>
                      </div>
                    </div>
                    <div class="flex flex-col items-end">
                      <span class="text-[10px] text-gray-400 dark:text-gray-500"
                        >Mem</span
                      >
                      <div class="relative">
                        <svg
                          width="120"
                          height="24"
                          class="overflow-visible"
                          @mousemove="
                            onChartHover(
                              $event,
                              container.history,
                              'mem',
                              'spark-mem-' + container.name
                            )
                          "
                          @mouseleave="onChartLeave"
                        >
                          <polyline
                            :points="sparklinePoints(container.history, 'mem')"
                            fill="none"
                            :stroke="sparklineColor('mem')"
                            stroke-width="1.5"
                            stroke-linejoin="round"
                          />
                          <circle
                            v-if="
                              chartHover?.chartId ===
                              'spark-mem-' + container.name
                            "
                            :cx="
                              sparklineHoverPoint(
                                container.history,
                                'mem',
                                chartHover.index
                              ).x
                            "
                            :cy="
                              sparklineHoverPoint(
                                container.history,
                                'mem',
                                chartHover.index
                              ).y
                            "
                            r="3"
                            fill="#3b82f6"
                          />
                        </svg>
                        <div
                          v-if="
                            chartHover?.chartId ===
                            'spark-mem-' + container.name
                          "
                          class="pointer-events-none absolute z-10 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white shadow-lg dark:bg-white dark:text-gray-900"
                          :style="{
                            left: chartHover.x + 'px',
                            bottom: '100%',
                            transform: 'translateX(-50%)',
                            marginBottom: '4px'
                          }"
                        >
                          {{ chartHover.value }}%
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- Current values -->
                  <div
                    v-if="container.metric"
                    class="flex items-center space-x-4 text-right"
                  >
                    <div>
                      <div class="text-[10px] text-gray-400 dark:text-gray-500">
                        CPU
                      </div>
                      <div
                        :class="[
                          'font-mono text-sm font-medium',
                          cpuColor(container.metric.cpuPercent)
                        ]"
                      >
                        {{ container.metric.cpuPercent.toFixed(1) }}%
                      </div>
                    </div>
                    <div>
                      <div class="text-[10px] text-gray-400 dark:text-gray-500">
                        Memory
                      </div>
                      <div
                        :class="[
                          'font-mono text-sm font-medium',
                          memColor(container.metric.memoryPercent)
                        ]"
                      >
                        {{ container.metric.memoryPercent.toFixed(1) }}%
                      </div>
                    </div>
                  </div>

                  <svg
                    :class="[
                      'h-4 w-4 text-gray-400 transition-transform',
                      expandedContainer === container.name ? 'rotate-180' : ''
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
                <div
                  v-if="expandedContainer === container.name"
                  class="overflow-hidden border-t border-gray-100 dark:border-gray-800"
                >
                  <div class="p-4">
                    <div v-if="loadingDetail" class="py-8 text-center">
                      <Spinner
                        class="mx-auto mb-2 h-5 w-5 text-gray-400 dark:text-gray-500"
                      />
                      <p class="text-sm text-gray-400 dark:text-gray-500">
                        Loading 24h history...
                      </p>
                    </div>

                    <div v-else-if="container.metric" class="space-y-6">
                      <!-- Resource bars -->
                      <div class="grid gap-6 sm:grid-cols-2">
                        <div>
                          <div class="mb-2 flex items-center justify-between">
                            <span
                              class="text-sm font-medium text-gray-700 dark:text-gray-300"
                              >CPU Usage</span
                            >
                            <span
                              :class="[
                                'font-mono text-lg font-semibold',
                                cpuColor(container.metric.cpuPercent)
                              ]"
                            >
                              {{ container.metric.cpuPercent.toFixed(1) }}%
                            </span>
                          </div>
                          <div
                            class="h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800"
                          >
                            <div
                              class="h-full rounded-full bg-emerald-500 transition-all"
                              :style="{
                                width:
                                  Math.min(container.metric.cpuPercent, 100) +
                                  '%'
                              }"
                            ></div>
                          </div>
                        </div>
                        <div>
                          <div class="mb-2 flex items-center justify-between">
                            <span
                              class="text-sm font-medium text-gray-700 dark:text-gray-300"
                              >Memory Usage</span
                            >
                            <span
                              :class="[
                                'font-mono text-lg font-semibold',
                                memColor(container.metric.memoryPercent)
                              ]"
                            >
                              {{ formatBytes(container.metric.memoryUsage) }} /
                              {{ formatBytes(container.metric.memoryLimit) }}
                            </span>
                          </div>
                          <div
                            class="h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800"
                          >
                            <div
                              :class="[
                                'h-full rounded-full transition-all',
                                memBarColor(container.metric.memoryPercent)
                              ]"
                              :style="{
                                width:
                                  Math.min(
                                    container.metric.memoryPercent,
                                    100
                                  ) + '%'
                              }"
                            ></div>
                          </div>
                        </div>
                      </div>

                      <!-- Info grid -->
                      <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
                        <div
                          class="rounded-md bg-gray-50 p-3 dark:bg-gray-800/50"
                        >
                          <div
                            class="text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400"
                          >
                            Network I/O
                          </div>
                          <div
                            class="mt-1 text-sm font-medium text-gray-900 dark:text-white"
                          >
                            {{ container.metric.netIO || '—' }}
                          </div>
                        </div>
                        <div
                          class="rounded-md bg-gray-50 p-3 dark:bg-gray-800/50"
                        >
                          <div
                            class="text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400"
                          >
                            Block I/O
                          </div>
                          <div
                            class="mt-1 text-sm font-medium text-gray-900 dark:text-white"
                          >
                            {{ container.metric.blockIO || '—' }}
                          </div>
                        </div>
                        <div
                          class="rounded-md bg-gray-50 p-3 dark:bg-gray-800/50"
                        >
                          <div
                            class="text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400"
                          >
                            Processes
                          </div>
                          <div
                            class="mt-1 text-sm font-medium text-gray-900 dark:text-white"
                          >
                            {{ container.metric.pids ?? '—' }}
                          </div>
                        </div>
                        <div
                          class="rounded-md bg-gray-50 p-3 dark:bg-gray-800/50"
                        >
                          <div
                            class="text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400"
                          >
                            Last updated
                          </div>
                          <div
                            class="mt-1 text-sm font-medium text-gray-900 dark:text-white"
                          >
                            {{ timeAgo(container.metric.recordedAt) }}
                          </div>
                        </div>
                      </div>

                      <!-- 24h chart -->
                      <div v-if="detailMetrics && detailMetrics.length >= 2">
                        <h3
                          class="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300"
                        >
                          24-Hour History
                        </h3>
                        <div class="grid gap-4 sm:grid-cols-2">
                          <div
                            class="rounded-md border border-gray-100 p-3 dark:border-gray-800"
                          >
                            <div
                              class="mb-2 text-xs text-gray-500 dark:text-gray-400"
                            >
                              CPU %
                            </div>
                            <div class="relative">
                              <svg
                                :viewBox="`0 0 400 80`"
                                class="w-full overflow-visible"
                                preserveAspectRatio="none"
                                @mousemove="
                                  onChartHover(
                                    $event,
                                    detailMetrics,
                                    'cpuPercent',
                                    'detail-cpu'
                                  )
                                "
                                @mouseleave="onChartLeave"
                              >
                                <polyline
                                  :points="
                                    detailChartPoints(
                                      detailMetrics,
                                      'cpuPercent'
                                    )
                                  "
                                  fill="none"
                                  stroke="#10b981"
                                  stroke-width="1.5"
                                  vector-effect="non-scaling-stroke"
                                />
                                <template
                                  v-if="chartHover?.chartId === 'detail-cpu'"
                                >
                                  <line
                                    :x1="
                                      detailHoverPoint(
                                        detailMetrics,
                                        'cpuPercent',
                                        chartHover.index
                                      ).x
                                    "
                                    :x2="
                                      detailHoverPoint(
                                        detailMetrics,
                                        'cpuPercent',
                                        chartHover.index
                                      ).x
                                    "
                                    y1="0"
                                    y2="80"
                                    stroke="#9ca3af"
                                    stroke-width="1"
                                    stroke-dasharray="3 2"
                                    vector-effect="non-scaling-stroke"
                                  />
                                  <circle
                                    :cx="
                                      detailHoverPoint(
                                        detailMetrics,
                                        'cpuPercent',
                                        chartHover.index
                                      ).x
                                    "
                                    :cy="
                                      detailHoverPoint(
                                        detailMetrics,
                                        'cpuPercent',
                                        chartHover.index
                                      ).y
                                    "
                                    r="4"
                                    fill="#10b981"
                                    stroke="white"
                                    stroke-width="2"
                                    vector-effect="non-scaling-stroke"
                                  />
                                </template>
                              </svg>
                              <div
                                v-if="chartHover?.chartId === 'detail-cpu'"
                                class="pointer-events-none absolute z-10 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white shadow-lg dark:bg-white dark:text-gray-900"
                                :style="{
                                  left: chartHover.x + 'px',
                                  bottom: '100%',
                                  transform: 'translateX(-50%)',
                                  marginBottom: '12px'
                                }"
                              >
                                {{ chartHover.value }}%
                                <span
                                  v-if="chartHover.label"
                                  class="ml-1 text-gray-400 dark:text-gray-500"
                                  >{{ chartHover.label }}</span
                                >
                              </div>
                            </div>
                            <div
                              class="mt-1 flex justify-between text-[10px] text-gray-400"
                            >
                              <span>{{
                                formatTime(detailMetrics[0].recordedAt)
                              }}</span>
                              <span>{{
                                formatTime(
                                  detailMetrics[detailMetrics.length - 1]
                                    .recordedAt
                                )
                              }}</span>
                            </div>
                          </div>
                          <div
                            class="rounded-md border border-gray-100 p-3 dark:border-gray-800"
                          >
                            <div
                              class="mb-2 text-xs text-gray-500 dark:text-gray-400"
                            >
                              Memory %
                            </div>
                            <div class="relative">
                              <svg
                                :viewBox="`0 0 400 80`"
                                class="w-full overflow-visible"
                                preserveAspectRatio="none"
                                @mousemove="
                                  onChartHover(
                                    $event,
                                    detailMetrics,
                                    'memoryPercent',
                                    'detail-mem'
                                  )
                                "
                                @mouseleave="onChartLeave"
                              >
                                <polyline
                                  :points="
                                    detailChartPoints(
                                      detailMetrics,
                                      'memoryPercent'
                                    )
                                  "
                                  fill="none"
                                  stroke="#3b82f6"
                                  stroke-width="1.5"
                                  vector-effect="non-scaling-stroke"
                                />
                                <template
                                  v-if="chartHover?.chartId === 'detail-mem'"
                                >
                                  <line
                                    :x1="
                                      detailHoverPoint(
                                        detailMetrics,
                                        'memoryPercent',
                                        chartHover.index
                                      ).x
                                    "
                                    :x2="
                                      detailHoverPoint(
                                        detailMetrics,
                                        'memoryPercent',
                                        chartHover.index
                                      ).x
                                    "
                                    y1="0"
                                    y2="80"
                                    stroke="#9ca3af"
                                    stroke-width="1"
                                    stroke-dasharray="3 2"
                                    vector-effect="non-scaling-stroke"
                                  />
                                  <circle
                                    :cx="
                                      detailHoverPoint(
                                        detailMetrics,
                                        'memoryPercent',
                                        chartHover.index
                                      ).x
                                    "
                                    :cy="
                                      detailHoverPoint(
                                        detailMetrics,
                                        'memoryPercent',
                                        chartHover.index
                                      ).y
                                    "
                                    r="4"
                                    fill="#3b82f6"
                                    stroke="white"
                                    stroke-width="2"
                                    vector-effect="non-scaling-stroke"
                                  />
                                </template>
                              </svg>
                              <div
                                v-if="chartHover?.chartId === 'detail-mem'"
                                class="pointer-events-none absolute z-10 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white shadow-lg dark:bg-white dark:text-gray-900"
                                :style="{
                                  left: chartHover.x + 'px',
                                  bottom: '100%',
                                  transform: 'translateX(-50%)',
                                  marginBottom: '12px'
                                }"
                              >
                                {{ chartHover.value }}%
                                <span
                                  v-if="chartHover.label"
                                  class="ml-1 text-gray-400 dark:text-gray-500"
                                  >{{ chartHover.label }}</span
                                >
                              </div>
                            </div>
                            <div
                              class="mt-1 flex justify-between text-[10px] text-gray-400"
                            >
                              <span>{{
                                formatTime(detailMetrics[0].recordedAt)
                              }}</span>
                              <span>{{
                                formatTime(
                                  detailMetrics[detailMetrics.length - 1]
                                    .recordedAt
                                )
                              }}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div
                      v-else
                      class="py-8 text-center text-sm text-gray-400 dark:text-gray-500"
                    >
                      No metrics available yet. Metrics are collected every 30
                      seconds.
                    </div>
                  </div>
                </div>
              </Transition>
            </div>
          </div>
        </div>

        <!-- REQUESTS TAB -->
        <div v-if="activeTab === 'requests'">
          <!-- Summary cards -->
          <div class="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div
              class="rounded-lg border border-gray-200 p-4 dark:border-gray-800"
            >
              <div
                class="text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400"
              >
                Requests / hr
              </div>
              <div
                class="mt-1 text-2xl font-semibold tabular-nums text-gray-900 dark:text-white"
              >
                {{ telemetry.requests.total }}
              </div>
            </div>
            <div
              class="rounded-lg border border-gray-200 p-4 dark:border-gray-800"
            >
              <div
                class="text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400"
              >
                Error rate
              </div>
              <div
                :class="[
                  'mt-1 text-2xl font-semibold tabular-nums',
                  parseFloat(telemetry.requests.errorRate) > 5
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-gray-900 dark:text-white'
                ]"
              >
                {{ telemetry.requests.errorRate }}%
              </div>
            </div>
            <div
              class="rounded-lg border border-gray-200 p-4 dark:border-gray-800"
            >
              <div
                class="text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400"
              >
                p95 latency
              </div>
              <div
                :class="[
                  'mt-1 text-2xl font-semibold tabular-nums',
                  telemetry.requests.p95 > 2000
                    ? 'text-red-600 dark:text-red-400'
                    : telemetry.requests.p95 > 500
                    ? 'text-yellow-600 dark:text-yellow-400'
                    : 'text-gray-900 dark:text-white'
                ]"
              >
                {{ formatDuration(telemetry.requests.p95) }}
              </div>
            </div>
            <div
              class="rounded-lg border border-gray-200 p-4 dark:border-gray-800"
            >
              <div
                class="text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400"
              >
                Avg latency
              </div>
              <div
                class="mt-1 text-2xl font-semibold tabular-nums text-gray-900 dark:text-white"
              >
                {{ formatDuration(telemetry.requests.avg) }}
              </div>
            </div>
          </div>

          <!-- Release flag comparison -->
          <div v-if="telemetry.flags?.length" class="mb-6">
            <h3
              class="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Release flags
            </h3>
            <div
              class="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800"
            >
              <div
                class="grid grid-cols-[minmax(0,1fr)_repeat(2,minmax(110px,auto))] gap-4 bg-gray-50 px-4 py-2 text-[10px] font-medium uppercase tracking-wider text-gray-400 dark:bg-gray-900 dark:text-gray-500"
              >
                <span>Flag</span>
                <span>On</span>
                <span>Off</span>
              </div>
              <div
                v-for="flag in telemetry.flags"
                :key="flag.key"
                class="grid grid-cols-[minmax(0,1fr)_repeat(2,minmax(110px,auto))] gap-4 border-t border-gray-100 px-4 py-2.5 text-xs dark:border-gray-800"
              >
                <code
                  class="truncate font-medium text-gray-900 dark:text-white"
                  >{{ flag.key }}</code
                >
                <span class="text-gray-500 dark:text-gray-400">
                  {{ flag.on.requests }} req ·
                  {{ flag.on.avg === null ? '—' : formatDuration(flag.on.avg) }}
                  <template v-if="flag.on.errorRate !== null">
                    · {{ flag.on.errorRate }}% err</template
                  >
                  <template v-if="flag.on.exceptions">
                    · {{ flag.on.exceptions }} exc</template
                  >
                </span>
                <span class="text-gray-500 dark:text-gray-400">
                  {{ flag.off.requests }} req ·
                  {{
                    flag.off.avg === null ? '—' : formatDuration(flag.off.avg)
                  }}
                  <template v-if="flag.off.errorRate !== null">
                    · {{ flag.off.errorRate }}% err</template
                  >
                  <template v-if="flag.off.exceptions">
                    · {{ flag.off.exceptions }} exc</template
                  >
                </span>
              </div>
            </div>
          </div>

          <!-- Recent requests -->
          <div v-if="telemetry.requests.recent.length > 0">
            <!-- Search & filters -->
            <div
              class="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <h3 class="text-sm font-medium text-gray-700 dark:text-gray-300">
                Recent requests
              </h3>
              <div class="flex items-center gap-2">
                <!-- Method filter pills -->
                <div class="flex items-center gap-1">
                  <button
                    @click="requestMethodFilter = ''"
                    :class="[
                      'rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors',
                      !requestMethodFilter
                        ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                        : 'bg-gray-100 text-gray-500 hover:text-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:text-gray-300'
                    ]"
                  >
                    All
                  </button>
                  <button
                    v-for="m in activeMethods"
                    :key="m"
                    @click="toggleRequestMethodFilter(m)"
                    :class="[
                      'rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors',
                      requestMethodFilter === m
                        ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                        : 'bg-gray-100 text-gray-500 hover:text-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:text-gray-300'
                    ]"
                  >
                    {{ m }}
                  </button>
                </div>
                <!-- Status filter -->
                <select
                  :value="requestStatusFilter"
                  @change="requestStatusFilter = $event.target.value"
                  class="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400"
                >
                  <option value="">Any status</option>
                  <option value="2xx">2xx</option>
                  <option value="3xx">3xx</option>
                  <option value="4xx">4xx</option>
                  <option value="5xx">5xx</option>
                </select>
                <!-- Search -->
                <div class="relative">
                  <svg
                    class="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                    />
                  </svg>
                  <input
                    v-model="requestSearch"
                    type="text"
                    placeholder="URL or trace ID..."
                    class="w-40 rounded border border-gray-200 bg-white py-0.5 pl-6 pr-2 text-[11px] text-gray-700 placeholder-gray-400 focus:border-gray-400 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:placeholder-gray-500 dark:focus:border-gray-600"
                  />
                </div>
              </div>
            </div>

            <div
              class="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800"
            >
              <div
                v-for="(req, i) in filteredRequests"
                :key="req.traceId || i"
                :class="[
                  i > 0 ? 'border-t border-gray-100 dark:border-gray-800' : ''
                ]"
              >
                <button
                  @click="toggleRequest(req.traceId)"
                  class="flex w-full items-center gap-3 px-4 py-2.5 text-left"
                >
                  <!-- Method badge -->
                  <span
                    :class="[
                      'w-12 shrink-0 rounded px-1.5 py-0.5 text-center text-[10px] font-bold',
                      methodBg(req.method)
                    ]"
                  >
                    {{ req.method }}
                  </span>

                  <!-- URL -->
                  <div
                    class="min-w-0 flex-1 truncate text-sm text-gray-900 dark:text-white"
                  >
                    {{ req.url || req.name }}
                  </div>

                  <!-- Status -->
                  <span
                    v-if="req.statusCode"
                    :class="[
                      'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium',
                      statusBg(req.statusCode)
                    ]"
                  >
                    {{ req.statusCode }}
                  </span>

                  <!-- Duration -->
                  <span
                    :class="[
                      'w-16 shrink-0 text-right font-mono text-xs tabular-nums',
                      durationColor(req.duration)
                    ]"
                  >
                    {{ formatDuration(req.duration) }}
                  </span>

                  <!-- Time -->
                  <span
                    class="w-12 shrink-0 text-right text-[10px] text-gray-400 dark:text-gray-500"
                  >
                    {{ timeAgo(req.startedAt) }}
                  </span>

                  <svg
                    :class="[
                      'h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform',
                      expandedRequest === req.traceId ? 'rotate-180' : ''
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

                <!-- Expanded detail -->
                <Transition
                  enter-active-class="transition-all duration-200 ease-out"
                  enter-from-class="max-h-0 opacity-0"
                  enter-to-class="max-h-[400px] opacity-100"
                  leave-active-class="transition-all duration-150 ease-in"
                  leave-from-class="max-h-[400px] opacity-100"
                  leave-to-class="max-h-0 opacity-0"
                >
                  <div
                    v-if="expandedRequest === req.traceId"
                    class="overflow-hidden border-t border-gray-100 dark:border-gray-800"
                  >
                    <dl>
                      <div
                        v-if="req.attributes?.['http.route']"
                        class="flex items-baseline gap-4 px-4 py-2"
                      >
                        <dt
                          class="w-24 shrink-0 text-[10px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500"
                        >
                          Route
                        </dt>
                        <dd
                          class="font-mono text-xs text-gray-700 dark:text-gray-300"
                        >
                          {{ req.attributes['http.route'] }}
                        </dd>
                      </div>
                      <div class="flex items-baseline gap-4 px-4 py-2">
                        <dt
                          class="w-24 shrink-0 text-[10px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500"
                        >
                          Duration
                        </dt>
                        <dd
                          class="font-mono text-xs tabular-nums text-gray-700 dark:text-gray-300"
                        >
                          {{ formatDuration(req.duration) }}
                        </dd>
                      </div>
                      <div
                        v-if="req.attributes?.['http.client_ip']"
                        class="flex items-baseline gap-4 px-4 py-2"
                      >
                        <dt
                          class="w-24 shrink-0 text-[10px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500"
                        >
                          Client IP
                        </dt>
                        <dd
                          class="font-mono text-xs text-gray-700 dark:text-gray-300"
                        >
                          {{ cleanIp(req.attributes['http.client_ip']) }}
                        </dd>
                      </div>
                      <div
                        v-if="
                          req.attributes?.['http.request_content_length'] ||
                          req.attributes?.['http.response_content_length']
                        "
                        class="flex items-baseline gap-4 px-4 py-2"
                      >
                        <dt
                          class="w-24 shrink-0 text-[10px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500"
                        >
                          Size
                        </dt>
                        <dd
                          class="flex items-center gap-3 font-mono text-xs text-gray-700 dark:text-gray-300"
                        >
                          <span
                            v-if="req.attributes['http.request_content_length']"
                          >
                            <span class="text-gray-400 dark:text-gray-500"
                              >req</span
                            >
                            {{
                              formatBytes(
                                Number(
                                  req.attributes['http.request_content_length']
                                )
                              )
                            }}
                          </span>
                          <span
                            v-if="
                              req.attributes['http.response_content_length']
                            "
                          >
                            <span class="text-gray-400 dark:text-gray-500"
                              >res</span
                            >
                            {{
                              formatBytes(
                                Number(
                                  req.attributes['http.response_content_length']
                                )
                              )
                            }}
                          </span>
                        </dd>
                      </div>
                      <div
                        v-if="req.attributes?.['http.referrer']"
                        class="flex items-baseline gap-4 px-4 py-2"
                      >
                        <dt
                          class="w-24 shrink-0 text-[10px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500"
                        >
                          Referrer
                        </dt>
                        <dd
                          class="min-w-0 truncate text-xs text-gray-700 dark:text-gray-300"
                        >
                          {{ req.attributes['http.referrer'] }}
                        </dd>
                      </div>
                      <div
                        v-if="req.attributes?.['http.user_agent']"
                        class="flex items-baseline gap-4 px-4 py-2"
                      >
                        <dt
                          class="w-24 shrink-0 text-[10px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500"
                        >
                          User agent
                        </dt>
                        <dd
                          class="min-w-0 truncate text-xs text-gray-700 dark:text-gray-300"
                        >
                          {{ req.attributes['http.user_agent'] }}
                        </dd>
                      </div>
                      <div
                        v-if="requestFlags(req).length"
                        class="flex items-start gap-4 px-4 py-2"
                      >
                        <dt
                          class="w-24 shrink-0 text-[10px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500"
                        >
                          Flags
                        </dt>
                        <dd class="flex min-w-0 flex-wrap gap-1.5">
                          <span
                            v-for="flag in requestFlags(req)"
                            :key="flag.key"
                            class="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                          >
                            {{ flag.key }}={{ flag.value ? 'on' : 'off' }}
                          </span>
                        </dd>
                      </div>
                      <div
                        v-if="req.traceId"
                        class="flex items-center gap-4 px-4 py-2"
                      >
                        <dt
                          class="w-24 shrink-0 text-[10px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500"
                        >
                          Trace ID
                        </dt>
                        <dd class="flex min-w-0 items-center gap-2">
                          <span
                            class="truncate font-mono text-xs text-gray-700 dark:text-gray-300"
                            >{{ req.traceId }}</span
                          >
                          <button
                            @click.stop="copyTraceId(req.traceId)"
                            class="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                          >
                            <svg
                              v-if="copiedTraceId === req.traceId"
                              class="h-3.5 w-3.5 text-emerald-500"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="2"
                                d="M5 13l4 4L19 7"
                              />
                            </svg>
                            <svg
                              v-else
                              class="h-3.5 w-3.5"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="2"
                                d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                              />
                            </svg>
                          </button>
                        </dd>
                      </div>
                    </dl>
                  </div>
                </Transition>
              </div>

              <!-- No filter results -->
              <div
                v-if="filteredRequests.length === 0"
                class="px-4 py-8 text-center text-sm text-gray-400 dark:text-gray-500"
              >
                No requests match your filters.
              </div>
            </div>
          </div>

          <!-- No requests -->
          <div v-else class="py-16 text-center">
            <svg
              class="mx-auto h-10 w-10 text-gray-300 dark:text-gray-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.5"
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
            <p class="mt-3 text-sm text-gray-500 dark:text-gray-400">
              No requests recorded in the last hour.
            </p>
          </div>
        </div>

        <!-- EXCEPTIONS TAB -->
        <div v-if="activeTab === 'exceptions'">
          <!-- Summary -->
          <div class="mb-6 flex items-center justify-between">
            <div class="flex items-baseline space-x-3">
              <span
                class="text-2xl font-semibold text-gray-900 dark:text-white"
                >{{ telemetry.exceptions.total }}</span
              >
              <span class="text-sm text-gray-500 dark:text-gray-400"
                >exceptions in the last hour</span
              >
            </div>
          </div>

          <!-- Exception groups -->
          <div v-if="telemetry.exceptions.groups.length > 0" class="space-y-2">
            <div
              v-for="(group, idx) in telemetry.exceptions.groups"
              :key="idx"
              class="rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
            >
              <button
                @click="toggleException(idx)"
                class="flex w-full items-center gap-3 p-4 text-left"
              >
                <!-- Count badge -->
                <span
                  class="inline-flex h-7 min-w-[1.75rem] shrink-0 items-center justify-center rounded-full bg-red-50 px-2 text-xs font-bold text-red-600 dark:bg-red-900/20 dark:text-red-400"
                >
                  {{ group.count }}
                </span>

                <!-- Exception info -->
                <div class="min-w-0 flex-1">
                  <div class="flex items-center space-x-2">
                    <span
                      class="text-sm font-medium text-red-600 dark:text-red-400"
                      >{{ group.exceptionType }}</span
                    >
                    <span
                      v-if="group.handled"
                      class="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                      >caught</span
                    >
                  </div>
                  <div
                    class="mt-0.5 truncate text-sm text-gray-600 dark:text-gray-400"
                  >
                    {{ group.message }}
                  </div>
                </div>

                <!-- Last seen -->
                <span
                  class="shrink-0 text-xs text-gray-400 dark:text-gray-500"
                  >{{ timeAgo(group.lastSeen) }}</span
                >

                <svg
                  :class="[
                    'h-4 w-4 shrink-0 text-gray-400 transition-transform',
                    expandedException === idx ? 'rotate-180' : ''
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

              <!-- Stack trace -->
              <Transition
                enter-active-class="transition-all duration-200 ease-out"
                enter-from-class="max-h-0 opacity-0"
                enter-to-class="max-h-[600px] opacity-100"
                leave-active-class="transition-all duration-150 ease-in"
                leave-from-class="max-h-[600px] opacity-100"
                leave-to-class="max-h-0 opacity-0"
              >
                <div
                  v-if="expandedException === idx"
                  class="overflow-hidden border-t border-gray-100 dark:border-gray-800"
                >
                  <div class="p-4">
                    <div
                      v-if="group.lastUrl"
                      class="mb-3 flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-400"
                    >
                      <span
                        class="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                        >{{ group.lastMethod }}</span
                      >
                      <span>{{ group.lastUrl }}</span>
                    </div>
                    <pre
                      v-if="group.lastStackTrace"
                      class="max-h-64 overflow-auto rounded-md bg-gray-50 p-3 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                    ><code>{{ group.lastStackTrace }}</code></pre>
                    <p v-else class="text-sm text-gray-400 dark:text-gray-500">
                      No stack trace available.
                    </p>
                  </div>
                </div>
              </Transition>
            </div>
          </div>

          <!-- No exceptions -->
          <div v-else class="py-16 text-center">
            <svg
              class="mx-auto h-10 w-10 text-emerald-300 dark:text-emerald-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.5"
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <p class="mt-3 text-sm text-gray-500 dark:text-gray-400">
              No exceptions in the last hour. Looking good!
            </p>
          </div>
        </div>

        <!-- QUERIES TAB -->
        <div v-if="activeTab === 'queries'">
          <div v-if="telemetry.queries.slow.length > 0">
            <h3
              class="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Slow queries ({{ telemetry.queries.slow.length }})
            </h3>
            <div
              class="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800"
            >
              <div
                v-for="(query, i) in telemetry.queries.slow"
                :key="i"
                :class="[
                  'p-4',
                  i > 0 ? 'border-t border-gray-100 dark:border-gray-800' : ''
                ]"
              >
                <div class="flex items-start justify-between">
                  <div class="min-w-0 flex-1">
                    <code
                      class="block whitespace-pre-wrap break-all text-xs text-gray-700 dark:text-gray-300"
                      v-html="
                        highlightQuery(
                          query.attributes?.query ||
                            query.attributes?.statement ||
                            'Unknown query'
                        )
                      "
                    ></code>
                    <div v-if="query.attributes?.model" class="mt-1.5">
                      <span
                        class="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                        >{{ query.attributes.model }}</span
                      >
                    </div>
                  </div>
                  <div class="ml-4 shrink-0 text-right">
                    <span
                      :class="[
                        'font-mono text-sm font-medium tabular-nums',
                        durationColor(query.value)
                      ]"
                      >{{ formatDuration(query.value) }}</span
                    >
                    <div class="text-[10px] text-gray-400 dark:text-gray-500">
                      {{ timeAgo(query.recordedAt) }}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- No queries -->
          <div v-else class="py-16 text-center">
            <svg
              class="mx-auto h-10 w-10 text-gray-300 dark:text-gray-600"
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
            <p class="mt-3 text-sm text-gray-500 dark:text-gray-400">
              No slow queries recorded. Database is performing well.
            </p>
          </div>
        </div>

        <!-- CACHE TAB -->
        <div v-if="activeTab === 'cache'">
          <!-- Summary cards -->
          <div class="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div
              class="rounded-lg border border-gray-200 p-4 dark:border-gray-800"
            >
              <div
                class="text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400"
              >
                Hit rate
              </div>
              <div
                :class="[
                  'mt-1 text-2xl font-semibold tabular-nums',
                  hitRateColor(telemetry.cache.hitRate)
                ]"
              >
                {{ telemetry.cache.hitRate }}%
              </div>
            </div>
            <div
              class="rounded-lg border border-gray-200 p-4 dark:border-gray-800"
            >
              <div
                class="text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400"
              >
                Total ops / hr
              </div>
              <div
                class="mt-1 text-2xl font-semibold tabular-nums text-gray-900 dark:text-white"
              >
                {{ telemetry.cache.totalOps }}
              </div>
            </div>
            <div
              class="rounded-lg border border-gray-200 p-4 dark:border-gray-800"
            >
              <div
                class="text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400"
              >
                Hits
              </div>
              <div
                class="mt-1 text-2xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400"
              >
                {{ telemetry.cache.hits }}
              </div>
            </div>
            <div
              class="rounded-lg border border-gray-200 p-4 dark:border-gray-800"
            >
              <div
                class="text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400"
              >
                Misses
              </div>
              <div
                class="mt-1 text-2xl font-semibold tabular-nums text-red-600 dark:text-red-400"
              >
                {{ telemetry.cache.misses }}
              </div>
            </div>
          </div>

          <!-- Top keys -->
          <div v-if="telemetry.cache.topKeys.length > 0" class="mb-6">
            <h3
              class="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Top keys
            </h3>
            <div
              class="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800"
            >
              <div
                v-for="(entry, i) in telemetry.cache.topKeys"
                :key="entry.key"
                :class="[
                  'flex items-center gap-3 px-4 py-2.5',
                  i > 0 ? 'border-t border-gray-100 dark:border-gray-800' : ''
                ]"
              >
                <!-- Key name -->
                <div
                  class="min-w-0 flex-1 truncate font-mono text-sm text-gray-900 dark:text-white"
                >
                  {{ entry.key }}
                </div>

                <!-- Hit/miss bar -->
                <div class="hidden w-32 items-center space-x-1.5 sm:flex">
                  <div
                    class="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800"
                  >
                    <div
                      class="h-full rounded-full bg-emerald-500"
                      :style="{
                        width:
                          ((entry.hits / (entry.hits + entry.misses)) * 100 ||
                            0) + '%'
                      }"
                    ></div>
                  </div>
                  <span
                    class="w-10 text-right text-[10px] text-gray-400 dark:text-gray-500"
                  >
                    {{
                      entry.hits + entry.misses > 0
                        ? (
                            (entry.hits / (entry.hits + entry.misses)) *
                            100
                          ).toFixed(0)
                        : 0
                    }}%
                  </span>
                </div>

                <!-- Counts -->
                <div class="flex shrink-0 items-center space-x-3 text-xs">
                  <span class="text-emerald-600 dark:text-emerald-400"
                    >{{ entry.hits }} hits</span
                  >
                  <span class="text-red-600 dark:text-red-400"
                    >{{ entry.misses }} miss</span
                  >
                </div>
              </div>
            </div>
          </div>

          <!-- Recent operations -->
          <div v-if="telemetry.cache.recent.length > 0">
            <h3
              class="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Recent operations
            </h3>
            <div
              class="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800"
            >
              <div
                v-for="(op, i) in telemetry.cache.recent"
                :key="i"
                :class="[
                  'flex items-center gap-3 px-4 py-2.5',
                  i > 0 ? 'border-t border-gray-100 dark:border-gray-800' : ''
                ]"
              >
                <!-- Operation badge -->
                <span
                  :class="[
                    'w-12 shrink-0 rounded px-1.5 py-0.5 text-center text-[10px] font-bold',
                    cacheOpBg(op.name)
                  ]"
                >
                  {{ cacheOpLabel(op.name) }}
                </span>

                <!-- Key -->
                <div
                  class="min-w-0 flex-1 truncate font-mono text-sm text-gray-900 dark:text-white"
                >
                  {{ op.key }}
                </div>

                <!-- Duration -->
                <span
                  :class="[
                    'w-16 shrink-0 text-right font-mono text-xs',
                    durationColor(op.duration)
                  ]"
                >
                  {{ formatDuration(op.duration) }}
                </span>

                <!-- Time -->
                <span
                  class="w-12 shrink-0 text-right text-[10px] text-gray-400 dark:text-gray-500"
                >
                  {{ timeAgo(op.recordedAt) }}
                </span>
              </div>
            </div>
          </div>

          <!-- No cache data -->
          <div
            v-if="
              telemetry.cache.recent.length === 0 &&
              telemetry.cache.topKeys.length === 0
            "
            class="py-16 text-center"
          >
            <svg
              class="mx-auto h-10 w-10 text-gray-300 dark:text-gray-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.5"
                d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
              />
            </svg>
            <p class="mt-3 text-sm text-gray-500 dark:text-gray-400">
              No cache operations recorded in the last hour.
            </p>
          </div>
        </div>

        <!-- SETUP TAB (when no telemetry data) -->
        <div v-if="activeTab === 'setup'" class="mx-auto max-w-lg py-8">
          <div class="text-center">
            <div
              class="bg-brand/10 mx-auto flex h-12 w-12 items-center justify-center rounded-full"
            >
              <svg
                class="text-brand h-6 w-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.5"
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
            </div>
            <h3
              class="mt-4 text-base font-semibold text-gray-900 dark:text-white"
            >
              Enable App Telemetry
            </h3>
            <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
              Track requests, exceptions, and database queries from your
              deployed Sails app.
            </p>
          </div>

          <div class="mt-8 space-y-6">
            <!-- Step 1 -->
            <div class="flex space-x-3">
              <span
                class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-bold text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                >1</span
              >
              <div>
                <div class="text-sm font-medium text-gray-900 dark:text-white">
                  Install the hook in your Sails app
                </div>
                <div class="mt-2 rounded-md bg-gray-50 p-3 dark:bg-gray-800">
                  <code class="text-xs text-gray-700 dark:text-gray-300"
                    >npm install sails-hook-slipway</code
                  >
                </div>
              </div>
            </div>

            <!-- Step 2 -->
            <div class="flex space-x-3">
              <span
                class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-bold text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                >2</span
              >
              <div class="min-w-0 flex-1">
                <div class="text-sm font-medium text-gray-900 dark:text-white">
                  Deploy your app
                </div>
                <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Slipway automatically injects
                  <code class="rounded bg-gray-100 px-1 py-0.5 dark:bg-gray-800"
                    >SLIPWAY_TELEMETRY_URL</code
                  >
                  and
                  <code class="rounded bg-gray-100 px-1 py-0.5 dark:bg-gray-800"
                    >SLIPWAY_TELEMETRY_TOKEN</code
                  >
                  into your container.
                </p>
              </div>
            </div>

            <!-- Step 3 -->
            <div class="flex space-x-3">
              <span
                class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-bold text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                >3</span
              >
              <div>
                <div class="text-sm font-medium text-gray-900 dark:text-white">
                  That's it
                </div>
                <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  The hook auto-instruments HTTP requests, exceptions, and
                  Waterline queries. Data appears here within seconds.
                </p>
              </div>
            </div>
          </div>

          <!-- Telemetry token -->
          <div
            v-if="telemetry.telemetryToken"
            class="mt-8 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-800/50"
          >
            <div class="text-xs font-medium text-gray-500 dark:text-gray-400">
              Environment telemetry token
            </div>
            <div class="mt-2 flex items-center space-x-2">
              <code
                class="flex-1 truncate rounded bg-white px-2 py-1.5 text-xs text-gray-700 dark:bg-gray-900 dark:text-gray-300"
                >{{ telemetry.telemetryToken }}</code
              >
              <button
                @click="copyToken"
                class="shrink-0 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800"
              >
                {{ copied ? 'Copied!' : 'Copy' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
