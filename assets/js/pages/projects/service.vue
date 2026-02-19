<script setup>
import { Link, Head, usePage } from '@inertiajs/vue3'
import { inject, ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useEventSource } from '@/composables/sse'
import AppLayout from '@/layouts/AppLayout.vue'
import Breadcrumb from '@/components/Breadcrumb.vue'
import { useToast } from '@/composables/toast'
import { useServiceActions } from '@/composables/service-actions'
import SlippyLoader from '@/components/SlippyLoader.vue'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  project: Object,
  environment: Object,
  service: Object
})

const page = usePage()
const toast = useToast()
const { startAction, completeAction } = useServiceActions()
const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')

// State
const logContainer = ref(null)
const logLines = ref([])
const autoScroll = ref(true)
const logsOpen = ref(true)
const menuOpen = ref(false)
const stopping = ref(false)
const restarting = ref(false)
const serviceStatus = ref(props.service.status)
const copiedUrl = ref(false)
const revealedUrl = ref(false)
const serviceName = ref(props.service.name)
const editingName = ref(false)
const editedName = ref('')
const savingName = ref(false)
const nameInput = ref(null)

// Computed
const serviceTypeLabel = computed(() => {
  const labels = {
    postgresql: 'PostgreSQL',
    mysql: 'MySQL',
    redis: 'Redis',
    mongodb: 'MongoDB'
  }
  return labels[props.service.type] || props.service.type
})

