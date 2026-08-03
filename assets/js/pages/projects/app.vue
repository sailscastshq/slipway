<script setup>
import { Link, Head, router } from '@inertiajs/vue3'
import {
  inject,
  ref,
  reactive,
  computed,
  watch,
  nextTick,
  onMounted,
  onBeforeUnmount
} from 'vue'
import { useEventSource } from '@/composables/sse'
import AppLayout from '@/layouts/AppLayout.vue'
import Breadcrumb from '@/components/Breadcrumb.vue'
import SlideToDeploy from '@/components/SlideToDeploy.vue'
import Tooltip from '@/components/Tooltip.vue'
import CodeEditor from '@/components/CodeEditor.vue'
import ConfigVariableMenu from '@/components/ConfigVariableMenu.vue'
import ReleaseFlagMenu from '@/components/ReleaseFlagMenu.vue'
import { useToast } from '@/composables/toast'
import SlippyLoader from '@/components/SlippyLoader.vue'
import DeploymentHistory from '@/components/DeploymentHistory.vue'
import { highlightLogLine } from '@/lib/highlightLog'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  project: Object,
  environment: Object,
  app: Object,
  appEnvVars: Object,
  appEnvVarMetadata: Object,
  inheritedVars: Object,
  deploymentHistory: Object,
  services: Array,
  backupConfigured: Boolean,
  checklist: Array,
  sourceReadiness: Object,
  releaseFlags: Array,
  canManageBridge: Boolean
})

const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')
const toast = useToast()

// --- Deploy ---
const deploying = ref(false)
const slideRef = ref(null)

const checklistAllGood = computed(() => {
  return (
    (props.checklist || []).length === 1 &&
    props.checklist[0].severity === 'success'
  )
})

const sourceIsReady = computed(() => props.sourceReadiness?.available === true)

async function triggerDeploy() {
  if (deploying.value) return
  deploying.value = true
  try {
    const res = await fetch(
      `/api/v1/projects/${props.project.slug}/environments/${props.environment.slug}/apps/${props.app.slug}/deploy`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }
    )
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast({
        message:
          data.message ||
          'Slipway could not start this deployment. Check the source configuration and try again.',
        type: 'error',
        duration: 8000
      })
      slideRef.value?.reset()
      deploying.value = false
      return
    }
    if (data.deployment) {
      router.visit(
        `/projects/${props.project.slug}/deployments/${data.deployment.id}`
      )
    } else {
      slideRef.value?.reset()
      deploying.value = false
    }
  } catch {
    toast({
      message: 'Slipway could not reach the deployment service. Try again.',
      type: 'error'
    })
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
    await fetch(
      `/api/v1/projects/${props.project.slug}/environments/${props.environment.slug}/apps/${props.app.slug}/restart`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }
    )
    router.reload({ only: ['app'] })
  } finally {
    restarting.value = false
  }
}

async function stopApp() {
  stopping.value = true
  try {
    await fetch(
      `/api/v1/projects/${props.project.slug}/environments/${props.environment.slug}/apps/${props.app.slug}/stop`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }
    )
    router.reload({ only: ['app'] })
  } finally {
    stopping.value = false
  }
}

async function handleRestartAppClick() {
  moreMenuOpen.value = false
  await restartApp()
}

async function handleStopAppClick() {
  moreMenuOpen.value = false
  await stopApp()
}

// --- Domain display ---
const domainDropdownOpen = ref(false)
const copiedText = ref(null)
const moreMenuOpen = ref(false)

const accessUrls = computed(() => props.app.accessUrls || [])

const primaryAccessUrl = computed(() => accessUrls.value[0] || null)
const hasMultipleAccessUrls = computed(() => accessUrls.value.length > 1)

