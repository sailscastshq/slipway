<script setup>
import { Link, Head, router } from '@inertiajs/vue3'
import { inject, ref, reactive, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useEventSource } from '@/composables/sse'
import AppLayout from '@/layouts/AppLayout.vue'
import Breadcrumb from '@/components/Breadcrumb.vue'
import SlideToDeploy from '@/components/SlideToDeploy.vue'
import Tooltip from '@/components/Tooltip.vue'
import { useToast } from '@/composables/toast'
import SlippyLoader from '@/components/SlippyLoader.vue'
import { highlightLogLine } from '@/lib/highlightLog'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  project: Object,
  environment: Object,
  app: Object,
  appEnvVars: Object,
  inheritedVars: Object,
  deployments: Array,
  services: Array,
  backupConfigured: Boolean,
  checklist: Array
})

const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')
const toast = useToast()

// --- SSE-powered deployment tracking (replaces usePoll) ---
const activeDeploymentSources = ref(new Map())

function connectActiveDeployments() {
  const activeStatuses = ['pending', 'building', 'deploying']
  const active = props.deployments.filter(d => activeStatuses.includes(d.status))

  for (const dep of active) {
    if (activeDeploymentSources.value.has(dep.id)) continue

    const es = new EventSource(`/api/v1/deployments/${dep.id}/stream`)
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.status && ['running', 'failed', 'cancelled'].includes(data.status)) {
          es.close()
          activeDeploymentSources.value.delete(dep.id)
          router.reload()
        }
      } catch { /* ignore */ }
    }
    es.onerror = () => { /* auto-reconnects */ }
    activeDeploymentSources.value.set(dep.id, es)
  }
}

function disconnectActiveDeployments() {
  for (const es of activeDeploymentSources.value.values()) {
    es.close()
  }
  activeDeploymentSources.value.clear()
}

watch(() => props.deployments, () => {
  connectActiveDeployments()
}, { immediate: true })

// --- Deploy ---
const deploying = ref(false)
const slideRef = ref(null)

const checklistAllGood = computed(() => {
  return (props.checklist || []).length === 1 && props.checklist[0].severity === 'success'
})

async function triggerDeploy() {
  if (deploying.value) return
  deploying.value = true
  try {
    const res = await fetch(`/api/v1/projects/${props.project.slug}/environments/${props.environment.slug}/apps/${props.app.slug}/deploy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    })
    const data = await res.json()
    if (data.deployment) {
      router.visit(`/projects/${props.project.slug}/deployments/${data.deployment.id}`)
    } else {
      slideRef.value?.reset()
      deploying.value = false
    }
  } catch {
    slideRef.value?.reset()
    deploying.value = false
  }
}

// --- Container lifecycle ---
const restarting = ref(false)
const stopping = ref(false)

async function restartApp() {
  restarting.value = true
  try {
    await fetch(`/api/v1/projects/${props.project.slug}/environments/${props.environment.slug}/apps/${props.app.slug}/restart`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    })
    router.reload({ only: ['app'] })
  } finally {
    restarting.value = false
  }
}

async function stopApp() {
  stopping.value = true
  try {
    await fetch(`/api/v1/projects/${props.project.slug}/environments/${props.environment.slug}/apps/${props.app.slug}/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    })
    router.reload({ only: ['app'] })
  } finally {
    stopping.value = false
  }
}

// --- Domain display ---
const domainDropdownOpen = ref(false)
const copiedText = ref(null)
const moreMenuOpen = ref(false)

const domains = computed(() => {
  const list = []
  if (props.environment.domain) {
    list.push({ label: 'Custom', value: props.environment.domain })
  }
  if (props.environment.generatedDomain && props.environment.generatedDomain !== props.environment.domain) {
    list.push({ label: 'Generated', value: props.environment.generatedDomain })
  }
  return list
})

const hasMultipleDomains = computed(() => domains.value.length > 1)

function copyToClipboard(text) {
  navigator.clipboard.writeText(text)
  copiedText.value = text
  setTimeout(() => { copiedText.value = null }, 2000)
}

function closeAllDropdowns() {
  domainDropdownOpen.value = false
  moreMenuOpen.value = false
}

// --- Custom domain ---
const newDomain = ref(props.environment.domain || '')
const savingDomain = ref(false)
const domainModalOpen = ref(false)

function openDomainModal() {
  newDomain.value = props.environment.domain || ''
  domainModalOpen.value = true
  moreMenuOpen.value = false
}

function closeDomainModal() {
  if (!savingDomain.value) {
    domainModalOpen.value = false
  }
}