const serviceTypeBadge = computed(() => {
  const badges = {
    postgresql: { label: 'PostgreSQL', classes: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
    mysql: { label: 'MySQL', classes: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
    redis: { label: 'Redis', classes: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
    mongodb: { label: 'MongoDB', classes: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' }
  }
  return badges[props.service.type] || { label: props.service.type, classes: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400' }
})

const statusClasses = computed(() => {
  const map = {
    running: {
      bg: 'bg-emerald-100 dark:bg-emerald-900/30',
      dot: 'bg-emerald-500',
      text: 'text-emerald-700 dark:text-emerald-400'
    },
    stopped: {
      bg: 'bg-gray-100 dark:bg-gray-800',
      dot: 'bg-gray-400',
      text: 'text-gray-600 dark:text-gray-400'
    },
    creating: {
      bg: 'bg-blue-100 dark:bg-blue-900/30',
      dot: 'bg-blue-500',
      text: 'text-blue-700 dark:text-blue-400'
    },
    failed: {
      bg: 'bg-red-100 dark:bg-red-900/30',
      dot: 'bg-red-500',
      text: 'text-red-700 dark:text-red-400'
    }
  }
  return map[serviceStatus.value] || map.stopped
})

const statusLabel = computed(() => {
  const labels = {
    running: 'Running',
    stopped: 'Stopped',
    creating: 'Creating',
    failed: 'Failed'
  }
  return labels[serviceStatus.value] || serviceStatus.value
})

const maskedUrl = computed(() => {
  if (!props.service.connectionUrl) return ''
  return props.service.connectionUrl.replace(/\/\/.*@/, '//***:***@')
})

// Functions
function highlightLogLine(line) {
  let s = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  s = s.replace(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z?\s?)/, '<span class="text-gray-500">$1</span>')
  s = s.replace(/\b(error|Error|ERROR)\b/g, '<span class="text-red-500 font-semibold">$1</span>')
  s = s.replace(/\b(warn|Warn|WARN|warning|Warning|WARNING)\b/g, '<span class="text-amber-500 font-semibold">$1</span>')
  s = s.replace(/\b(info|Info|INFO)\b/g, '<span class="text-blue-400">$1</span>')
  s = s.replace(/\b(debug|Debug|DEBUG)\b/g, '<span class="text-gray-500">$1</span>')
  s = s.replace(/\b(LOG|STATEMENT|DETAIL|HINT|CONTEXT)\b:/g, '<span class="text-cyan-400">$1</span>:')
  s = s.replace(/\b(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|GRANT|REVOKE)\b/gi, '<span class="text-purple-400">$1</span>')
  s = s.replace(/\b(Ready to accept connections)\b/g, '<span class="text-emerald-400">$1</span>')
  return s
}

const {
  connected: logsConnected,
  error: logsError,
  close: disconnectLogs,
  connect: connectToLogs
} = useEventSource(
  `/api/v1/services/${props.service.id}/logs/stream?tail=200`,
  {
    immediate: false,
    onMessage(data) {
      if (data.log) {
        logLines.value.push(data.log)
        if (logLines.value.length > 1000) logLines.value = logLines.value.slice(-1000)
        if (autoScroll.value) {
          nextTick(() => {
            if (logContainer.value) logContainer.value.scrollTop = logContainer.value.scrollHeight
          })
        }
      }
    }
  }
)

async function stopService() {
  if (stopping.value) return
  stopping.value = true
  menuOpen.value = false

  const actionId = startAction({
    serviceName: serviceName.value,
    serviceType: props.service.type,
    action: 'stopping',
    projectName: props.project.name,
    environmentName: props.environment.name
  })

  try {
    const response = await fetch(`/api/v1/services/${props.service.id}/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': page.props._csrf || '' }
    })
    if (response.ok) {
      serviceStatus.value = 'stopped'
      disconnectLogs()
      completeAction(actionId, true)
    } else {
      completeAction(actionId, false)
    }
  } catch (err) {
    console.error('Failed to stop service:', err)
    completeAction(actionId, false)
  } finally { stopping.value = false }
}

async function restartService() {
  if (restarting.value) return
  restarting.value = true
  menuOpen.value = false

  // Use 'starting' if stopped, 'restarting' if running
  const actionType = serviceStatus.value === 'stopped' || serviceStatus.value === 'failed' ? 'starting' : 'restarting'

  const actionId = startAction({
    serviceName: serviceName.value,
    serviceType: props.service.type,
    action: actionType,
    projectName: props.project.name,
    environmentName: props.environment.name
  })

  try {
    const response = await fetch(`/api/v1/services/${props.service.id}/restart`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': page.props._csrf || '' }
    })
    if (response.ok) {
      serviceStatus.value = 'running'
      setTimeout(() => connectToLogs(), 2000)
      completeAction(actionId, true)
    } else {
      completeAction(actionId, false)
    }
  } catch (err) {
    console.error('Failed to restart service:', err)
    completeAction(actionId, false)
  } finally { restarting.value = false }
}

function clearLogs() {
  logLines.value = []
  menuOpen.value = false
}

function copyUrl() {
  if (!props.service.connectionUrl) return
  navigator.clipboard.writeText(props.service.connectionUrl)
  copiedUrl.value = true
  setTimeout(() => { copiedUrl.value = false }, 2000)
}

function startEditingName() {
  editedName.value = serviceName.value
  editingName.value = true
  nextTick(() => {
    if (nameInput.value) {
      nameInput.value.focus()
      nameInput.value.select()
    }
  })
}

function cancelEditingName() {
  editingName.value = false
  editedName.value = ''
}

async function saveName() {
  // Prevent double-save from blur + enter
  if (savingName.value || !editingName.value) return

  const newName = editedName.value.trim()
  if (!newName || newName === serviceName.value) {
    cancelEditingName()
    return
  }

  savingName.value = true
  try {
    const response = await fetch(`/api/v1/services/${props.service.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': page.props._csrf || '' },
      body: JSON.stringify({ name: newName })
    })

    if (response.ok) {
      serviceName.value = newName
      editingName.value = false
      toast({ message: 'Service renamed', type: 'success' })
    } else {
      toast({ message: 'Failed to rename service', type: 'error' })
    }
  } catch (err) {
    console.error('Failed to rename service:', err)
    toast({ message: 'Failed to rename service', type: 'error' })
  } finally {
    savingName.value = false
  }
}

function handleNameKeydown(e) {
  if (e.key === 'Enter') {
    e.preventDefault()
    saveName()
  } else if (e.key === 'Escape') {
    cancelEditingName()
  }
}

function handleClickOutside(e) {
  if (menuOpen.value && !e.target.closest('.menu-container')) menuOpen.value = false
  if (editingName.value && !e.target.closest('.name-editor')) cancelEditingName()
}

onMounted(() => {
  if (serviceStatus.value === 'running') connectToLogs()
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>

<template>
  <Head :title="`${serviceName} - ${project.name}`" />

  <div class="flex min-h-screen flex-col bg-white dark:bg-gray-950">
    <!-- Header -->
    <div class="sticky top-0 z-10 flex h-12 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4 dark:border-gray-800 dark:bg-gray-950">
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
          { label: project.name.toLowerCase(), href: `/projects/${project.slug}` },
          { label: environment.name.toLowerCase(), href: `/projects/${project.slug}/environments/${environment.slug}` },
          { label: serviceName }
        ]" />
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
      <div class="mx-auto max-w-6xl">
        <!-- Service Info -->
        <div class="mb-8 flex items-start justify-between">
          <div>
            <div class="flex items-center space-x-3">
              <!-- Editable name -->
              <div class="name-editor">
                <div v-if="editingName" class="flex items-center gap-2">
                  <input
                    ref="nameInput"
                    v-model="editedName"
                    type="text"
                    class="rounded-md border border-gray-300 bg-white px-2 py-1 text-xl font-semibold text-gray-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                    @keydown="handleNameKeydown"
                    @blur="saveName"
                    :disabled="savingName"
                  />
                  <span v-if="savingName" class="text-sm text-gray-400">Saving...</span>
                </div>
                <h1
                  v-else
                  @click.stop="startEditingName"
                  class="cursor-pointer text-xl font-semibold text-gray-900 underline decoration-dashed decoration-gray-300 underline-offset-4 hover:decoration-gray-400 dark:text-white dark:decoration-gray-600 dark:hover:decoration-gray-500"
                  title="Click to rename"
                >{{ serviceName }}</h1>
              </div>
              <span :class="['inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium', serviceTypeBadge.classes]">
                {{ serviceTypeBadge.label }}
              </span>
            </div>

            <!-- Connection URL -->
            <div v-if="service.connectionUrl" class="mt-1">
              <div class="group flex items-center gap-2">
                <span class="text-sm text-gray-500 dark:text-gray-400 font-mono">
                  {{ revealedUrl ? service.connectionUrl : maskedUrl }}
                </span>
                <button
                  @click="revealedUrl = !revealedUrl"
                  class="rounded p-0.5 text-gray-300 opacity-0 transition-opacity hover:text-gray-500 group-hover:opacity-100 dark:text-gray-600 dark:hover:text-gray-400"
                >
                  <svg v-if="revealedUrl" class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L6.5 6.5m7.378 7.378L17.5 17.5M3 3l18 18" />
                  </svg>
                  <svg v-else class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                </button>
                <button
                  @click="copyUrl"
                  class="rounded p-0.5 text-gray-300 opacity-0 transition-opacity hover:text-gray-500 group-hover:opacity-100 dark:text-gray-600 dark:hover:text-gray-400"
                >
                  <svg v-if="copiedUrl" class="h-3.5 w-3.5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                  </svg>
                  <svg v-else class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
              </div>
            </div>

            <!-- Internal host info -->
            <div v-if="service.internalHost" class="mt-2 flex items-center space-x-2">
              <span class="inline-flex items-center rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 ring-1 ring-inset ring-gray-500/10 dark:bg-gray-800 dark:text-gray-400 dark:ring-gray-500/20">
                Internal
              </span>
              <span class="font-mono text-sm text-gray-600 dark:text-gray-400">
                {{ service.internalHost }}:{{ service.internalPort }}
              </span>
            </div>
          </div>

          <div class="flex items-center space-x-2">
            <!-- More menu -->
            <div class="menu-container relative">
              <button
                @click.stop="menuOpen = !menuOpen"
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
                  v-if="menuOpen"
                  @click.stop
                  class="absolute right-0 top-full z-20 mt-1 w-40 rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
                >
                  <button
                    v-if="serviceStatus === 'running'"
                    @click="stopService"
                    :disabled="stopping"
                    class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    <svg class="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                    </svg>
                    {{ stopping ? 'Stopping...' : 'Stop' }}
                  </button>
                  <button
                    v-else
                    @click="restartService"
                    :disabled="restarting"
                    class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    <svg class="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    {{ restarting ? 'Starting...' : 'Start' }}
                  </button>
                  <Link
                    :href="`/projects/${project.slug}/environments/${environment.slug}/services/${service.id}/settings`"
                    class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    <svg class="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    Settings
                  </Link>
                  <button
                    @click="clearLogs"
                    class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    <svg class="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    Clear logs
                  </button>
                </div>
              </Transition>
            </div>

            <!-- Status badge -->
            <span :class="['inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium', statusClasses.bg]">
              <span :class="['h-1.5 w-1.5 rounded-full', statusClasses.dot]"></span>
              <span :class="statusClasses.text">{{ statusLabel }}</span>
            </span>
          </div>
        </div>

        <!-- Unified Card -->
        <div class="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <!-- Logs Section -->
          <div>
            <div class="flex items-center justify-between px-4 py-3">
              <button
                @click="logsOpen = !logsOpen"
                class="flex flex-1 items-center space-x-3 text-left hover:opacity-80"
              >
                <h2 class="text-sm font-medium text-gray-900 dark:text-white">Logs</h2>
                <span
                  v-if="logsConnected"
                  class="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                >
                  <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500"></span>
                  Live
                </span>
                <span
                  v-else-if="serviceStatus !== 'running'"
                  class="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                >
                  Not running
                </span>
              </button>
              <div class="flex items-center gap-2">
                <label v-if="logsOpen" class="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
                  <input
                    v-model="autoScroll"
                    type="checkbox"
                    class="h-3.5 w-3.5 rounded border-gray-300 text-brand focus:ring-brand dark:border-gray-600 dark:bg-gray-800"
                  />
                  Auto-scroll
                </label>
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
            </div>

            <div v-show="logsOpen">
              <div
                v-if="logsError && serviceStatus === 'running'"
                class="border-t border-gray-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-gray-800 dark:bg-red-900/20 dark:text-red-400"
              >
                {{ logsError }}
              </div>

              <div
                v-if="serviceStatus !== 'running'"
                class="border-t border-gray-200 px-4 py-8 text-center dark:border-gray-800"
              >
                <svg class="mx-auto h-10 w-10 text-gray-300 dark:text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
                  Service is not running. Start the service to view logs.
                </p>
              </div>

              <div
                v-else
                class="border-t border-gray-200 dark:border-gray-800"
              >
                <div
                  ref="logContainer"
                  class="h-96 overflow-y-auto bg-gray-100 p-4 font-mono text-xs leading-5 text-gray-700 dark:bg-gray-950 dark:text-gray-300"
                  @scroll="autoScroll = logContainer && (logContainer.scrollHeight - logContainer.scrollTop - logContainer.clientHeight < 40)"
                >
                  <div v-if="serviceStatus !== 'running'" class="flex h-full flex-col items-center justify-center text-gray-500">
                    <svg class="mb-2 h-8 w-8 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                    </svg>
                    <p>Service is not running</p>
                    <p class="mt-1 text-xs text-gray-400 dark:text-gray-600">Start the service to view logs</p>
                  </div>
                  <div v-else-if="!logsConnected && logLines.length === 0" class="flex h-full items-center justify-center text-gray-500">
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
        </div>
      </div>
    </div>
  </div>
</template>