function copyToClipboard(text) {
  navigator.clipboard.writeText(text)
  copiedText.value = text
  setTimeout(() => {
    copiedText.value = null
  }, 2000)
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
    const res = await fetch(
      `/api/v1/projects/${props.project.slug}/environments/${props.environment.slug}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: newDomain.value.trim() })
      }
    )
    if (res.ok) {
      toast({
        message: newDomain.value.trim()
          ? 'Custom domain saved'
          : 'Custom domain removed',
        type: 'success'
      })
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
  if (['building', 'deploying', 'creating'].includes(app.status))
    return statusStyles.blue
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
    building: 'Building',
    deploying: 'Deploying',
    pending: 'Pending',
    starting: 'Starting',
    failed: 'Failed',
    stopped: 'Stopped',
    cancelled: 'Cancelled',
    creating: 'Creating'
  }
  return labels[app.status] || app.status
}

function statusBadge(status) {
  const map = {
    running: {
      label: 'Running',
      classes:
        'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
    },
    building: {
      label: 'Building',
      classes:
        'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
    },
    deploying: {
      label: 'Deploying',
      classes:
        'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
    },
    pending: {
      label: 'Pending',
      classes:
        'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
    },
    failed: {
      label: 'Failed',
      classes: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
    },
    stopped: {
      label: 'Stopped',
      classes: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
    },
    cancelled: {
      label: 'Cancelled',
      classes: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
    },
    creating: {
      label: 'Creating',
      classes:
        'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
    }
  }
  return (
    map[status] || {
      label: status,
      classes: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
    }
  )
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
    if (count >= 1)
      return `${count} ${interval.label}${count > 1 ? 's' : ''} ago`
  }
  return 'just now'
}

// --- Platform tools ---
const services = computed(() => props.services || [])

const hasDatabaseService = computed(() => {
  return services.value.some(
    (s) =>
      ['postgresql', 'mysql', 'mongodb', 'redis'].includes(s.type) &&
      s.status === 'running'
  )
})

const firstDatabaseService = computed(() => {
  return services.value.find(
    (s) =>
      ['postgresql', 'mysql', 'mongodb'].includes(s.type) &&
      s.status === 'running'
  )
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
const localMetadata = reactive({ ...props.appEnvVarMetadata })
watch(
  () => props.appEnvVars,
  (newVars) => {
    Object.keys(localVars).forEach((k) => delete localVars[k])
    Object.assign(localVars, newVars)
  }
)
watch(
  () => props.appEnvVarMetadata,
  (newMetadata) => {
    Object.keys(localMetadata).forEach((k) => delete localMetadata[k])
    Object.assign(localMetadata, newMetadata || {})
  }
)
const revealedKeys = ref(new Set())
const newKey = ref('')
const newValue = ref('')
const savingVars = ref(false)
const _params = new URLSearchParams(window.location.search)
const envVarsOpen = ref(_params.has('env') || _params.has('bulk'))
const bulkMode = ref(_params.has('bulk'))
const bulkText = ref('')

const sortedVarKeys = computed(() => Object.keys(localVars).sort())

function enterBulkMode() {
  bulkText.value = sortedVarKeys.value
    .map((k) => `${k}=${localVars[k]}`)
    .join('\n')
  bulkMode.value = true
}

function exitBulkMode() {
  bulkMode.value = false
}

async function saveBulk() {
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
  const nextMetadata = Object.fromEntries(
    Object.keys(vars).map((key) => [
      key,
      localMetadata[key] || { kind: 'secret', previewPolicy: 'omit' }
    ])
  )
  if (!(await saveEnvVars(vars, nextMetadata))) return
  Object.keys(localVars).forEach((k) => delete localVars[k])
  Object.assign(localVars, vars)
  Object.keys(localMetadata).forEach((key) => delete localMetadata[key])
  Object.assign(localMetadata, nextMetadata)
  bulkMode.value = false
}

function metadataFor(key) {
  const metadata = localMetadata[key] || {}
  const kind = metadata.kind === 'plain' ? 'plain' : 'secret'
  return {
    ...metadata,
    kind,
    managed: metadata.managed === true,
    previewPolicy:
      metadata.previewPolicy || (kind === 'plain' ? 'inherit' : 'omit')
  }
}

function isSensitive(key) {
  return metadataFor(key).kind === 'secret'
}

function metadataSummary(key) {
  const metadata = metadataFor(key)
  const type = metadata.kind === 'secret' ? 'Secret' : 'Plain config'
  const preview = {
    omit: 'omitted from previews',
    inherit: 'inherited by previews',
    randomize: 'regenerated for previews'
  }[metadata.previewPolicy]
  return `${type} · ${preview}`
}

function changeSummary(key) {
  const metadata = metadataFor(key)
  return [
    metadata.changedByName,
    metadata.changedAt ? timeAgo(metadata.changedAt) : null
  ]
    .filter(Boolean)
    .join(' · ')
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
  newValue.value = Array.from(bytes, (b) =>
    b.toString(16).padStart(2, '0')
  ).join('')
}

async function saveEnvVars(vars = localVars, metadata = localMetadata) {
  savingVars.value = true
  try {
    const response = await fetch(
      `/api/v1/projects/${props.project.slug}/environments/${props.environment.slug}/apps/${props.app.slug}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          envVars: { ...vars },
          envVarMetadata: { ...metadata }
        })
      }
    )
    if (!response.ok) {
      throw new Error('Environment variables could not be saved.')
    }
    router.reload({ only: ['appEnvVars', 'appEnvVarMetadata'] })
    return true
  } catch (error) {
    toast({ message: error.message, type: 'error' })
    router.reload({
      only: ['appEnvVars', 'appEnvVarMetadata'],
      preserveScroll: true
    })
    return false
  } finally {
    savingVars.value = false
  }
}

async function addVar() {
  if (!newKey.value.trim()) return
  const key = newKey.value.trim()
  const nextVars = { ...localVars, [key]: newValue.value }
  const nextMetadata = {
    ...localMetadata,
    [key]: { kind: 'secret', previewPolicy: 'omit' }
  }
  if (!(await saveEnvVars(nextVars, nextMetadata))) return
  Object.assign(localVars, nextVars)
  Object.assign(localMetadata, nextMetadata)
  newKey.value = ''
  newValue.value = ''
}

async function removeVar(key) {
  const nextVars = { ...localVars }
  const nextMetadata = { ...localMetadata }
  delete nextVars[key]
  delete nextMetadata[key]
  if (!(await saveEnvVars(nextVars, nextMetadata))) return
  delete localVars[key]
  delete localMetadata[key]
}

