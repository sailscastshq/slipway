<script setup>
import { Link, Head, router, useForm } from '@inertiajs/vue3'
import { inject, ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'
import Breadcrumb from '@/components/Breadcrumb.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import SlideToDeploy from '@/components/SlideToDeploy.vue'
import Tooltip from '@/components/Tooltip.vue'
import { useToast } from '@/composables/toast'
import { useServiceActions } from '@/composables/service-actions'
import { useEventSource } from '@/composables/sse'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  project: Object,
  environment: Object,
  app: Object,
  apps: Array,
  envVars: Object,
  deployments: Array,
  checklist: Array,
  backupConfigured: Boolean,
  githubConnected: Boolean
})

const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')
const toast = useToast()
const { startAction, completeAction } = useServiceActions()

// --- Multi-app ---
const isMultiApp = computed(() => (props.apps || []).length > 1)
const sortedApps = computed(() => {
  const list = [...(props.apps || [])]
  list.sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0))
  return list
})

const appMenuOpen = ref(null)
const appSlideRefs = ref({})
const addAppOpen = ref(false)

// --- Create app form (Inertia) ---
const createAppForm = useForm({
  name: '',
  dockerfilePath: 'Dockerfile',
  routePath: '/',
  repoId: null,
  branch: null
})

// --- Repo picker state ---
const selectedRepo = ref(null)
const repos = ref([])
const loadingRepos = ref(false)
const repoSearch = ref('')
const repoDropdownOpen = ref(false)

// --- Branch picker state ---
const branches = ref([])
const loadingBranches = ref(false)
const selectedBranch = ref(null)

const filteredRepos = computed(() => {
  if (!repoSearch.value) return repos.value
  const q = repoSearch.value.toLowerCase()
  return repos.value.filter(r => r.fullName.toLowerCase().includes(q))
})

async function fetchRepos() {
  if (!props.githubConnected || repos.value.length > 0) return
  loadingRepos.value = true
  try {
    const res = await fetch('/api/v1/git/repos')
    const data = await res.json()
    repos.value = data.repos || []
  } catch {
    repos.value = []
  } finally {
    loadingRepos.value = false
  }
}

async function fetchBranches(repo) {
  loadingBranches.value = true
  branches.value = []
  try {
    const res = await fetch(`/api/v1/git/branches?owner=${repo.owner}&repo=${repo.name}`)
    const data = await res.json()
    branches.value = data.branches || []
    // Default to the repo's default branch
    selectedBranch.value = repo.defaultBranch
    createAppForm.branch = repo.defaultBranch
  } catch {
    branches.value = []
  } finally {
    loadingBranches.value = false
  }
}

function selectRepo(repo) {
  selectedRepo.value = repo
  createAppForm.repoId = repo.id
  repoDropdownOpen.value = false
  repoSearch.value = ''
  fetchBranches(repo)
}

function clearRepo() {
  selectedRepo.value = null
  createAppForm.repoId = null
  createAppForm.branch = null
  selectedBranch.value = null
  branches.value = []
}

function selectBranch(branchName) {
  selectedBranch.value = branchName
  createAppForm.branch = branchName
}

watch(addAppOpen, (open) => {
  if (open && props.githubConnected) {
    fetchRepos()
  }
})

function createApp() {
  if (!createAppForm.name.trim()) return
  createAppForm.routePath = createAppForm.routePath === 'none' ? null : createAppForm.routePath
  createAppForm.post(`/projects/${props.project.slug}/environments/${props.environment.slug}/apps`, {
    onSuccess: () => {
      createAppForm.reset()
      selectedRepo.value = null
      selectedBranch.value = null
      branches.value = []
      addAppOpen.value = false
      toast({ message: 'App created', type: 'success' })
    },
    onError: () => {
      toast({ message: 'Failed to create app', type: 'error' })
    }
  })
}

