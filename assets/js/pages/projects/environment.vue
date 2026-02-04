<script setup>
import { Link, Head, router, usePoll } from '@inertiajs/vue3'
import { inject, ref, reactive, computed, watch } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'
import SlideToDeploy from '@/components/SlideToDeploy.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  project: Object,
  environment: Object,
  app: Object,
  envVars: Object,
  deployments: Array
})

const toggleMobileMenu = inject('toggleMobileMenu')

// --- Polling for real-time updates ---
const isDeploymentActive = computed(() => {
  if (!props.app) return false
  return ['building', 'deploying', 'starting'].includes(props.app.status)
})

const hasActiveDeployment = computed(() => {
  return props.deployments.some(d =>
    ['pending', 'building', 'deploying'].includes(d.status)
  )
})

const shouldPoll = computed(() => isDeploymentActive.value || hasActiveDeployment.value)

const { stop: stopPoll } = usePoll(2000, {
  keepAlive: true,
  autoStart: shouldPoll.value
})

watch(shouldPoll, (active) => {
  if (!active) stopPoll()
})

// --- Env vars management ---
const localVars = reactive({ ...props.envVars })
const revealedKeys = ref(new Set())
const newKey = ref('')
const newValue = ref('')
const saving = ref(false)
const deploying = ref(false)
const slideRef = ref(null)
const envVarsOpen = ref(new URLSearchParams(window.location.search).has('env'))
const bulkMode = ref(false)
const bulkText = ref('')

function enterBulkMode() {
  bulkText.value = sortedVarKeys.map(k => `${k}=${props.envVars[k]}`).join('\n')
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
  saveEnvVars(localVars)
  bulkMode.value = false
}

watch(envVarsOpen, (open) => {
  const url = new URL(window.location)
  if (open) {
    url.searchParams.set('env', '1')
  } else {
    url.searchParams.delete('env')
  }
  window.history.replaceState({}, '', url)
})

// --- Domain display ---
const domainDropdownOpen = ref(false)
const copiedDomain = ref(null)

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
  copiedDomain.value = text
  setTimeout(() => { copiedDomain.value = null }, 2000)
}

function closeDomainDropdown() {
  domainDropdownOpen.value = false
}

// --- Env vars helpers ---
const sensitivePatterns = ['PASSWORD', 'SECRET', 'KEY', 'TOKEN', 'PRIVATE', 'CREDENTIAL', 'AUTH', 'API_KEY', 'APIKEY']

function isSensitive(key) {
  const upper = key.toUpperCase()
  return sensitivePatterns.some(p => upper.includes(p))
}

function toggleReveal(key) {
  if (revealedKeys.value.has(key)) {
    revealedKeys.value.delete(key)
  } else {
    revealedKeys.value.add(key)
  }
}

async function saveEnvVars(vars) {
  saving.value = true
  try {
    await fetch(`/api/v1/projects/${props.project.slug}/environments/${props.environment.slug}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ envVars: vars })
    })
    router.reload({ only: ['envVars', 'environment'] })
  } finally {
    saving.value = false
  }
}

function addVar() {
  if (!newKey.value.trim()) return
  localVars[newKey.value.trim()] = newValue.value
  saveEnvVars(localVars)
  newKey.value = ''
  newValue.value = ''
}

function removeVar(key) {
  delete localVars[key]
  saveEnvVars(localVars)
}

// --- Container lifecycle ---
const restarting = ref(false)
const stopping = ref(false)

async function restartApp() {
  restarting.value = true
  try {
    await fetch(`/api/v1/projects/${props.project.slug}/environments/${props.environment.slug}/restart`, {
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
    await fetch(`/api/v1/projects/${props.project.slug}/environments/${props.environment.slug}/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    })
    router.reload({ only: ['app'] })
  } finally {
    stopping.value = false
  }
}

// --- Services ---
const servicesOpen = ref(false)
const addServiceOpen = ref(false)
const newServiceName = ref('')
const newServiceType = ref('postgresql')
const newServiceVersion = ref('latest')
const creatingService = ref(false)
const deletingServiceId = ref(null)
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
  try {
    await fetch(`/api/v1/projects/${props.project.slug}/environments/${props.environment.slug}/services`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newServiceName.value.trim().toLowerCase().replace(/\s+/g, '-'),
        type: newServiceType.value,
        version: newServiceVersion.value || 'latest'
      })
    })
    newServiceName.value = ''
    newServiceVersion.value = 'latest'
    addServiceOpen.value = false
    router.reload({ only: ['environment'] })
  } finally {
    creatingService.value = false
  }
}

function confirmDeleteService(service) {
  deletingServiceId.value = service.id
}