async function renameVar(oldKey, el) {
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
  const nextVars = { ...localVars }
  const nextMetadata = { ...localMetadata }
  const value = nextVars[oldKey]
  const metadata = metadataFor(oldKey)
  delete nextVars[oldKey]
  delete nextMetadata[oldKey]
  nextVars[trimmed] = value
  nextMetadata[trimmed] = metadata
  if (!(await saveEnvVars(nextVars, nextMetadata))) return
  delete localVars[oldKey]
  delete localMetadata[oldKey]
  localVars[trimmed] = value
  localMetadata[trimmed] = metadata
  toast({ message: `Renamed "${oldKey}" to "${trimmed}"`, type: 'success' })
}

async function updateVarMetadata(key, metadata) {
  const nextMetadata = { ...localMetadata, [key]: metadata }
  if (!(await saveEnvVars(localVars, nextMetadata))) return
  localMetadata[key] = metadata
  toast({ message: `Updated "${key}"`, type: 'success' })
}

async function updateVarValue(key, value) {
  if (localVars[key] === value) return
  const nextVars = { ...localVars, [key]: value }
  if (!(await saveEnvVars(nextVars, localMetadata))) return
  localVars[key] = value
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

// --- Release flags ---
const releaseFlagsOpen = ref(_params.has('flags'))
const localReleaseFlags = ref([...(props.releaseFlags || [])])
const newFlagKey = ref('')
const savingFlag = ref(false)

watch(
  () => props.releaseFlags,
  (flags) => {
    localReleaseFlags.value = [...(flags || [])]
  },
  { deep: true }
)

const validNewFlagKey = computed(() =>
  /^[a-z][a-z0-9-]{0,63}$/.test(newFlagKey.value.trim())
)

function flagSummary(flag) {
  if (!flag.enabled) return 'Off'
  const parts = []
  if (flag.rolloutPercentage === 100) parts.push('Everyone')
  else if (flag.rolloutPercentage > 0) parts.push(`${flag.rolloutPercentage}%`)
  if (flag.targets?.length)
    parts.push(
      `${flag.targets.length} target${flag.targets.length === 1 ? '' : 's'}`
    )
  return parts.join(' · ') || 'No audience'
}

function flagUrl(flag) {
  const base = `/api/v1/projects/${props.project.slug}/environments/${props.environment.slug}/apps/${props.app.slug}/flags`
  return flag ? `${base}/${flag.id}` : base
}

async function flagRequest(url, options) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const firstProblem = data.problems?.[0]
    throw new Error(
      firstProblem
        ? Object.values(firstProblem)[0]
        : data.message || 'Release flag could not be saved.'
    )
  }
  return data
}

async function createReleaseFlag() {
  if (!validNewFlagKey.value || savingFlag.value) return
  savingFlag.value = true
  try {
    const data = await flagRequest(flagUrl(), {
      method: 'POST',
      body: JSON.stringify({ key: newFlagKey.value.trim() })
    })
    localReleaseFlags.value.push(data.flag)
    localReleaseFlags.value.sort((a, b) => a.key.localeCompare(b.key))
    newFlagKey.value = ''
    toast({ message: 'Release flag created', type: 'success' })
  } catch (error) {
    toast({ message: error.message, type: 'error' })
  } finally {
    savingFlag.value = false
  }
}

async function updateReleaseFlag(flag, updates) {
  if (savingFlag.value) return
  savingFlag.value = true
  try {
    const data = await flagRequest(flagUrl(flag), {
      method: 'PATCH',
      body: JSON.stringify({
        description: flag.description,
        enabled: flag.enabled,
        rolloutPercentage: flag.rolloutPercentage,
        targets: flag.targets,
        ...updates
      })
    })
    const index = localReleaseFlags.value.findIndex(
      (candidate) => candidate.id === flag.id
    )
    if (index >= 0) localReleaseFlags.value[index] = data.flag
  } catch (error) {
    toast({ message: error.message, type: 'error' })
  } finally {
    savingFlag.value = false
  }
}

async function removeReleaseFlag(flag) {
  if (savingFlag.value) return
  savingFlag.value = true
  try {
    await flagRequest(flagUrl(flag), { method: 'DELETE' })
    localReleaseFlags.value = localReleaseFlags.value.filter(
      (candidate) => candidate.id !== flag.id
    )
    toast({ message: 'Release flag deleted', type: 'success' })
  } catch (error) {
    toast({ message: error.message, type: 'error' })
  } finally {
    savingFlag.value = false
  }
}

watch(releaseFlagsOpen, (open) => {
  const url = new URL(window.location)
  if (open) url.searchParams.set('flags', '1')
  else url.searchParams.delete('flags')
  window.history.replaceState({}, '', url)
})

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
    bulkText.value = sortedVarKeys.value
      .map((k) => `${k}=${localVars[k]}`)
      .join('\n')
  }
  document.addEventListener('keydown', handleEscapeKey)
})