async function deployApp(appItem) {
  try {
    const res = await fetch(`/api/v1/projects/${props.project.slug}/environments/${props.environment.slug}/apps/${appItem.slug}/deploy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    })
    const data = await res.json()
    if (data.deployment) {
      router.visit(`/projects/${props.project.slug}/deployments/${data.deployment.id}`)
    }
  } catch { /* ignore */ }
}

async function restartSingleApp(appItem) {
  try {
    await fetch(`/api/v1/projects/${props.project.slug}/environments/${props.environment.slug}/apps/${appItem.slug}/restart`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    })
    router.reload({ only: ['apps', 'app'] })
  } catch { /* ignore */ }
}

async function stopSingleApp(appItem) {
  try {
    await fetch(`/api/v1/projects/${props.project.slug}/environments/${props.environment.slug}/apps/${appItem.slug}/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    })
    router.reload({ only: ['apps', 'app'] })
  } catch { /* ignore */ }
}

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

// --- Env vars management ---
const localVars = reactive({ ...props.envVars })
watch(() => props.envVars, (newVars) => {
  Object.keys(localVars).forEach(k => delete localVars[k])
  Object.assign(localVars, newVars)
})
const revealedKeys = ref(new Set())
const newKey = ref('')
const newValue = ref('')
const saving = ref(false)
const _params = new URLSearchParams(window.location.search)
const envVarsOpen = ref(_params.has('env') || _params.has('bulk'))
const bulkMode = ref(_params.has('bulk'))
const bulkText = ref('')

const bulkHasChanges = computed(() => {
  const vars = {}
  for (const line of (bulkText.value || '').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const k = trimmed.slice(0, eqIdx).trim()
    const v = trimmed.slice(eqIdx + 1).trim()
    if (k) vars[k] = v
  }
  const keys = Object.keys(vars).sort()
  const currentKeys = Object.keys(localVars).sort()
  if (keys.length !== currentKeys.length) return true
  return keys.some((k, i) => k !== currentKeys[i] || vars[k] !== localVars[currentKeys[i]])
})

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
  const oldKeys = Object.keys(localVars).sort().join(',')
  const oldVals = Object.keys(localVars).sort().map(k => localVars[k]).join(',')
  Object.keys(localVars).forEach(k => delete localVars[k])
  Object.assign(localVars, vars)
  const newKeys = Object.keys(localVars).sort().join(',')
  const newVals = Object.keys(localVars).sort().map(k => localVars[k]).join(',')
  if (oldKeys !== newKeys || oldVals !== newVals) {
    saveEnvVars(localVars)
    toast({ message: 'Environment variables updated', type: 'success' })
  }
  bulkMode.value = false
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

// --- Clipboard ---
const copiedDomain = ref(null)

function copyToClipboard(text) {
  navigator.clipboard.writeText(text)
  copiedDomain.value = text
  setTimeout(() => { copiedDomain.value = null }, 2000)
}

function closeAllDropdowns() {
  moreMenuOpen.value = false
  serviceMenuOpen.value = null
  appMenuOpen.value = null
  repoDropdownOpen.value = false
}

// --- Env vars helpers ---
function isSensitive() {
  return true
}