async function saveCustomDomain() {
  if (savingDomain.value) return
  savingDomain.value = true
  try {
    const res = await fetch(`/api/v1/projects/${props.project.slug}/environments/${props.environment.slug}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: newDomain.value.trim() })
    })
    if (res.ok) {
      toast({ message: newDomain.value.trim() ? 'Custom domain saved' : 'Custom domain removed', type: 'success' })
      domainModalOpen.value = false
      router.reload({ only: ['environment'] })
    } else {
      const err = await res.json().catch(() => null)
      toast({ message: err?.message || 'Failed to save domain', type: 'error' })
    }
  } finally {
    savingDomain.value = false
  }
}

// --- Status badges ---
const statusStyles = {
  green: {
    bg: 'bg-green-50 dark:bg-green-950/40',
    dot: 'bg-green-500',
    text: 'text-green-700 dark:text-green-400'
  },
  blue: {
    bg: 'bg-blue-50 dark:bg-blue-950/40',
    dot: 'bg-blue-500 animate-pulse',
    text: 'text-blue-700 dark:text-blue-400'
  },
  yellow: {
    bg: 'bg-yellow-50 dark:bg-yellow-950/40',
    dot: 'bg-yellow-500 animate-pulse',
    text: 'text-yellow-700 dark:text-yellow-400'
  },
  red: {
    bg: 'bg-red-50 dark:bg-red-950/40',
    dot: 'bg-red-500',
    text: 'text-red-700 dark:text-red-400'
  },
  gray: {
    bg: 'bg-gray-100 dark:bg-gray-800/60',
    dot: 'bg-gray-400',
    text: 'text-gray-600 dark:text-gray-400'
  }
}

function appStatusClasses(app) {
  if (app.status === 'running') {
    if (app.containerHealth === 'unhealthy') return statusStyles.red
    return statusStyles.green
  }
  if (['building', 'deploying', 'creating'].includes(app.status)) return statusStyles.blue
  if (['pending', 'starting'].includes(app.status)) return statusStyles.yellow
  if (app.status === 'failed') return statusStyles.red
  return statusStyles.gray
}

function appStatusLabel(app) {
  if (app.status === 'running') {
    if (app.containerHealth === 'unhealthy') return 'Unhealthy'
    return 'Running'
  }
  const labels = {
    building: 'Building', deploying: 'Deploying', pending: 'Pending',
    starting: 'Starting', failed: 'Failed', stopped: 'Stopped',
    cancelled: 'Cancelled', creating: 'Creating'
  }
  return labels[app.status] || app.status
}

function statusBadge(status) {
  const map = {
    running: { label: 'Running', classes: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
    building: { label: 'Building', classes: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
    deploying: { label: 'Deploying', classes: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
    pending: { label: 'Pending', classes: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' },
    failed: { label: 'Failed', classes: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
    stopped: { label: 'Stopped', classes: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
    cancelled: { label: 'Cancelled', classes: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
    creating: { label: 'Creating', classes: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' }
  }
  return map[status] || { label: status, classes: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' }
}

function timeAgo(date) {
  if (!date) return 'Never'
  const seconds = Math.floor((new Date() - new Date(date)) / 1000)
  const intervals = [
    { label: 'year', seconds: 31536000 },
    { label: 'month', seconds: 2592000 },
    { label: 'week', seconds: 604800 },
    { label: 'day', seconds: 86400 },
    { label: 'hour', seconds: 3600 },
    { label: 'minute', seconds: 60 }
  ]
  for (const interval of intervals) {
    const count = Math.floor(seconds / interval.seconds)
    if (count >= 1) return `${count} ${interval.label}${count > 1 ? 's' : ''} ago`
  }
  return 'just now'
}

// --- Platform tools ---
const services = computed(() => props.services || [])

const hasDatabaseService = computed(() => {
  return services.value.some(s => ['postgresql', 'mysql', 'mongodb', 'redis'].includes(s.type) && s.status === 'running')
})

const firstDatabaseService = computed(() => {
  return services.value.find(s => ['postgresql', 'mysql', 'mongodb'].includes(s.type) && s.status === 'running')
})

function serviceIcon(type) {
  const icons = { postgresql: 'PG', mysql: 'My', redis: 'Rd', mongodb: 'Mg' }
  return icons[type] || '?'
}

// --- Services display ---
const revealedServiceUrls = ref(new Set())

function toggleServiceUrlReveal(id) {
  if (revealedServiceUrls.value.has(id)) {
    revealedServiceUrls.value.delete(id)
  } else {
    revealedServiceUrls.value.add(id)
  }
}

// --- App-specific env vars ---
const localVars = reactive({ ...props.appEnvVars })
watch(() => props.appEnvVars, (newVars) => {
  Object.keys(localVars).forEach(k => delete localVars[k])
  Object.assign(localVars, newVars)
})
const revealedKeys = ref(new Set())
const newKey = ref('')
const newValue = ref('')
const savingVars = ref(false)
const _params = new URLSearchParams(window.location.search)
const envVarsOpen = ref(_params.has('env') || _params.has('bulk'))
const bulkMode = ref(_params.has('bulk'))
const bulkText = ref('')

const sortedVarKeys = computed(() => Object.keys(localVars).sort())

const bulkHighlighted = computed(() => {
  const text = bulkText.value || ''
  return text.split('\n').map(line => {
    const escaped = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    if (escaped.trimStart().startsWith('#')) {
      return `<span class="text-gray-500 dark:text-gray-600">${escaped}</span>`
    }
    const eqIdx = escaped.indexOf('=')
    if (eqIdx === -1) return escaped
    const key = escaped.slice(0, eqIdx)
    const value = escaped.slice(eqIdx + 1)
    return `<span class="text-amber-600 dark:text-amber-400">${key}</span><span class="text-gray-400 dark:text-gray-600">=</span><span class="text-gray-800 dark:text-gray-300">${value}</span>`
  }).join('\n') + '\n'
})

function enterBulkMode() {
  bulkText.value = sortedVarKeys.value.map(k => `${k}=${localVars[k]}`).join('\n')
  bulkMode.value = true
}

function exitBulkMode() {
  bulkMode.value = false
}

function saveBulk() {
  const vars = {}
  for (const line of bulkText.value.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const value = trimmed.slice(eqIdx + 1).trim()
    if (key) vars[key] = value
  }
  Object.keys(localVars).forEach(k => delete localVars[k])
  Object.assign(localVars, vars)
  saveEnvVars()
  bulkMode.value = false
}

function isSensitive() {
  return true
}

function toggleReveal(key) {
  if (revealedKeys.value.has(key)) revealedKeys.value.delete(key)
  else revealedKeys.value.add(key)
}

function shouldShowGenerate(key) {
  const upper = key.toUpperCase()
  return upper.includes('SECRET') || upper.includes('KEY')
}

function generateSecret() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  newValue.value = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

async function saveEnvVars() {
  savingVars.value = true
  try {
    await fetch(`/api/v1/projects/${props.project.slug}/environments/${props.environment.slug}/apps/${props.app.slug}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ envVars: { ...localVars } })
    })
    router.reload({ only: ['appEnvVars'] })
  } finally {
    savingVars.value = false
  }
}