async function executeDeleteService() {
  await fetch(`/api/v1/services/${deletingServiceId.value}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' }
  })
  deletingServiceId.value = null
  router.reload({ only: ['environment'] })
}

function cancelDeleteService() {
  deletingServiceId.value = null
}

// --- Status badges ---
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

async function triggerDeploy() {
  if (deploying.value) return
  deploying.value = true
  try {
    const res = await fetch(`/api/v1/projects/${props.project.slug}/environments/${props.environment.slug}/deploy`, {
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

const sortedVarKeys = Object.keys(props.envVars).sort()
const services = computed(() => props.environment.services || [])
</script>
<template>
  <Head :title="`${environment.name} - ${project.name} | Slipway`"></Head>
  <div class="flex h-full flex-col" @click="closeDomainDropdown">
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-gray-200 px-4 py-4 dark:border-gray-800 sm:px-8">
      <div class="flex items-center space-x-3">
        <button
          @click="toggleMobileMenu"
          class="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white md:hidden"
        >
          <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
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
          <span class="font-medium text-gray-900 dark:text-white">{{ environment.name.toLowerCase() }}</span>
        </nav>
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
            <!-- Domain display -->
            <div class="relative mt-1 inline-flex items-center">
              <div class="group flex items-center gap-2">
                <a
                  :href="`http://${environment.fullDomain}`"
                  target="_blank"
                  class="text-sm text-gray-500 underline decoration-dashed decoration-gray-300 underline-offset-2 hover:text-gray-900 dark:text-gray-400 dark:decoration-gray-600 dark:hover:text-white"
                >
                  {{ environment.fullDomain }}
                </a>
                <button
                  @click.prevent="copyToClipboard(environment.fullDomain)"
                  class="rounded p-0.5 text-gray-300 opacity-0 transition-opacity hover:text-gray-500 group-hover:opacity-100 dark:text-gray-600 dark:hover:text-gray-400"
                >
                  <svg v-if="copiedDomain === environment.fullDomain" class="h-3.5 w-3.5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                    :href="`http://${d.value}`"
                    target="_blank"
                    class="text-sm text-gray-700 underline decoration-dashed decoration-gray-300 underline-offset-2 hover:text-gray-900 dark:text-gray-300 dark:decoration-gray-600 dark:hover:text-white"
                  >
                    {{ d.value }}
                  </a>
                  <button
                    @click="copyToClipboard(d.value)"
                    class="rounded p-0.5 text-gray-300 opacity-0 transition-opacity hover:text-gray-500 group-hover/item:opacity-100 dark:text-gray-600 dark:hover:text-gray-400"
                  >
                    <svg v-if="copiedDomain === d.value" class="h-3.5 w-3.5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                    </svg>
                    <svg v-else class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            <div v-if="app && app.hostPort && app.status === 'running'" class="mt-2 flex items-center space-x-2">
              <span class="inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-900/20 dark:text-emerald-400 dark:ring-emerald-500/30">
                Local
              </span>
              <a
                :href="`http://localhost:${app.hostPort}`"
                target="_blank"
                class="inline-flex items-center space-x-1 font-mono text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
              >
                <span>http://localhost:{{ app.hostPort }}</span>
                <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            </div>
          </div>
          <div class="flex items-center space-x-2">
            <!-- Helm REPL -->
            <Link
              :href="`/projects/${project.slug}/environments/${environment.slug}/helm`"
              class="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
              title="Helm REPL"
            >
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </Link>
            <!-- Container lifecycle controls -->
            <template v-if="app && app.status === 'running'">
              <button
                @click="restartApp"
                :disabled="restarting"
                class="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                title="Restart"
              >
                <svg v-if="restarting" class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <svg v-else class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
              <button
                @click="stopApp"
                :disabled="stopping"
                class="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                title="Stop"
              >
                <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="6" width="12" height="12" rx="1" />
                </svg>
              </button>
            </template>
            <span v-if="app" :class="['inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium', statusBadge(app.status).classes]">
              {{ statusBadge(app.status).label }}
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
              :disabled="deploying"
              @deploy="triggerDeploy"
            />
          </div>
        </div>

        <!-- Environment Variables -->
        <div class="mb-10">
          <div class="rounded-lg border border-gray-200 dark:border-gray-800">
            <!-- Collapsible header -->
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
                <button
                  v-if="envVarsOpen"
                  @click="bulkMode ? exitBulkMode() : enterBulkMode()"
                  class="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                  :title="bulkMode ? 'Switch to single edit' : 'Switch to bulk edit'"
                >
                  <svg v-if="bulkMode" class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                  <svg v-else class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                  </svg>
                </button>
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

            <!-- Expanded content -->
            <div v-show="envVarsOpen">
              <!-- Bulk edit mode -->
              <template v-if="bulkMode">
                <div class="border-t border-gray-200 dark:border-gray-800">
                  <textarea
                    v-model="bulkText"
                    rows="3"
                    placeholder="KEY=value&#10;DATABASE_URL=postgres://localhost:5432/db&#10;# Comments are ignored"
                    class="block w-full resize-none bg-gray-50 px-4 py-3 font-mono text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:bg-gray-900 dark:text-white dark:placeholder-gray-500"
                    style="field-sizing: content"
                    spellcheck="false"
                  />
                  <div class="flex items-center justify-between border-t border-gray-200 px-4 py-3 dark:border-gray-800">
                    <p class="text-xs text-gray-400 dark:text-gray-500">
                      One KEY=value per line. Lines starting with # are ignored.
                    </p>
                    <button
                      @click="saveBulk"
                      :disabled="saving"
                      class="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
                    >
                      Save
                    </button>
                  </div>
                </div>
              </template>

              <!-- Single mode -->
              <template v-else>
                <div v-if="sortedVarKeys.length > 0" class="divide-y divide-gray-200 border-t border-gray-200 dark:divide-gray-800 dark:border-gray-800">
                  <div
                    v-for="key in sortedVarKeys"
                    :key="key"
                    class="px-4 py-3"
                  >
                    <div class="flex items-center justify-between">
                      <span class="font-mono text-sm font-medium text-gray-900 dark:text-white">{{ key }}</span>
                      <div class="flex items-center space-x-1">
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
                    <p class="mt-1 truncate font-mono text-sm text-gray-500 dark:text-gray-400">
                      {{ isSensitive(key) && !revealedKeys.has(key) ? '••••••••' : envVars[key] }}
                    </p>
                  </div>
                </div>

                <div v-else class="border-t border-gray-200 px-4 py-6 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
                  No environment variables set.
                </div>

                <!-- Add new var -->
                <div class="border-t border-gray-200 px-4 py-3 dark:border-gray-800">
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

        <!-- Services -->
        <div class="mb-10">
          <div class="rounded-lg border border-gray-200 dark:border-gray-800">
            <!-- Collapsible header -->
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

            <!-- Expanded content -->
            <div v-show="servicesOpen">
              <!-- Existing services -->
              <div v-if="services.length > 0" class="divide-y divide-gray-200 border-t border-gray-200 dark:divide-gray-800 dark:border-gray-800">
                <div
                  v-for="service in services"
                  :key="service.id"
                  class="px-4 py-3"
                >
                  <div class="flex items-center justify-between">
                    <div class="flex items-center space-x-3">
                      <span class="inline-flex h-7 w-7 items-center justify-center rounded bg-gray-100 text-[10px] font-bold text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                        {{ serviceIcon(service.type) }}
                      </span>
                      <div>
                        <span class="text-sm font-medium text-gray-900 dark:text-white">{{ service.name }}</span>
                        <span class="ml-2 text-xs text-gray-400 dark:text-gray-500">{{ service.type }}{{ service.version !== 'latest' ? ` ${service.version}` : '' }}</span>
                      </div>
                    </div>
                    <div class="flex items-center space-x-2">
                      <span :class="['inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium', statusBadge(service.status).classes]">
                        {{ statusBadge(service.status).label }}
                      </span>
                      <button
                        @click="confirmDeleteService(service)"
                        class="rounded p-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400"
                      >
                        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  <!-- Connection URL -->
                  <div v-if="service.connectionUrl" class="mt-2 flex items-center gap-2">
                    <p class="truncate font-mono text-xs text-gray-500 dark:text-gray-400">
                      {{ revealedServiceUrls.has(service.id) ? service.connectionUrl : service.connectionUrl.replace(/\/\/.*@/, '//***:***@') }}
                    </p>
                    <button
                      @click="toggleServiceUrlReveal(service.id)"
                      class="shrink-0 rounded p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
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
                      class="shrink-0 rounded p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    >
                      <svg v-if="copiedDomain === service.connectionUrl" class="h-3.5 w-3.5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

              <!-- Add service form -->
              <div class="border-t border-gray-200 px-4 py-3 dark:border-gray-800">
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
                      dep.status === 'cancelled' ? 'bg-gray-400' :
                      'bg-yellow-500'
                    ]"
                  ></span>
                  <span :class="['inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium', statusBadge(dep.status).classes]">
                    {{ statusBadge(dep.status).label }}
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
                    {{ dep.triggeredBy?.fullName || 'System' }}
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
      v-if="deletingServiceId"
      title="Delete service"
      message="This will stop the service container and permanently delete all data. This action cannot be undone."
      confirm-label="Delete service"
      :destructive="true"
      @confirm="executeDeleteService"
      @cancel="cancelDeleteService"
    />
  </div>
</template>