function toggleReveal(key) {
  if (revealedKeys.value.has(key)) {
    revealedKeys.value.delete(key)
  } else {
    revealedKeys.value.add(key)
  }
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

async function saveEnvVars(vars) {
  saving.value = true
  try {
    await fetch(`/api/v1/projects/${props.project.slug}/environments/${props.environment.slug}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ envVars: vars })
    })
    router.reload({ only: ['envVars', 'environment', 'checklist'], preserveScroll: true })
  } finally {
    saving.value = false
  }
}

function addVar() {
  if (!newKey.value.trim()) return
  const key = newKey.value.trim()
  localVars[key] = newValue.value
  saveEnvVars(localVars)
  toast({ message: `Added "${key}"`, type: 'success' })
  newKey.value = ''
  newValue.value = ''
}

function removeVar(key) {
  delete localVars[key]
  saveEnvVars(localVars)
  toast({ message: `Removed "${key}"`, type: 'success' })
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
  saveEnvVars(localVars)
  toast({ message: `Renamed "${oldKey}" to "${trimmed}"`, type: 'success' })
}

function updateVarValue(key, value) {
  if (localVars[key] === value) return
  localVars[key] = value
  saveEnvVars(localVars)
  toast({ message: `Updated "${key}"`, type: 'success' })
}

// --- Services ---
const appsOpen = ref(new URLSearchParams(window.location.search).has('apps'))

watch(appsOpen, (open) => {
  const url = new URL(window.location)
  if (open) {
    url.searchParams.set('apps', '1')
  } else {
    url.searchParams.delete('apps')
  }
  window.history.replaceState({}, '', url)
})

const servicesOpen = ref(new URLSearchParams(window.location.search).has('services'))

watch(servicesOpen, (open) => {
  const url = new URL(window.location)
  if (open) {
    url.searchParams.set('services', '1')
  } else {
    url.searchParams.delete('services')
  }
  window.history.replaceState({}, '', url)
})
const addServiceOpen = ref(false)
const newServiceName = ref('')
const newServiceType = ref('postgresql')
const newServiceVersion = ref('latest')
const creatingService = ref(false)
const deletingServiceId = ref(null)
const serviceMenuOpen = ref(null)
const stoppingServiceId = ref(null)
const startingServiceId = ref(null)
const revealedServiceUrls = ref(new Set())

const serviceTypes = [
  { value: 'postgresql', label: 'PostgreSQL' },
  { value: 'mysql', label: 'MySQL' },
  { value: 'redis', label: 'Redis' },
  { value: 'mongodb', label: 'MongoDB' }
]

function serviceIcon(type) {
  const icons = { postgresql: 'PG', mysql: 'My', redis: 'Rd', mongodb: 'Mg' }
  return icons[type] || '?'
}

function toggleServiceUrlReveal(id) {
  if (revealedServiceUrls.value.has(id)) {
    revealedServiceUrls.value.delete(id)
  } else {
    revealedServiceUrls.value.add(id)
  }
}

async function createService() {
  if (!newServiceName.value.trim() || creatingService.value) return
  creatingService.value = true

  const serviceName = newServiceName.value.trim().toLowerCase().replace(/\s+/g, '-')
  const serviceType = newServiceType.value

  const actionId = startAction({
    serviceName,
    serviceType,
    action: 'creating',
    projectName: props.project.name,
    environmentName: props.environment.name
  })

  try {
    const res = await fetch(`/api/v1/projects/${props.project.slug}/environments/${props.environment.slug}/services`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: serviceName,
        type: serviceType,
        version: newServiceVersion.value || 'latest'
      })
    })
    completeAction(actionId, res.ok)
    newServiceName.value = ''
    newServiceVersion.value = 'latest'
    addServiceOpen.value = false
    router.reload({ only: ['environment', 'envVars', 'checklist'] })
  } catch (err) {
    completeAction(actionId, false)
  } finally {
    creatingService.value = false
  }
}

function toggleServiceMenu(serviceId) {
  serviceMenuOpen.value = serviceMenuOpen.value === serviceId ? null : serviceId
}

function closeServiceMenu() {
  serviceMenuOpen.value = null
}

function confirmDeleteService(service) {
  serviceMenuOpen.value = null
  deletingServiceId.value = service.id
}

async function stopService(service) {
  serviceMenuOpen.value = null
  stoppingServiceId.value = service.id

  const actionId = startAction({
    serviceName: service.name,
    serviceType: service.type,
    action: 'stopping',
    projectName: props.project.name,
    environmentName: props.environment.name
  })

  try {
    const res = await fetch(`/api/v1/services/${service.id}/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    })
    completeAction(actionId, res.ok)
    router.reload({ only: ['environment'] })
  } finally {
    stoppingServiceId.value = null
  }
}

async function startService(service) {
  serviceMenuOpen.value = null
  startingServiceId.value = service.id

  const actionId = startAction({
    serviceName: service.name,
    serviceType: service.type,
    action: 'starting',
    projectName: props.project.name,
    environmentName: props.environment.name
  })

  try {
    const res = await fetch(`/api/v1/services/${service.id}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    })
    completeAction(actionId, res.ok)
    router.reload({ only: ['environment'] })
  } finally {
    startingServiceId.value = null
  }
}

async function executeDeleteService() {
  const res = await fetch(`/api/v1/services/${deletingServiceId.value}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' }
  })
  deletingServiceId.value = null
  if (res.ok) {
    toast({ message: 'Service deleted', type: 'success' })
  } else {
    toast({ message: 'Failed to delete service', type: 'error' })
  }
  router.reload({ only: ['environment', 'envVars', 'checklist'] })
}