function addVar() {
  if (!newKey.value.trim()) return
  localVars[newKey.value.trim()] = newValue.value
  saveEnvVars()
  newKey.value = ''
  newValue.value = ''
}

function removeVar(key) {
  delete localVars[key]
  saveEnvVars()
}

function renameVar(oldKey, el) {
  const trimmed = el.value.trim()
  if (!trimmed || trimmed === oldKey) {
    el.value = oldKey
    return
  }
  if (trimmed in localVars) {
    toast({ message: `Variable "${trimmed}" already exists`, type: 'error' })
    el.value = oldKey
    return
  }
  const value = localVars[oldKey]
  delete localVars[oldKey]
  localVars[trimmed] = value
  saveEnvVars()
  toast({ message: `Renamed "${oldKey}" to "${trimmed}"`, type: 'success' })
}

function updateVarValue(key, value) {
  if (localVars[key] === value) return
  localVars[key] = value
  saveEnvVars()
  toast({ message: `Updated "${key}"`, type: 'success' })
}

watch(envVarsOpen, (open) => {
  const url = new URL(window.location)
  if (open) {
    url.searchParams.set('env', '1')
  } else {
    url.searchParams.delete('env')
    url.searchParams.delete('bulk')
  }
  window.history.replaceState({}, '', url)
})

watch(bulkMode, (open) => {
  const url = new URL(window.location)
  if (open) {
    url.searchParams.set('bulk', '1')
  } else {
    url.searchParams.delete('bulk')
  }
  window.history.replaceState({}, '', url)
})

// --- Container logs ---
const logsOpen = ref(_params.has('logs'))
const logLines = ref([])
const logContainer = ref(null)
const autoScroll = ref(true)

const {
  connected: logsConnected,
  error: logsError,
  close: disconnectLogs,
  connect: connectLogs
} = useEventSource(
  `/api/v1/projects/${props.project.slug}/environments/${props.environment.slug}/apps/${props.app.slug}/logs/stream?tail=200`,
  {
    immediate: false,
    onMessage(data) {
      if (data.log) {
        logLines.value.push(data.log)
        if (logLines.value.length > 2000) {
          logLines.value = logLines.value.slice(-1500)
        }
        if (autoScroll.value) {
          nextTick(() => {
            if (logContainer.value) {
              logContainer.value.scrollTop = logContainer.value.scrollHeight
            }
          })
        }
      }
    }
  }
)