onBeforeUnmount(() => {
  disconnectLogs()
  document.removeEventListener('keydown', handleEscapeKey)
})
</script>
<template>
  <Head
    :title="`${app.name} - ${environment.name} - ${project.name} | Slipway`"
  ></Head>
  <div class="flex h-full flex-col" @click="closeAllDropdowns">
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
        <!-- Desktop sidebar toggle -->
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
            { label: app.name.toLowerCase() }
          ]"
        />
      </div>
      <div class="flex items-center space-x-4">
        <a
          href="https://docs.sailscasts.com/slipway"
          target="_blank"
          class="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
        >
          Docs
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
      <div class="mx-auto max-w-6xl">
        <!-- App Info -->
        <div class="mb-8 flex items-start justify-between">
          <div>
            <div class="flex items-center space-x-3">
              <h1 class="text-xl font-semibold text-gray-900 dark:text-white">
                {{ app.name }}
              </h1>
              <span
                v-if="environment.isProduction"
                class="inline-flex rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
              >
                Production
              </span>
            </div>
            <!-- Domain display -->
            <div
              v-if="primaryAccessUrl"
              data-test="app-access-urls"
              class="relative mt-1 inline-flex items-center"
            >
              <div class="group flex items-center gap-2">
                <a
                  :href="primaryAccessUrl.href"
                  :title="primaryAccessUrl.hint"
                  target="_blank"
                  class="text-sm text-gray-500 underline decoration-gray-300 decoration-dashed underline-offset-2 hover:text-gray-900 dark:text-gray-400 dark:decoration-gray-600 dark:hover:text-white"
                >
                  {{ primaryAccessUrl.display }}
                </a>
                <button
                  @click.prevent="copyToClipboard(primaryAccessUrl.value)"
                  class="rounded p-0.5 text-gray-300 opacity-0 transition-opacity hover:text-gray-500 group-hover:opacity-100 dark:text-gray-600 dark:hover:text-gray-400"
                >
                  <svg
                    v-if="copiedText === primaryAccessUrl.value"
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
                <button
                  v-if="hasMultipleAccessUrls"
                  data-test="app-access-urls-toggle"
                  @click.stop="domainDropdownOpen = !domainDropdownOpen"
                  class="rounded p-0.5 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                >
                  <svg
                    :class="[
                      'h-3.5 w-3.5 transition-transform duration-200',
                      domainDropdownOpen ? 'rotate-180' : ''
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
              </div>

              <!-- Domain dropdown -->
              <div
                v-if="domainDropdownOpen && hasMultipleAccessUrls"
                data-test="app-access-urls-menu"
                @click.stop
                class="absolute left-0 top-full z-20 mt-1.5 w-max rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
              >
                <div
                  v-for="d in accessUrls"
                  :key="d.value"
                  :data-test="`app-access-url-${d.kind}`"
                  class="group/item flex items-center gap-2 px-3 py-2"
                >
                  <span
                    class="w-16 text-[10px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500"
                    >{{ d.label }}</span
                  >
                  <a
                    :href="d.href"
                    :title="d.hint"
                    target="_blank"
                    class="text-sm text-gray-700 underline decoration-gray-300 decoration-dashed underline-offset-2 hover:text-gray-900 dark:text-gray-300 dark:decoration-gray-600 dark:hover:text-white"
                  >
                    {{ d.display }}
                  </a>
                  <button
                    @click="copyToClipboard(d.value)"
                    class="rounded p-0.5 text-gray-300 opacity-0 transition-opacity hover:text-gray-500 group-hover/item:opacity-100 dark:text-gray-600 dark:hover:text-gray-400"
                  >
                    <svg
                      v-if="copiedText === d.value"
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
                </div>
              </div>
            </div>
            <p
              v-if="app.directAccess?.status === 'unavailable'"
              data-test="direct-access-diagnostic"
              class="mt-1 max-w-2xl text-xs text-amber-700 dark:text-amber-400"
            >
              {{ app.directAccess.message }}
            </p>
          </div>
          <div class="flex items-center space-x-2">
            <!-- More menu -->
            <div class="relative">
              <button
                data-test="app-more-menu"
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
                  <div
                    v-if="app.status === 'running'"
                    class="border-b border-gray-100 pb-1 dark:border-gray-800"
                  >
                    <Link
                      :href="`/projects/${project.slug}/environments/${environment.slug}/helm?appSlug=${app.slug}`"
                      class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      <svg
                        class="h-4 w-4 text-gray-400"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                        />
                      </svg>
                      Helm
                    </Link>
                    <Link
                      :href="`/projects/${project.slug}/environments/${environment.slug}/apps/${app.slug}/bridge`"
                      class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      <svg
                        class="h-4 w-4 text-gray-400"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                        />
                      </svg>
                      Bridge in Slipway
                    </Link>
                    <a
                      v-if="app.bridgeEnabled && app.bridgeUrl"
                      :href="app.bridgeUrl"
                      target="_blank"
                      rel="noopener"
                      class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      <svg
                        class="h-4 w-4 text-gray-400"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                        />
                      </svg>
                      Public Bridge
                    </a>
                    <Link
                      v-if="hasDatabaseService"
                      :href="`/projects/${project.slug}/environments/${
                        environment.slug
                      }/dock${
                        firstDatabaseService
                          ? '/' + firstDatabaseService.id
                          : ''
                      }`"
                      class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      <svg
                        class="h-4 w-4 text-gray-400"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"
                        />
                      </svg>
                      Dock
                    </Link>
                    <Link
                      v-if="
                        environment.features &&
                        environment.features['sails-quest']
                      "
                      :href="`/projects/${project.slug}/environments/${environment.slug}/quest`"
                      class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      <svg
                        class="h-4 w-4 text-gray-400"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                      </svg>
                      Quest
                    </Link>
                    <Link
                      v-if="
                        environment.features &&
                        environment.features['sails-content']
                      "
                      :href="`/projects/${project.slug}/environments/${environment.slug}/content?appSlug=${app.slug}`"
                      class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      <svg
                        class="h-4 w-4 text-gray-400"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                        />
                      </svg>
                      Content
                    </Link>
                    <Link
                      :href="`/projects/${project.slug}/environments/${environment.slug}/lookout`"
                      class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      <svg
                        class="h-4 w-4 text-gray-400"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                        />
                      </svg>
                      Lookout
                    </Link>
                  </div>
                  <!-- Container controls -->
                  <div
                    v-if="app.status === 'running'"
                    class="border-b border-gray-100 py-1 dark:border-gray-800"
                  >
                    <button
                      @click="handleRestartAppClick"
                      :disabled="restarting"
                      class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      <SlippyLoader
                        v-if="restarting"
                        size="h-4 w-4"
                        class="text-gray-400"
                      />
                      <svg
                        v-else
                        class="h-4 w-4 text-gray-400"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                        />
                      </svg>
                      Restart
                    </button>
                    <button
                      @click="handleStopAppClick"
                      :disabled="stopping"
                      class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                    >
                      <svg
                        class="h-4 w-4"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
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
                      <svg
                        class="h-4 w-4 text-gray-400"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"
                        />
                      </svg>
                      Custom domain
                      <span
                        v-if="environment.domain"
                        class="ml-auto h-1.5 w-1.5 rounded-full bg-emerald-500"
                      ></span>
                    </button>
                    <Link
                      v-if="canManageBridge"
                      :href="`/projects/${project.slug}/environments/${environment.slug}/apps/${app.slug}/bridge/access`"
                      class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      <svg
                        class="h-4 w-4 text-gray-400"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2m7-10a4 4 0 100-8 4 4 0 000 8zm13 10v-2a4 4 0 00-3-3.87m-1-8a4 4 0 010 7.75"
                        />
                      </svg>
                      Bridge access
                    </Link>
                    <Link
                      :href="`/projects/${project.slug}/environments/${environment.slug}/apps/${app.slug}/settings`"
                      class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      <svg
                        class="h-4 w-4 text-gray-400"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                        />
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                        />
                      </svg>
                      Settings
                    </Link>
                  </div>
                </div>
              </Transition>
            </div>
            <span
              :class="[
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium',
                appStatusClasses(app).bg
              ]"
            >
              <span
                :class="['h-1.5 w-1.5 rounded-full', appStatusClasses(app).dot]"
              ></span>
              <span :class="appStatusClasses(app).text">{{
                appStatusLabel(app)
              }}</span>
            </span>
          </div>
        </div>

        <section
          v-if="!sourceIsReady"
          role="alert"
          aria-labelledby="deployment-source-warning-title"
          data-test="deployment-source-warning"
          class="mb-4 rounded-lg border border-amber-200 bg-amber-50/50 dark:border-amber-900/50 dark:bg-amber-950/20"
        >
          <div class="flex items-start justify-between gap-3 px-4 py-3">
            <div class="flex min-w-0 items-start gap-3">
              <svg
                class="mt-0.5 h-4 w-4 shrink-0 text-amber-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
                />
              </svg>
              <div class="min-w-0">
                <h2
                  id="deployment-source-warning-title"
                  class="text-sm font-medium text-amber-800 dark:text-amber-300"
                >
                  Deployment source required
                </h2>
                <p
                  class="mt-1 text-xs leading-5 text-gray-600 dark:text-gray-400"
                >
                  {{ sourceReadiness?.message }}
                </p>
              </div>
            </div>
            <Link
              :href="`/projects/${project.slug}/environments/${environment.slug}/apps/${app.slug}/settings`"
              class="shrink-0 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-400 dark:hover:bg-amber-900/50"
            >
              Configure source
            </Link>
          </div>
        </section>

        <!-- Slide to Deploy -->
        <div class="mb-10 flex justify-end">
          <div class="w-56">
            <SlideToDeploy
              ref="slideRef"
              :is-production="environment.isProduction"
              :environment-name="environment.name"
              :disabled="deploying || !checklistAllGood || !sourceIsReady"
              @deploy="triggerDeploy"
            />
          </div>
        </div>

        <!-- Accordion: Logs, App Variables, Services, Deployments -->
        <div
          class="mb-10 divide-y divide-gray-200 rounded-lg border border-gray-200 dark:divide-gray-800 dark:border-gray-800"
        >
          <!-- Logs -->
          <div>
            <div class="flex items-center justify-between px-4 py-3">
              <button
                @click="logsOpen = !logsOpen"
                class="flex flex-1 items-center space-x-3 text-left hover:opacity-80"
              >
                <h2 class="text-sm font-medium text-gray-900 dark:text-white">
                  Logs
                </h2>
                <span
                  v-if="logsConnected"
                  class="inline-flex items-center space-x-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400"
                >
                  <span
                    class="h-1.5 w-1.5 animate-pulse rounded-full bg-green-500"
                  ></span>
                  <span>Live</span>
                </span>
              </button>
              <button
                @click="logsOpen = !logsOpen"
                class="rounded p-0.5 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <svg
                  :class="[
                    'h-4 w-4 text-gray-400 transition-transform duration-200',
                    logsOpen ? 'rotate-90' : ''
                  ]"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M9 5l7 7-7 7"
                  />
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
                  @scroll="
                    autoScroll =
                      logContainer &&
                      logContainer.scrollHeight -
                        logContainer.scrollTop -
                        logContainer.clientHeight <
                        40
                  "
                >
                  <div
                    v-if="!logsConnected && logLines.length === 0"
                    class="flex h-full items-center justify-center text-gray-500"
                  >
                    <SlippyLoader size="h-4 w-4" class="mr-2" />
                    Connecting to logs...
                  </div>
                  <div
                    v-else-if="logLines.length === 0 && logsConnected"
                    class="text-gray-500"
                  >
                    Waiting for output...
                  </div>
                  <template v-else>
                    <div
                      v-for="(line, i) in logLines"
                      :key="i"
                      class="whitespace-pre-wrap break-all hover:bg-gray-200/50 dark:hover:bg-gray-900/50"
                      v-html="highlightLogLine(line)"
                    ></div>
                  </template>
                </div>
              </div>
            </div>
          </div>

          <!-- App Variables -->
          <div data-test="app-config">
            <div class="flex items-center justify-between px-4 py-3">
              <button
                @click="envVarsOpen = !envVarsOpen"
                class="flex flex-1 items-center space-x-3 text-left hover:opacity-80"
              >
                <h2 class="text-sm font-medium text-gray-900 dark:text-white">
                  Environment variables
                </h2>
                <span
                  class="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                >
                  {{ sortedVarKeys.length }}
                </span>
              </button>
              <div class="flex items-center gap-2">
                <Tooltip
                  v-if="envVarsOpen"
                  :text="bulkMode ? 'Single edit' : 'Bulk edit'"
                >
                  <button
                    @click="bulkMode ? exitBulkMode() : enterBulkMode()"
                    class="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                  >
                    <svg
                      v-if="bulkMode"
                      class="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M4 6h16M4 12h16M4 18h16"
                      />
                    </svg>
                    <svg
                      v-else
                      class="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
                      />
                    </svg>
                  </button>
                </Tooltip>
                <button
                  @click="envVarsOpen = !envVarsOpen"
                  class="rounded p-0.5 hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  <svg
                    :class="[
                      'h-4 w-4 text-gray-400 transition-transform duration-200',
                      envVarsOpen ? 'rotate-90' : ''
                    ]"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </button>
              </div>
            </div>
            <div v-show="envVarsOpen">
              <template v-if="bulkMode">
                <div class="border-t border-gray-200 dark:border-gray-800">
                  <CodeEditor
                    v-model="bulkText"
                    language="env"
                    aria-label="Application environment variables"
                    test-id="app-env-editor"
                    class="bg-gray-50 dark:bg-gray-950"
                    placeholder="KEY=value&#10;DATABASE_URL=postgres://localhost:5432/db&#10;# Comments are ignored"
                  />
                  <div
                    class="flex items-center justify-between border-t border-gray-200 px-4 py-3 dark:border-gray-800"
                  >
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
                <div
                  v-if="sortedVarKeys.length > 0"
                  class="space-y-1 px-4 pb-2"
                >
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
                        class="min-w-0 flex-1 border-b border-dashed border-transparent bg-transparent font-mono text-sm font-medium text-gray-900 focus:border-gray-300 focus:outline-none dark:text-white dark:focus:border-gray-600"
                      />
                      <div
                        class="has-[details[open]]:visible invisible flex items-center space-x-1 focus-within:visible group-hover:visible"
                      >
                        <button
                          v-if="isSensitive(key)"
                          @click="toggleReveal(key)"
                          class="rounded p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                        >
                          <svg
                            v-if="revealedKeys.has(key)"
                            class="h-4 w-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                              d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L6.5 6.5m7.378 7.378L17.5 17.5M3 3l18 18"
                            />
                          </svg>
                          <svg
                            v-else
                            class="h-4 w-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                            />
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                              d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                            />
                          </svg>
                        </button>
                        <ConfigVariableMenu
                          :variable-key="key"
                          :metadata="metadataFor(key)"
                          @update="updateVarMetadata(key, $event)"
                          @remove="removeVar(key)"
                        />
                      </div>
                    </div>
                    <input
                      :value="localVars[key]"
                      :type="
                        isSensitive(key) && !revealedKeys.has(key)
                          ? 'password'
                          : 'text'
                      "
                      @blur="updateVarValue(key, $event.target.value)"
                      @keydown.enter="$event.target.blur()"
                      autocomplete="off"
                      spellcheck="false"
                      class="mt-1 w-full border-b border-dashed border-transparent bg-transparent font-mono text-sm text-gray-500 focus:border-gray-300 focus:outline-none dark:text-gray-400 dark:focus:border-gray-600"
                    />
                    <p class="mt-1 text-xs text-gray-400 dark:text-gray-500">
                      {{ metadataSummary(key) }}
                      <template v-if="changeSummary(key)">
                        · {{ changeSummary(key) }}
                      </template>
                    </p>
                  </div>
                </div>
                <div
                  v-else
                  class="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400"
                >
                  No app-specific variables set.
                </div>
                <div class="px-4 pb-3">
                  <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input
                      v-model="newKey"
                      type="text"
                      placeholder="KEY"
                      class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 font-mono text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500 sm:flex-1"
                      @keydown.enter="addVar"
                    />
                    <input
                      v-model="newValue"
                      type="text"
                      placeholder="value"
                      class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 font-mono text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500 sm:flex-1"
                      @keydown.enter="addVar"
                    />
                    <button
                      v-if="shouldShowGenerate(newKey)"
                      @click="generateSecret"
                      type="button"
                      class="w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800 sm:w-auto"
                    >
                      Generate
                    </button>
                    <button
                      @click="addVar"
                      :disabled="!newKey.trim() || savingVars"
                      class="w-full rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100 sm:w-auto"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </template>
            </div>
          </div>

          <!-- Release flags -->
          <div data-test="release-flags">
            <div class="flex items-center justify-between px-4 py-3">
              <button
                @click="releaseFlagsOpen = !releaseFlagsOpen"
                class="flex flex-1 items-center space-x-3 text-left hover:opacity-80"
              >
                <h2 class="text-sm font-medium text-gray-900 dark:text-white">
                  Release flags
                </h2>
                <span
                  class="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                >
                  {{ localReleaseFlags.length }}
                </span>
              </button>
              <button
                @click="releaseFlagsOpen = !releaseFlagsOpen"
                class="rounded p-0.5 hover:bg-gray-100 dark:hover:bg-gray-800"
                aria-label="Toggle release flags"
              >
                <svg
                  :class="[
                    'h-4 w-4 text-gray-400 transition-transform duration-200',
                    releaseFlagsOpen ? 'rotate-90' : ''
                  ]"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </button>
            </div>
            <div
              v-show="releaseFlagsOpen"
              class="border-t border-gray-200 dark:border-gray-800"
            >
              <div
                v-if="localReleaseFlags.length"
                class="divide-y divide-gray-100 px-4 dark:divide-gray-800"
              >
                <div
                  v-for="flag in localReleaseFlags"
                  :key="flag.id"
                  class="flex items-center gap-3 py-3"
                  :data-test="`release-flag-${flag.key}`"
                >
                  <div class="min-w-0 flex-1">
                    <div class="flex items-baseline gap-2">
                      <code
                        class="truncate text-sm font-medium text-gray-900 dark:text-white"
                        >{{ flag.key }}</code
                      >
                      <span class="shrink-0 text-xs text-gray-400">{{
                        flagSummary(flag)
                      }}</span>
                    </div>
                    <p
                      v-if="flag.description"
                      class="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400"
                    >
                      {{ flag.description }}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    :aria-checked="flag.enabled"
                    :aria-label="`${flag.enabled ? 'Disable' : 'Enable'} ${
                      flag.key
                    }`"
                    :disabled="savingFlag"
                    @click="updateReleaseFlag(flag, { enabled: !flag.enabled })"
                    :class="[
                      'relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50',
                      flag.enabled
                        ? 'bg-gray-900 dark:bg-white'
                        : 'bg-gray-200 dark:bg-gray-700'
                    ]"
                  >
                    <span
                      :class="[
                        'mt-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform dark:bg-gray-900',
                        flag.enabled ? 'translate-x-[18px]' : 'translate-x-0.5'
                      ]"
                    ></span>
                  </button>
                  <ReleaseFlagMenu
                    :flag="flag"
                    @update="updateReleaseFlag(flag, $event)"
                    @remove="removeReleaseFlag(flag)"
                  />
                </div>
              </div>
              <p
                v-else
                class="px-4 pt-5 text-center text-sm text-gray-500 dark:text-gray-400"
              >
                No release flags yet.
              </p>
              <div class="flex items-center gap-3 px-4 py-3">
                <input
                  v-model="newFlagKey"
                  type="text"
                  autocomplete="off"
                  spellcheck="false"
                  placeholder="new-checkout"
                  aria-label="Release flag key"
                  class="min-w-0 flex-1 border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 font-mono text-sm text-gray-900 placeholder-gray-400 focus:border-gray-500 focus:outline-none dark:border-gray-700 dark:text-white"
                  @keydown.enter="createReleaseFlag"
                />
                <button
                  type="button"
                  @click="createReleaseFlag"
                  :disabled="!validNewFlagKey || savingFlag"
                  class="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-40 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
                >
                  Add
                </button>
              </div>
            </div>
          </div>

          <!-- Services (read-only) -->
          <div>
            <div class="flex items-center justify-between px-4 py-3">
              <button
                @click="servicesOpen = !servicesOpen"
                class="flex flex-1 items-center space-x-3 text-left hover:opacity-80"
              >
                <h2 class="text-sm font-medium text-gray-900 dark:text-white">
                  Services
                </h2>
                <span
                  class="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                >
                  {{ services.length }}
                </span>
              </button>
              <button
                @click="servicesOpen = !servicesOpen"
                class="rounded p-0.5 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <svg
                  :class="[
                    'h-4 w-4 text-gray-400 transition-transform duration-200',
                    servicesOpen ? 'rotate-90' : ''
                  ]"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </button>
            </div>
            <div v-show="servicesOpen">
              <div
                v-if="services.length > 0"
                class="space-y-1 border-t border-gray-200 px-4 py-3 dark:border-gray-800"
              >
                <div
                  v-for="service in services"
                  :key="service.id"
                  class="rounded-md py-2"
                >
                  <div class="flex items-center justify-between">
                    <div class="flex items-center space-x-3">
                      <span
                        class="inline-flex h-7 w-7 items-center justify-center rounded bg-gray-100 text-[10px] font-bold text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                      >
                        {{ serviceIcon(service.type) }}
                      </span>
                      <div>
                        <Link
                          :href="`/projects/${project.slug}/environments/${environment.slug}/services/${service.id}`"
                          class="text-sm font-medium text-gray-900 underline decoration-gray-300 decoration-dashed underline-offset-2 hover:text-gray-700 dark:text-white dark:decoration-gray-600 dark:hover:text-gray-300"
                          >{{ service.name }}</Link
                        >
                        <span
                          class="ml-2 text-xs text-gray-400 dark:text-gray-500"
                          >{{ service.type }}</span
                        >
                      </div>
                    </div>
                    <div class="flex items-center space-x-2">
                      <span
                        :class="[
                          'inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium',
                          statusBadge(service.status).classes
                        ]"
                      >
                        {{ statusBadge(service.status).label }}
                      </span>
                      <Tooltip
                        v-if="
                          ['postgresql', 'mysql', 'mongodb', 'redis'].includes(
                            service.type
                          ) && service.status === 'running'
                        "
                        text="Dock"
                      >
                        <Link
                          :href="`/projects/${project.slug}/environments/${environment.slug}/dock/${service.id}`"
                          class="rounded p-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                        >
                          <svg
                            class="h-4 w-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                              d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"
                            />
                          </svg>
                        </Link>
                      </Tooltip>
                    </div>
                  </div>
                  <div
                    v-if="service.connectionUrl"
                    class="group mt-2 flex items-center gap-2"
                  >
                    <p
                      class="truncate font-mono text-xs text-gray-500 dark:text-gray-400"
                    >
                      {{
                        revealedServiceUrls.has(service.id)
                          ? service.connectionUrl
                          : service.connectionUrl.replace(
                              /\/\/.*@/,
                              '//***:***@'
                            )
                      }}
                    </p>
                    <button
                      @click="toggleServiceUrlReveal(service.id)"
                      class="shrink-0 rounded p-0.5 text-gray-400 opacity-0 transition-opacity hover:text-gray-600 group-hover:opacity-100 dark:hover:text-gray-300"
                    >
                      <svg
                        v-if="revealedServiceUrls.has(service.id)"
                        class="h-3.5 w-3.5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L6.5 6.5m7.378 7.378L17.5 17.5M3 3l18 18"
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
                          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                        />
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                        />
                      </svg>
                    </button>
                    <button
                      @click="copyToClipboard(service.connectionUrl)"
                      class="shrink-0 rounded p-0.5 text-gray-400 opacity-0 transition-opacity hover:text-gray-600 group-hover:opacity-100 dark:hover:text-gray-300"
                    >
                      <svg
                        v-if="copiedText === service.connectionUrl"
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
                  </div>
                </div>
              </div>
              <div
                v-else
                class="border-t border-gray-200 px-4 py-6 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400"
              >
                No services attached.
              </div>
              <div
                class="border-t border-gray-200 px-4 py-3 dark:border-gray-800"
              >
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

        <DeploymentHistory
          :history="deploymentHistory"
          empty-help="Slide to deploy your first version."
        />
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
        <div
          v-if="domainModalOpen"
          class="fixed inset-0 z-50 flex items-center justify-center"
        >
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
              <h3 class="text-lg font-semibold text-gray-900 dark:text-white">
                Custom domain
              </h3>
              <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
                Point your domain to
                <code
                  class="rounded bg-gray-100 px-1 py-0.5 font-mono text-xs dark:bg-gray-800"
                  >{{ environment.serverIp }}</code
                >
                with an A record. SSL is provisioned automatically.
              </p>
              <div class="mt-4">
                <input
                  v-model="newDomain"
                  type="text"
                  placeholder="app.example.com"
                  class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
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