function cancelDeleteService() {
  deletingServiceId.value = null
}

// --- Backups ---
const backingUpServiceId = ref(null)
const backupStreamUrl = ref(null)

const { close: closeBackupStream, connect: connectBackupStream } = useEventSource(backupStreamUrl, {
  immediate: false,
  autoReconnect: false,
  onMessage(msg) {
    if (msg.status === 'completed' || msg.status === 'failed') {
      closeBackupStream()
      router.reload({ only: ['environment'] })
    }
  }
})

async function triggerBackup(service) {
  if (backingUpServiceId.value) return
  backingUpServiceId.value = service.id
  try {
    const res = await fetch(`/api/v1/services/${service.id}/backups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    })
    if (!res.ok) return
    const data = await res.json()
    router.reload({ only: ['environment'] })
    backupStreamUrl.value = `/api/v1/backups/${data.backup.id}/stream`
    connectBackupStream()
  } finally {
    backingUpServiceId.value = null
  }
}

function formatBytes(bytes) {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
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
  // When running, use health status to determine color
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

const sortedVarKeys = computed(() => Object.keys(localVars).sort())
const services = computed(() => props.environment.services || [])

const checklistWarnings = computed(() => {
  return (props.checklist || []).filter(c => c.severity === 'warning' || c.severity === 'info')
})

const checklistAllGood = computed(() => {
  return (props.checklist || []).length === 1 && props.checklist[0].severity === 'success'
})

// --- Checklist actions ---
function handleChecklistAction(action) {
  if (!action) return
  switch (action.type) {
    case 'generate-session-secret': {
      const bytes = new Uint8Array(32)
      crypto.getRandomValues(bytes)
      const secret = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
      localVars['SESSION_SECRET'] = secret
      saveEnvVars(localVars)
      toast({ message: 'SESSION_SECRET generated and saved', type: 'success' })
      break
    }
    case 'add-service':
      servicesOpen.value = true
      addServiceOpen.value = true
      if (action.serviceType) {
        newServiceType.value = action.serviceType
      }
      break
    case 'open-env-vars':
      envVarsOpen.value = true
      break
  }
}

const moreMenuOpen = ref(false)

// Handle escape key to close dropdowns
function handleEscapeKey(e) {
  if (e.key === 'Escape') {
    closeAllDropdowns()
  }
}

onMounted(() => {
  if (bulkMode.value) {
    bulkText.value = sortedVarKeys.value.map(k => `${k}=${localVars[k]}`).join('\n')
  }
  document.addEventListener('keydown', handleEscapeKey)
})

onBeforeUnmount(() => {
  disconnectActiveDeployments()
  document.removeEventListener('keydown', handleEscapeKey)
})
</script>
<template>
  <Head :title="`${environment.name} - ${project.name} | Slipway`"></Head>
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
          { label: environment.name.toLowerCase() }
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
        <!-- Environment Info -->
        <div class="mb-8 flex items-start justify-between">
          <div>
            <div class="flex items-center space-x-3">
              <h1 class="text-xl font-semibold text-gray-900 dark:text-white">{{ environment.name }}</h1>
              <span
                v-if="environment.isProduction"
                class="inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
              >
                Production
              </span>
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
                  <div class="border-b border-gray-100 pb-1 dark:border-gray-800">
                    <button
                      @click="appsOpen = true; addAppOpen = true; moreMenuOpen = false"
                      class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      <svg class="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                      </svg>
                      Create app
                    </button>
                    <button
                      @click="servicesOpen = true; addServiceOpen = true; moreMenuOpen = false"
                      class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      <svg class="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                      </svg>
                      Create service
                    </button>
                  </div>
                  <div class="pt-1">
                    <Link
                      :href="`/projects/${project.slug}/environments/${environment.slug}/settings`"
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
          </div>
        </div>

        <!-- Deployment Checklist -->
        <div v-if="checklist && checklist.length > 0 && !checklistAllGood" class="mb-10">
          <div class="rounded-lg border border-amber-200 bg-amber-50/50 dark:border-amber-900/50 dark:bg-amber-950/20">
            <div class="flex items-center gap-2 px-4 py-3">
              <svg class="h-4 w-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              <h2 class="text-sm font-medium text-amber-800 dark:text-amber-300">Deployment checklist</h2>
              <span class="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                {{ checklistWarnings.length }}
              </span>
            </div>
            <div class="divide-y divide-amber-200/50 border-t border-amber-200/50 dark:divide-amber-900/30 dark:border-amber-900/30">
              <div
                v-for="item in checklist"
                :key="item.key"
                class="flex items-start justify-between gap-3 px-4 py-2.5"
              >
                <div class="flex items-start gap-3">
                  <svg v-if="item.severity === 'warning'" class="mt-0.5 h-4 w-4 shrink-0 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                  <svg v-else-if="item.severity === 'info'" class="mt-0.5 h-4 w-4 shrink-0 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <svg v-else class="mt-0.5 h-4 w-4 shrink-0 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                  </svg>
                  <div>
                    <p class="text-sm text-gray-800 dark:text-gray-200">{{ item.label }}</p>
                    <p v-if="item.suggestion" class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{{ item.suggestion }}</p>
                  </div>
                </div>
                <button
                  v-if="item.action"
                  @click="handleChecklistAction(item.action)"
                  class="shrink-0 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-400 dark:hover:bg-amber-900/50"
                >
                  {{ item.action.label }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Accordion: Apps, Services, Env Vars -->
        <div class="mb-10 divide-y divide-gray-200 rounded-lg border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
          <!-- Apps -->
          <div>
            <div class="flex items-center justify-between px-4 py-3">
              <button
                @click="appsOpen = !appsOpen"
                class="flex flex-1 items-center space-x-3 text-left hover:opacity-80"
              >
                <h2 class="text-sm font-medium text-gray-900 dark:text-white">Apps</h2>
                <span class="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                  {{ sortedApps.length }}
                </span>
              </button>
              <button
                @click="appsOpen = !appsOpen"
                class="rounded p-0.5 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <svg
                  :class="['h-4 w-4 text-gray-400 transition-transform duration-200', appsOpen ? 'rotate-90' : '']"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
            <div v-show="appsOpen">
              <!-- App list -->
              <div class="divide-y divide-gray-200 border-t border-gray-200 dark:divide-gray-800 dark:border-gray-800">
                <div v-for="appItem in sortedApps" :key="appItem.id" class="flex items-center justify-between px-4 py-3">
                  <div class="flex items-center space-x-3">
                    <div class="flex items-center space-x-2">
                      <Link
                        :href="`/projects/${project.slug}/environments/${environment.slug}/apps/${appItem.slug}`"
                        class="text-sm font-medium text-gray-900 underline decoration-dashed decoration-gray-300 underline-offset-2 hover:text-gray-700 dark:text-white dark:decoration-gray-600 dark:hover:text-gray-300"
                      >
                        {{ appItem.name }}
                      </Link>
                      <span
                        v-if="appItem.isDefault"
                        class="inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                      >
                        default
                      </span>
                      <span
                        v-if="appItem.routePath === null"
                        class="inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400"
                      >
                        worker
                      </span>
                      <span
                        v-else-if="appItem.routePath && appItem.routePath !== '/'"
                        class="inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
                      >
                        {{ appItem.routePath }}
                      </span>
                    </div>
                    <!-- Status -->
                    <div :class="[appStatusClasses(appItem).bg, 'inline-flex items-center space-x-1.5 rounded-full px-2.5 py-0.5']">
                      <div :class="[appStatusClasses(appItem).dot, 'h-1.5 w-1.5 rounded-full']"></div>
                      <span :class="[appStatusClasses(appItem).text, 'text-[11px] font-medium']">{{ appStatusLabel(appItem) }}</span>
                    </div>
                  </div>
                  <div class="relative">
                    <button
                      @click.stop="appMenuOpen = appMenuOpen === appItem.id ? null : appItem.id"
                      class="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                    >
                      <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                        <circle cx="12" cy="6" r="1.5" />
                        <circle cx="12" cy="12" r="1.5" />
                        <circle cx="12" cy="18" r="1.5" />
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
                        v-if="appMenuOpen === appItem.id"
                        @click.stop
                        class="absolute right-0 top-full z-20 mt-1 w-56 rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
                      >
                        <!-- Slide to Deploy -->
                        <div class="border-b border-gray-100 px-3 py-2.5 dark:border-gray-800">
                          <SlideToDeploy
                            :ref="el => { if (el) appSlideRefs[appItem.id] = el }"
                            :is-production="environment.isProduction"
                            :environment-name="environment.name"
                            :disabled="deploying"
                            @deploy="deployApp(appItem)"
                          />
                        </div>
                        <!-- Actions -->
                        <div v-if="appItem.status === 'running'" class="border-b border-gray-100 py-1 dark:border-gray-800">
                          <button
                            @click="restartSingleApp(appItem); appMenuOpen = null"
                            class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                          >
                            <svg class="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            Restart
                          </button>
                          <button
                            @click="stopSingleApp(appItem); appMenuOpen = null"
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
                          <Link
                            :href="`/projects/${project.slug}/environments/${environment.slug}/apps/${appItem.slug}/settings`"
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
                </div>
              </div>
              <!-- Add app -->
              <div class="px-4 pb-3">
                <div v-if="addAppOpen" class="space-y-3">
                  <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input
                      v-model="createAppForm.name"
                      placeholder="app name"
                      class="w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none sm:flex-1 dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
                      @keydown.enter="createApp"
                    />
                    <input
                      v-model="createAppForm.dockerfilePath"
                      placeholder="Dockerfile"
                      class="w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none sm:w-32 dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
                      @keydown.enter="createApp"
                    />
                    <select
                      v-model="createAppForm.routePath"
                      class="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-brand focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                    >
                      <option value="/">/ (root)</option>
                      <option value="/api">/api</option>
                      <option value="/admin">/admin</option>
                      <option value="none">None (worker)</option>
                    </select>
                  </div>

                  <!-- GitHub repo picker -->
                  <div v-if="githubConnected" class="relative">
                    <!-- Selected repo chip + branch picker -->
                    <div v-if="selectedRepo" class="space-y-2">
                      <div class="flex items-center gap-2">
                        <div class="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800">
                          <svg class="h-4 w-4 text-gray-500 dark:text-gray-400" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                          </svg>
                          <span class="text-gray-700 dark:text-gray-300">{{ selectedRepo.fullName }}</span>
                          <button @click="clearRepo" class="ml-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                            <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </div>
                      <!-- Branch select -->
                      <div class="flex items-center gap-2">
                        <svg class="h-4 w-4 shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        <span class="text-xs text-gray-500 dark:text-gray-400">Deploy branch</span>
                        <select
                          v-if="branches.length > 0"
                          :value="selectedBranch"
                          @change="selectBranch($event.target.value)"
                          class="rounded-md border border-gray-200 bg-white px-2 py-1 text-sm text-gray-900 focus:border-brand focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                        >
                          <option v-for="b in branches" :key="b.name" :value="b.name">{{ b.name }}</option>
                        </select>
                        <svg v-else-if="loadingBranches" class="h-4 w-4 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24">
                          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                        </svg>
                        <span v-else class="rounded bg-gray-200 px-1.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-400">{{ selectedRepo.defaultBranch }}</span>
                      </div>
                    </div>

                    <!-- Repo search combobox -->
                    <div v-else>
                      <div class="relative">
                        <div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2">
                          <svg class="h-4 w-4 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                          </svg>
                        </div>
                        <input
                          v-model="repoSearch"
                          @focus="repoDropdownOpen = true"
                          @click.stop
                          placeholder="Link a GitHub repository (optional)"
                          class="w-full border-b border-dashed border-gray-200 bg-transparent py-1.5 pl-8 pr-8 text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
                        />
                        <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
                          <svg v-if="loadingRepos" class="h-4 w-4 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24">
                            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                          </svg>
                          <svg v-else class="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </div>

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
                          v-if="repoDropdownOpen && !loadingRepos"
                          @click.stop
                          class="absolute left-0 right-0 z-30 mt-1 max-h-48 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900"
                        >
                          <div v-if="filteredRepos.length === 0" class="px-3 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
                            No repositories found
                          </div>
                          <button
                            v-for="repo in filteredRepos"
                            :key="repo.id"
                            @click="selectRepo(repo)"
                            :disabled="repo.isConnected"
                            class="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-50 disabled:opacity-50 dark:hover:bg-gray-800"
                          >
                            <div class="flex items-center gap-2">
                              <span class="text-gray-400 dark:text-gray-500">{{ repo.owner }}/</span>
                              <span class="font-medium text-gray-900 dark:text-white">{{ repo.name }}</span>
                              <svg v-if="repo.isPrivate" class="h-3.5 w-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                              </svg>
                            </div>
                            <span v-if="repo.isConnected" class="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">Connected</span>
                          </button>
                        </div>
                      </Transition>
                    </div>
                  </div>

                  <div class="flex items-center justify-end space-x-2">
                    <button
                      @click="addAppOpen = false; createAppForm.reset(); clearRepo()"
                      class="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                    >
                      Cancel
                    </button>
                    <button
                      @click="createApp"
                      :disabled="!createAppForm.name.trim() || createAppForm.processing"
                      class="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
                    >
                      {{ createAppForm.processing ? 'Creating...' : 'Create' }}
                    </button>
                  </div>
                </div>
                <button
                  v-else
                  @click="addAppOpen = true"
                  class="text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                >
                  + Add app
                </button>
              </div>
            </div>
          </div>

          <!-- Services -->
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
            <div v-show="servicesOpen" @click="closeServiceMenu">
              <div v-if="services.length > 0" class="space-y-1 px-4 pb-3">
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
                        <span class="ml-2 text-xs text-gray-400 dark:text-gray-500">{{ service.type }}{{ service.version !== 'latest' ? ` ${service.version}` : '' }}</span>
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
                      <!-- Service actions menu -->
                      <div class="relative">
                        <button
                          @click.stop="toggleServiceMenu(service.id)"
                          class="rounded p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                        >
                          <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                          </svg>
                        </button>
                        <div
                          v-if="serviceMenuOpen === service.id"
                          @click.stop
                          class="absolute right-0 z-20 mt-1 w-36 rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
                        >
                          <button
                            v-if="service.status === 'running'"
                            @click.stop="stopService(service)"
                            :disabled="stoppingServiceId === service.id"
                            class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-800"
                          >
                            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                            </svg>
                            {{ stoppingServiceId === service.id ? 'Stopping...' : 'Stop' }}
                          </button>
                          <button
                            v-if="service.status === 'stopped'"
                            @click.stop="startService(service)"
                            :disabled="startingServiceId === service.id"
                            class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-800"
                          >
                            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            {{ startingServiceId === service.id ? 'Starting...' : 'Start' }}
                          </button>
                          <Link
                            :href="`/projects/${project.slug}/environments/${environment.slug}/services/${service.id}/settings`"
                            class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"
                          >
                            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            Settings
                          </Link>
                          <button
                            @click.stop="confirmDeleteService(service)"
                            class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                          >
                            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                            Delete
                          </button>
                        </div>
                      </div>
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
                      <svg v-if="copiedDomain === service.connectionUrl" class="h-3.5 w-3.5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                      </svg>
                      <svg v-else class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    </button>
                  </div>
                  <div v-if="service.backupSupported" class="mt-2 flex items-center justify-between">
                    <div class="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
                      <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                      </svg>
                      <template v-if="service.lastBackup">
                        <span v-if="service.lastBackup.status === 'completed'">
                          Last backup {{ timeAgo(service.lastBackup.completedAt) }} ({{ formatBytes(service.lastBackup.sizeBytes) }})
                        </span>
                        <span v-else-if="service.lastBackup.status === 'running'" class="text-blue-500">
                          Backup in progress...
                        </span>
                        <span v-else-if="service.lastBackup.status === 'failed'" class="text-red-500">
                          Last backup failed
                        </span>
                        <span v-else>
                          Backup pending...
                        </span>
                      </template>
                      <template v-else>
                        No backups yet
                      </template>
                    </div>
                    <button
                      v-if="backupConfigured && service.status === 'running'"
                      @click="triggerBackup(service)"
                      :disabled="backingUpServiceId === service.id"
                      class="rounded px-2 py-0.5 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                    >
                      {{ backingUpServiceId === service.id ? 'Starting...' : 'Backup now' }}
                    </button>
                    <Link
                      v-else-if="!backupConfigured"
                      href="/settings/uploads"
                      class="rounded px-2 py-0.5 text-xs font-medium text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    >
                      Configure storage
                    </Link>
                  </div>
                </div>
              </div>
              <div v-else class="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                No services attached.
              </div>
              <div class="px-4 pb-3">
                <div v-if="addServiceOpen" class="space-y-3">
                  <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input
                      v-model="newServiceName"
                      type="text"
                      placeholder="service name (e.g. main-db)"
                      class="w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 font-mono text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none sm:flex-1 dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
                      @keydown.enter="createService"
                    />
                    <select
                      v-model="newServiceType"
                      class="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-brand focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                    >
                      <option v-for="st in serviceTypes" :key="st.value" :value="st.value">{{ st.label }}</option>
                    </select>
                    <input
                      v-model="newServiceVersion"
                      type="text"
                      placeholder="version"
                      class="w-20 border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
                    />
                  </div>
                  <div class="flex items-center justify-end space-x-2">
                    <button
                      @click="addServiceOpen = false"
                      class="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                    >
                      Cancel
                    </button>
                    <button
                      @click="createService"
                      :disabled="!newServiceName.trim() || creatingService"
                      class="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
                    >
                      {{ creatingService ? 'Creating...' : 'Create' }}
                    </button>
                  </div>
                </div>
                <button
                  v-else
                  @click="addServiceOpen = true"
                  class="text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                >
                  + Add service
                </button>
              </div>
            </div>
          </div>

          <!-- Environment Variables -->
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
                      class="pointer-events-none absolute inset-0 overflow-auto whitespace-pre-wrap break-all bg-gray-50 px-4 py-4 font-mono text-sm leading-relaxed dark:bg-gray-950"
                      aria-hidden="true"
                      v-html="bulkHighlighted"
                    ></pre>
                    <textarea
                      v-model="bulkText"
                      rows="3"
                      placeholder="KEY=value&#10;DATABASE_URL=postgres://localhost:5432/db&#10;# Comments are ignored"
                      class="relative block w-full resize-none bg-transparent px-4 py-4 font-mono text-sm leading-relaxed text-transparent caret-gray-900 placeholder-gray-400 focus:outline-none dark:caret-white dark:placeholder-gray-500"
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
                      :disabled="saving || !bulkHasChanges"
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
                        class="min-w-0 flex-1 border-b border-dashed border-transparent bg-transparent font-mono text-sm font-medium text-gray-900 focus:border-gray-300 focus:outline-none dark:text-white dark:focus:border-gray-600"
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
                  No environment variables set.
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
                      :disabled="!newKey.trim() || saving"
                      class="w-full rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 sm:w-auto dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </template>
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
                  <span
                    v-if="dep.app && dep.app.name"
                    class="inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                  >
                    {{ dep.app.name }}
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

    <!-- Delete Service Confirmation -->
    <ConfirmModal
      :show="!!deletingServiceId"
      title="Delete service"
      message="This will stop the service container and permanently delete all data. This action cannot be undone."
      confirm-label="Delete service"
      :destructive="true"
      @confirm="executeDeleteService"
      @cancel="cancelDeleteService"
    />

  </div>
</template>