watch(logsOpen, (open) => {
  const url = new URL(window.location)
  if (open) {
    url.searchParams.set('logs', '1')
  } else {
    url.searchParams.delete('logs')
  }
  window.history.replaceState({}, '', url)

  if (open) {
    connectLogs()
  } else {
    disconnectLogs()
  }
})

// --- Accordion state ---
const servicesOpen = ref(false)

// --- Escape key ---
function handleEscapeKey(e) {
  if (e.key === 'Escape') {
    closeAllDropdowns()
    closeDomainModal()
  }
}

onMounted(() => {
  if (logsOpen.value) connectLogs()
  if (bulkMode.value) {
    bulkText.value = sortedVarKeys.value.map(k => `${k}=${localVars[k]}`).join('\n')
  }
  document.addEventListener('keydown', handleEscapeKey)
})

onBeforeUnmount(() => {
  disconnectActiveDeployments()
  disconnectLogs()
  document.removeEventListener('keydown', handleEscapeKey)
})
</script>
<template>
  <Head :title="`${app.name} - ${environment.name} - ${project.name} | Slipway`"></Head>
  <div class="flex h-full flex-col" @click="closeAllDropdowns">
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
        <!-- Desktop sidebar toggle -->
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
        <Breadcrumb :items="[
          { label: 'projects', href: '/' },
          { label: project.name.toLowerCase(), href: `/projects/${project.slug}` },
          { label: environment.name.toLowerCase(), href: `/projects/${project.slug}/environments/${environment.slug}` },
          { label: app.name.toLowerCase() }
        ]" />
      </div>
      <div class="flex items-center space-x-4">
        <a
          href="https://docs.sailscasts.com/slipway"
          target="_blank"
          class="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
        >
          Docs
          <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
      <div class="mx-auto max-w-6xl">
        <!-- App Info -->
        <div class="mb-8 flex items-start justify-between">
          <div>
            <div class="flex items-center space-x-3">
              <h1 class="text-xl font-semibold text-gray-900 dark:text-white">{{ app.name }}</h1>
              <span
                v-if="environment.isProduction"
                class="inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
              >
                Production
              </span>
            </div>
            <!-- Domain display -->
            <div v-if="environment.fullDomain" class="relative mt-1 inline-flex items-center">
              <div class="group flex items-center gap-2">
                <a
                  :href="`https://${environment.fullDomain}`"
                  target="_blank"
                  class="text-sm text-gray-500 underline decoration-dashed decoration-gray-300 underline-offset-2 hover:text-gray-900 dark:text-gray-400 dark:decoration-gray-600 dark:hover:text-white"
                >
                  {{ environment.fullDomain }}
                </a>
                <button
                  @click.prevent="copyToClipboard(environment.fullDomain)"
                  class="rounded p-0.5 text-gray-300 opacity-0 transition-opacity hover:text-gray-500 group-hover:opacity-100 dark:text-gray-600 dark:hover:text-gray-400"
                >
                  <svg v-if="copiedText === environment.fullDomain" class="h-3.5 w-3.5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                  </svg>
                  <svg v-else class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
                <button
                  v-if="hasMultipleDomains"
                  @click.stop="domainDropdownOpen = !domainDropdownOpen"
                  class="rounded p-0.5 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                >
                  <svg
                    :class="['h-3.5 w-3.5 transition-transform duration-200', domainDropdownOpen ? 'rotate-180' : '']"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>

              <!-- Domain dropdown -->
              <div
                v-if="domainDropdownOpen && hasMultipleDomains"
                @click.stop
                class="absolute left-0 top-full z-20 mt-1.5 w-max rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
              >
                <div
                  v-for="d in domains"
                  :key="d.value"
                  class="group/item flex items-center gap-2 px-3 py-2"
                >
                  <span class="text-[10px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500 w-16">{{ d.label }}</span>
                  <a
                    :href="`https://${d.value}`"
                    target="_blank"
                    class="text-sm text-gray-700 underline decoration-dashed decoration-gray-300 underline-offset-2 hover:text-gray-900 dark:text-gray-300 dark:decoration-gray-600 dark:hover:text-white"
                  >
                    {{ d.value }}
                  </a>
                  <button
                    @click="copyToClipboard(d.value)"
                    class="rounded p-0.5 text-gray-300 opacity-0 transition-opacity hover:text-gray-500 group-hover/item:opacity-100 dark:text-gray-600 dark:hover:text-gray-400"
                  >
                    <svg v-if="copiedText === d.value" class="h-3.5 w-3.5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                    </svg>
                    <svg v-else class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div class="flex items-center space-x-2">
            <!-- More menu -->
            <div class="relative">
              <button
                @click.stop="moreMenuOpen = !moreMenuOpen"
                class="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
              >
                <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                  <circle cx="12" cy="6" r="1.5" />
                  <circle cx="12" cy="12" r="1.5" />
                  <circle cx="12" cy="18" r="1.5" />
                </svg>
              </button>
              <!-- Dropdown -->
              <Transition
                enter-active-class="transition ease-out duration-100"
                enter-from-class="transform opacity-0 scale-95"
                enter-to-class="transform opacity-100 scale-100"
                leave-active-class="transition ease-in duration-75"
                leave-from-class="transform opacity-100 scale-100"
                leave-to-class="transform opacity-0 scale-95"
              >
                <div
                  v-if="moreMenuOpen"
                  @click.stop
                  class="absolute right-0 top-full z-20 mt-1 w-48 rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
                >
                  <!-- Platform tools -->
                  <div v-if="app.status === 'running'" class="border-b border-gray-100 pb-1 dark:border-gray-800">
                    <Link
                      :href="`/projects/${project.slug}/environments/${environment.slug}/helm`"
                      class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      <svg class="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      Helm
                    </Link>
                    <Link
                      :href="`/projects/${project.slug}/environments/${environment.slug}/bridge`"
                      class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      <svg class="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                      </svg>
                      Bridge
                    </Link>
                    <Link
                      v-if="hasDatabaseService"
                      :href="`/projects/${project.slug}/environments/${environment.slug}/dock${firstDatabaseService ? '/' + firstDatabaseService.id : ''}`"
                      class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      <svg class="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
                      </svg>
                      Dock
                    </Link>
                    <Link
                      v-if="environment.features && environment.features['sails-quest']"
                      :href="`/projects/${project.slug}/environments/${environment.slug}/quest`"
                      class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      <svg class="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Quest
                    </Link>
                    <Link
                      v-if="environment.features && environment.features['sails-content']"
                      :href="`/projects/${project.slug}/environments/${environment.slug}/content`"
                      class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      <svg class="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      Content
                    </Link>
                    <Link
                      :href="`/projects/${project.slug}/environments/${environment.slug}/lookout`"
                      class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      <svg class="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                      </svg>
                      Lookout
                    </Link>
                  </div>
                  <!-- Container controls -->
                  <div v-if="app.status === 'running'" class="border-b border-gray-100 py-1 dark:border-gray-800">
                    <button
                      @click="restartApp(); moreMenuOpen = false"
                      :disabled="restarting"
                      class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      <SlippyLoader v-if="restarting" size="h-4 w-4" class="text-gray-400" />
                      <svg v-else class="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Restart
                    </button>
                    <button
                      @click="stopApp(); moreMenuOpen = false"
                      :disabled="stopping"
                      class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                    >
                      <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                        <rect x="6" y="6" width="12" height="12" rx="1" />
                      </svg>
                      Stop
                    </button>
                  </div>
                  <!-- Settings -->
                  <div class="pt-1">
                    <button
                      @click="openDomainModal"
                      class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      <svg class="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                      </svg>
                      Custom domain
                      <span v-if="environment.domain" class="ml-auto h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                    </button>
                    <Link
                      :href="`/projects/${project.slug}/environments/${environment.slug}/apps/${app.slug}/settings`"
                      class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      <svg class="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      Settings
                    </Link>
                  </div>
                </div>
              </Transition>
            </div>
            <span :class="['inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium', appStatusClasses(app).bg]">
              <span :class="['h-1.5 w-1.5 rounded-full', appStatusClasses(app).dot]"></span>
              <span :class="appStatusClasses(app).text">{{ appStatusLabel(app) }}</span>
            </span>
          </div>
        </div>

        <!-- Slide to Deploy -->
        <div class="mb-10 flex justify-end">
          <div class="w-56">
            <SlideToDeploy
              ref="slideRef"
              :is-production="environment.isProduction"
              :environment-name="environment.name"
              :disabled="deploying || !checklistAllGood"
              @deploy="triggerDeploy"
            />
          </div>
        </div>

        <!-- Accordion: Logs, App Variables, Services, Deployments -->
        <div class="mb-10 divide-y divide-gray-200 rounded-lg border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
          <!-- Logs -->
          <div>
            <div class="flex items-center justify-between px-4 py-3">
              <button
                @click="logsOpen = !logsOpen"
                class="flex flex-1 items-center space-x-3 text-left hover:opacity-80"
              >
                <h2 class="text-sm font-medium text-gray-900 dark:text-white">Logs</h2>
                <span
                  v-if="logsConnected"
                  class="inline-flex items-center space-x-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400"
                >
                  <span class="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse"></span>
                  <span>Live</span>
                </span>
              </button>
              <button
                @click="logsOpen = !logsOpen"
                class="rounded p-0.5 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <svg
                  :class="['h-4 w-4 text-gray-400 transition-transform duration-200', logsOpen ? 'rotate-90' : '']"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
            <div v-show="logsOpen">
              <div
                v-if="logsError"
                class="border-t border-gray-200 px-4 py-6 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400"
              >
                {{ logsError }}
              </div>
              <div v-else class="border-t border-gray-200 dark:border-gray-800">
                <div
                  ref="logContainer"
                  class="h-80 overflow-y-auto bg-gray-100 p-4 font-mono text-xs leading-5 text-gray-700 dark:bg-gray-950 dark:text-gray-300"
                  @scroll="autoScroll = logContainer && (logContainer.scrollHeight - logContainer.scrollTop - logContainer.clientHeight < 40)"
                >
                  <div v-if="!logsConnected && logLines.length === 0" class="flex h-full items-center justify-center text-gray-500">
                    <SlippyLoader size="h-4 w-4" class="mr-2" />
                    Connecting to logs...
                  </div>
                  <div v-else-if="logLines.length === 0 && logsConnected" class="text-gray-500">
                    Waiting for output...
                  </div>
                  <template v-else>
                    <div v-for="(line, i) in logLines" :key="i" class="whitespace-pre-wrap break-all hover:bg-gray-200/50 dark:hover:bg-gray-900/50" v-html="highlightLogLine(line)"></div>
                  </template>
                </div>
              </div>
            </div>
          </div>

          <!-- App Variables -->
          <div>
            <div class="flex items-center justify-between px-4 py-3">
              <button
                @click="envVarsOpen = !envVarsOpen"
                class="flex flex-1 items-center space-x-3 text-left hover:opacity-80"
              >
                <h2 class="text-sm font-medium text-gray-900 dark:text-white">Environment variables</h2>
                <span class="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                  {{ sortedVarKeys.length }}
                </span>
              </button>
              <div class="flex items-center gap-2">
                <Tooltip v-if="envVarsOpen" :text="bulkMode ? 'Single edit' : 'Bulk edit'">
                  <button
                    @click="bulkMode ? exitBulkMode() : enterBulkMode()"
                    class="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                  >
                    <svg v-if="bulkMode" class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
                    </svg>
                    <svg v-else class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                    </svg>
                  </button>
                </Tooltip>
                <button
                  @click="envVarsOpen = !envVarsOpen"
                  class="rounded p-0.5 hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  <svg
                    :class="['h-4 w-4 text-gray-400 transition-transform duration-200', envVarsOpen ? 'rotate-90' : '']"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>
            <div v-show="envVarsOpen">
              <template v-if="bulkMode">
                <div class="border-t border-gray-200 dark:border-gray-800">
                  <div class="relative">
                    <pre
                      class="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-all bg-gray-50 px-4 py-4 font-mono text-sm leading-relaxed dark:bg-gray-950"
                      aria-hidden="true"
                      v-html="bulkHighlighted"
                    ></pre>
                    <textarea
                      v-model="bulkText"
                      rows="3"
                      placeholder="KEY=value&#10;DATABASE_URL=postgres://localhost:5432/db&#10;# Comments are ignored"
                      class="relative block w-full resize-none bg-transparent px-4 py-4 font-mono text-sm text-transparent caret-gray-900 placeholder-gray-400 focus:outline-none dark:caret-white dark:placeholder-gray-500"
                      style="field-sizing: content"
                      spellcheck="false"
                    />
                  </div>
                  <div class="flex items-center justify-between border-t border-gray-200 px-4 py-3 dark:border-gray-800">
                    <p class="text-xs text-gray-400 dark:text-gray-500">
                      One KEY=value per line. Lines starting with # are ignored.
                    </p>
                    <button
                      @click="saveBulk"
                      :disabled="savingVars"
                      class="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
                    >
                      Save
                    </button>
                  </div>
                </div>
              </template>
              <template v-else>
                <div v-if="sortedVarKeys.length > 0" class="space-y-1 px-4 pb-2">
                  <div
                    v-for="key in sortedVarKeys"
                    :key="key"
                    class="group py-2"
                  >
                    <div class="flex items-center justify-between">
                      <input
                        :value="key"
                        @blur="renameVar(key, $event.target)"
                        @keydown.enter="$event.target.blur()"
                        autocomplete="off"
                        spellcheck="false"
                        class="border-b border-dashed border-transparent bg-transparent font-mono text-sm font-medium text-gray-900 focus:border-gray-300 focus:outline-none dark:text-white dark:focus:border-gray-600"
                      />
                      <div class="flex items-center space-x-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          v-if="isSensitive(key)"
                          @click="toggleReveal(key)"
                          class="rounded p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                        >
                          <svg v-if="revealedKeys.has(key)" class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L6.5 6.5m7.378 7.378L17.5 17.5M3 3l18 18" />
                          </svg>
                          <svg v-else class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                        </button>
                        <button
                          @click="removeVar(key)"
                          class="rounded p-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400"
                        >
                          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    <input
                      :value="localVars[key]"
                      :type="isSensitive(key) && !revealedKeys.has(key) ? 'password' : 'text'"
                      @blur="updateVarValue(key, $event.target.value)"
                      @keydown.enter="$event.target.blur()"
                      autocomplete="off"
                      spellcheck="false"
                      class="mt-1 w-full border-b border-dashed border-transparent bg-transparent font-mono text-sm text-gray-500 focus:border-gray-300 focus:outline-none dark:text-gray-400 dark:focus:border-gray-600"
                    />
                  </div>
                </div>
                <div v-else class="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                  No app-specific variables set.
                </div>
                <div class="px-4 pb-3">
                  <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input
                      v-model="newKey"
                      type="text"
                      placeholder="KEY"
                      class="w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 font-mono text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none sm:flex-1 dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
                      @keydown.enter="addVar"
                    />
                    <input
                      v-model="newValue"
                      type="text"
                      placeholder="value"
                      class="w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 font-mono text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none sm:flex-1 dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
                      @keydown.enter="addVar"
                    />
                    <button
                      v-if="shouldShowGenerate(newKey)"
                      @click="generateSecret"
                      type="button"
                      class="w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 sm:w-auto dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      Generate
                    </button>
                    <button
                      @click="addVar"
                      :disabled="!newKey.trim() || savingVars"
                      class="w-full rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 sm:w-auto dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </template>
            </div>
          </div>

          <!-- Services (read-only) -->
          <div>
            <div class="flex items-center justify-between px-4 py-3">
              <button
                @click="servicesOpen = !servicesOpen"
                class="flex flex-1 items-center space-x-3 text-left hover:opacity-80"
              >
                <h2 class="text-sm font-medium text-gray-900 dark:text-white">Services</h2>
                <span class="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                  {{ services.length }}
                </span>
              </button>
              <button
                @click="servicesOpen = !servicesOpen"
                class="rounded p-0.5 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <svg
                  :class="['h-4 w-4 text-gray-400 transition-transform duration-200', servicesOpen ? 'rotate-90' : '']"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
            <div v-show="servicesOpen">
              <div v-if="services.length > 0" class="space-y-1 border-t border-gray-200 px-4 py-3 dark:border-gray-800">
                <div
                  v-for="service in services"
                  :key="service.id"
                  class="rounded-md py-2"
                >
                  <div class="flex items-center justify-between">
                    <div class="flex items-center space-x-3">
                      <span class="inline-flex h-7 w-7 items-center justify-center rounded bg-gray-100 text-[10px] font-bold text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                        {{ serviceIcon(service.type) }}
                      </span>
                      <div>
                        <Link
                          :href="`/projects/${project.slug}/environments/${environment.slug}/services/${service.id}`"
                          class="text-sm font-medium text-gray-900 underline decoration-dashed decoration-gray-300 underline-offset-2 hover:text-gray-700 dark:text-white dark:decoration-gray-600 dark:hover:text-gray-300"
                        >{{ service.name }}</Link>
                        <span class="ml-2 text-xs text-gray-400 dark:text-gray-500">{{ service.type }}</span>
                      </div>
                    </div>
                    <div class="flex items-center space-x-2">
                      <span :class="['inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium', statusBadge(service.status).classes]">
                        {{ statusBadge(service.status).label }}
                      </span>
                      <Tooltip v-if="['postgresql', 'mysql', 'mongodb', 'redis'].includes(service.type) && service.status === 'running'" text="Dock">
                        <Link
                          :href="`/projects/${project.slug}/environments/${environment.slug}/dock/${service.id}`"
                          class="rounded p-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                        >
                          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
                          </svg>
                        </Link>
                      </Tooltip>
                    </div>
                  </div>
                  <div v-if="service.connectionUrl" class="group mt-2 flex items-center gap-2">
                    <p class="truncate font-mono text-xs text-gray-500 dark:text-gray-400">
                      {{ revealedServiceUrls.has(service.id) ? service.connectionUrl : service.connectionUrl.replace(/\/\/.*@/, '//***:***@') }}
                    </p>
                    <button
                      @click="toggleServiceUrlReveal(service.id)"
                      class="shrink-0 rounded p-0.5 text-gray-400 opacity-0 transition-opacity hover:text-gray-600 group-hover:opacity-100 dark:hover:text-gray-300"
                    >
                      <svg v-if="revealedServiceUrls.has(service.id)" class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L6.5 6.5m7.378 7.378L17.5 17.5M3 3l18 18" />
                      </svg>
                      <svg v-else class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    </button>
                    <button
                      @click="copyToClipboard(service.connectionUrl)"
                      class="shrink-0 rounded p-0.5 text-gray-400 opacity-0 transition-opacity hover:text-gray-600 group-hover:opacity-100 dark:hover:text-gray-300"
                    >
                      <svg v-if="copiedText === service.connectionUrl" class="h-3.5 w-3.5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                      </svg>
                      <svg v-else class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
              <div v-else class="border-t border-gray-200 px-4 py-6 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
                No services attached.
              </div>
              <div class="border-t border-gray-200 px-4 py-3 dark:border-gray-800">
                <Link
                  :href="`/projects/${project.slug}/environments/${environment.slug}?services=1`"
                  class="text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                >
                  Manage services &rarr;
                </Link>
              </div>
            </div>
          </div>

        </div>

        <!-- Deployments -->
        <div>
          <h2 class="mb-4 text-sm font-medium text-gray-900 dark:text-white">Deployments</h2>

          <div v-if="deployments.length > 0" class="rounded-lg border border-gray-200 dark:border-gray-800">
            <div class="divide-y divide-gray-200 bg-white dark:divide-gray-800 dark:bg-gray-950 rounded-lg">
              <Link
                v-for="dep in deployments"
                :key="dep.id"
                :href="`/projects/${project.slug}/deployments/${dep.id}`"
                class="flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-900/50"
              >
                <div class="flex items-center space-x-3">
                  <span
                    :class="[
                      'h-2 w-2 rounded-full',
                      dep.status === 'running' ? 'bg-green-500' :
                      dep.status === 'failed' ? 'bg-red-500' :
                      dep.status === 'building' || dep.status === 'deploying' ? 'bg-blue-500' :
                      dep.status === 'cancelled' || dep.status === 'stopped' ? 'bg-gray-400' :
                      'bg-yellow-500'
                    ]"
                  ></span>
                  <span :class="['inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium', statusBadge(dep.status).classes]">
                    {{ statusBadge(dep.status).label }}
                  </span>
                  <span class="inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                    {{ app.name }}
                  </span>
                  <span v-if="dep.gitBranch" class="text-xs text-gray-500 dark:text-gray-400">
                    {{ dep.gitBranch }}
                  </span>
                  <span v-if="dep.gitCommit" class="font-mono text-xs text-gray-400 dark:text-gray-500">
                    {{ dep.gitCommit.slice(0, 7) }}
                  </span>
                </div>
                <div class="flex items-center space-x-4">
                  <span class="text-xs text-gray-500 dark:text-gray-400">
                    {{ dep.triggeredBy?.fullName || (dep.triggerType === 'webhook' ? 'Git' : 'System') }}
                  </span>
                  <span class="text-xs text-gray-400 dark:text-gray-500">
                    {{ timeAgo(dep.createdAt) }}
                  </span>
                </div>
              </Link>
            </div>
          </div>

          <div v-else class="rounded-lg border border-dashed border-gray-300 px-6 py-8 text-center dark:border-gray-700">
            <p class="text-sm text-gray-500 dark:text-gray-400">No deployments yet.</p>
            <p class="mt-1 text-sm text-gray-400 dark:text-gray-500">
              Slide to deploy your first version.
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- Custom Domain Modal -->
    <Teleport to="body">
      <Transition
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="opacity-0"
        enter-to-class="opacity-100"
        leave-active-class="transition duration-150 ease-in"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
      >
        <div v-if="domainModalOpen" class="fixed inset-0 z-50 flex items-center justify-center">
          <div class="fixed inset-0 bg-black/50" @click="closeDomainModal" />
          <Transition
            enter-active-class="transition duration-200 ease-out"
            enter-from-class="scale-95 opacity-0"
            enter-to-class="scale-100 opacity-100"
            leave-active-class="transition duration-150 ease-in"
            leave-from-class="scale-100 opacity-100"
            leave-to-class="scale-95 opacity-0"
          >
            <div
              v-if="domainModalOpen"
              class="relative w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6 shadow-xl dark:border-gray-700 dark:bg-gray-900"
            >
              <h3 class="text-lg font-semibold text-gray-900 dark:text-white">Custom domain</h3>
              <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
                Point your domain to <code class="rounded bg-gray-100 px-1 py-0.5 font-mono text-xs dark:bg-gray-800">{{ environment.serverIp }}</code> with an A record. SSL is provisioned automatically.
              </p>
              <div class="mt-4">
                <input
                  v-model="newDomain"
                  type="text"
                  placeholder="app.example.com"
                  class="w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
                  @keydown.enter="saveCustomDomain"
                />
              </div>
              <div class="mt-4 flex justify-end space-x-3">
                <button
                  @click="closeDomainModal"
                  class="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  Cancel
                </button>
                <button
                  @click="saveCustomDomain"
                  :disabled="savingDomain"
                  class="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
                >
                  {{ savingDomain ? 'Saving...' : 'Save' }}
                </button>
              </div>
            </div>
          </Transition>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
