<script setup>
import Alert from '@/components/ui/alert/Alert.vue'
import StopCircle from '@/components/ui/icons/StopCircle.vue'
import SidebarOpen from '@/components/ui/icons/SidebarOpen.vue'
import SidebarClose from '@/components/ui/icons/SidebarClose.vue'
import Settings from '@/components/ui/icons/Settings.vue'
import Refresh from '@/components/ui/icons/Refresh.vue'
import EyeOff from '@/components/ui/icons/EyeOff.vue'
import Eye from '@/components/ui/icons/Eye.vue'
import EllipsisVertical from '@/components/ui/icons/EllipsisVertical.vue'
import Check from '@/components/ui/icons/Check.vue'
import Trash from '@/components/ui/icons/Trash.vue'
import Copy from '@/components/ui/icons/Copy.vue'
import ChevronRight from '@/components/ui/icons/ChevronRight.vue'
import Input from '@/components/ui/input/Input.vue'
import { Link, Head, usePage, router } from '@inertiajs/vue3'
import { inject, ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useEventSource } from '@/composables/sse'
import AppLayout from '@/layouts/AppLayout.vue'
import Breadcrumb from '@/components/ui/breadcrumb/Breadcrumb.vue'
import { useToast } from '@/composables/toast'
import { useServiceActions } from '@/composables/service-actions'
import LogViewer from '@/components/LogViewer.vue'
import RowActions from '@/components/ui/row-actions/RowActions.vue'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  project: Object,
  environment: Object,
  restoreOperation: Object,
  service: Object
})

const page = usePage()
const toast = useToast()
const { startAction, completeAction } = useServiceActions()
const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')

// State
const logLines = ref([])
const logsOpen = ref(true)
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

const restoreOperation = ref(props.restoreOperation)
const writesPaused = ref(false)
const restoreBusy = ref(false)
const restoreError = ref('')
let restorePoll
async function refreshRestore() {
  if (!restoreOperation.value) return
  try {
    const response = await fetch(
      `/api/v1/restore-operations/${restoreOperation.value.id}`
    )
    if (!response.ok)
      throw new Error(
        'Could not refresh restore status. Keep writes paused and retry.'
      )
    restoreOperation.value = (await response.json()).operation
    restoreError.value = ''
    if (['queued', 'running'].includes(restoreOperation.value.status))
      restorePoll = setTimeout(refreshRestore, 2000)
    else router.reload({ only: ['service'] })
  } catch (error) {
    restoreError.value = error.message
  }
}
async function startRestore() {
  restoreBusy.value = true
  restoreError.value = ''
  try {
    const response = await fetch(
      `/api/v1/backups/${props.service.lastBackup.id}/restore`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': page.props._csrf || ''
        },
        body: JSON.stringify({ writesPaused: writesPaused.value })
      }
    )
    const data = await response.json()
    if (!response.ok)
      throw new Error(
        data.message ||
          'Restore could not be queued. Refresh service status before retrying.'
      )
    restoreOperation.value = data.operation
    serviceStatus.value = 'restoring'
    await refreshRestore()
  } catch (error) {
    restoreError.value = error.message
  } finally {
    restoreBusy.value = false
  }
}

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
    postgresql: {
      label: 'PostgreSQL',
      classes:
        'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
    },
    mysql: {
      label: 'MySQL',
      classes:
        'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
    },
    redis: {
      label: 'Redis',
      classes: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
    },
    mongodb: {
      label: 'MongoDB',
      classes:
        'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
    }
  }
  return (
    badges[props.service.type] || {
      label: props.service.type,
      classes: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400'
    }
  )
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
    upgrading: {
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
    upgrading: 'Upgrading',
    failed: 'Failed'
  }
  return labels[serviceStatus.value] || serviceStatus.value
})

const maskedUrl = computed(() => {
  if (!props.service.connectionUrl) return ''
  return props.service.connectionUrl.replace(/\/\/.*@/, '//***:***@')
})

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
      if (Object.prototype.hasOwnProperty.call(data, 'log')) {
        logLines.value.push(data.log)
        if (logLines.value.length > 1000)
          logLines.value = logLines.value.slice(-1000)
      }
    }
  }
)

async function stopService() {
  if (stopping.value) return
  stopping.value = true
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
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': page.props._csrf || ''
      }
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
  } finally {
    stopping.value = false
  }
}

async function restartService() {
  if (restarting.value) return
  restarting.value = true
  // Use 'starting' if stopped, 'restarting' if running
  const actionType =
    serviceStatus.value === 'stopped' || serviceStatus.value === 'failed'
      ? 'starting'
      : 'restarting'

  const actionId = startAction({
    serviceName: serviceName.value,
    serviceType: props.service.type,
    action: actionType,
    projectName: props.project.name,
    environmentName: props.environment.name
  })

  try {
    const response = await fetch(
      `/api/v1/services/${props.service.id}/restart`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': page.props._csrf || ''
        }
      }
    )
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
  } finally {
    restarting.value = false
  }
}

function clearLogs() {
  logLines.value = []
}

function copyUrl() {
  if (!props.service.connectionUrl) return
  navigator.clipboard.writeText(props.service.connectionUrl)
  copiedUrl.value = true
  setTimeout(() => {
    copiedUrl.value = false
  }, 2000)
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
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': page.props._csrf || ''
      },
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
  if (editingName.value && !e.target.closest('.name-editor'))
    cancelEditingName()
}

onMounted(() => {
  if (['queued', 'running'].includes(restoreOperation.value?.status))
    refreshRestore()
  if (serviceStatus.value === 'running') connectToLogs()
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  clearTimeout(restorePoll)
  document.removeEventListener('click', handleClickOutside)
})
</script>

<template>
  <Head :title="`${serviceName} - ${project.name}`" />

  <div class="flex min-h-screen flex-col bg-white dark:bg-gray-950">
    <!-- Header -->
    <div
      class="sticky top-0 z-10 flex h-12 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4 dark:border-gray-800 dark:bg-gray-950"
    >
      <div class="flex min-w-0 items-center space-x-3">
        <button
          @click="toggleMobileMenu"
          class="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white md:hidden"
        >
          <SidebarOpen class="h-5 w-5" stroke-width="1" />
        </button>
        <!-- Desktop sidebar toggle -->
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
        <Breadcrumb
          :items="[
            {
              label: project.name.toLowerCase(),
              href: `/projects/${project.slug}`
            },
            {
              label: environment.name.toLowerCase(),
              href: `/projects/${project.slug}/environments/${environment.slug}`
            },
            { label: serviceName }
          ]"
        />
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
      <div class="mx-auto max-w-6xl">
        <section
          v-if="restoreOperation || service.lastBackup?.status === 'completed'"
          class="mb-8 rounded-lg border border-gray-200 p-5 dark:border-gray-700"
          aria-label="Database restoration"
        >
          <h2 class="font-medium">Database restoration</h2>
          <div
            v-if="restoreOperation"
            class="mt-3 space-y-2 text-sm"
            role="status"
          >
            <p>
              Restore {{ restoreOperation.id }}:
              <strong>{{ restoreOperation.status }}</strong> ·
              {{ restoreOperation.stage }}
            </p>
            <p v-if="restoreOperation.snapshotId">
              Safety snapshot: {{ restoreOperation.snapshotId }}
            </p>
            <Alert
              role="alert"
              v-if="restoreOperation.error"
              class="border border-red-200 bg-red-50 text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200"
            >
              {{ restoreOperation.error }}
            </Alert>
            <p v-else-if="restoreOperation.status === 'completed'">
              Restore completed. Verify the database before resuming writes.
            </p>
            <p v-else>
              Keep application and external database writes paused until
              restoration completes.
            </p>
          </div>
          <Alert
            v-if="restoreError"
            class="mt-3 border border-red-200 bg-red-50 text-sm text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200"
            role="alert"
          >
            {{ restoreError }}
            <button
              v-if="restoreOperation"
              class="underline"
              @click="refreshRestore"
            >
              Refresh status
            </button>
          </Alert>
          <div
            v-if="
              service.lastBackup?.status === 'completed' &&
              !['queued', 'running'].includes(restoreOperation?.status)
            "
            class="mt-4 space-y-3 text-sm"
          >
            <p>
              Restore backup {{ service.lastBackup.id }} into this database.
              This replaces existing data.
            </p>
            <label class="flex items-start gap-2"
              ><input v-model="writesPaused" type="checkbox" class="mt-1" />I
              have paused application and external database writes.</label
            >
            <button
              class="rounded bg-gray-900 px-3 py-2 text-white disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900"
              :disabled="
                !writesPaused || restoreBusy || service.status !== 'running'
              "
              @click="startRestore"
            >
              {{ restoreBusy ? 'Queuing restore…' : 'Restore backup' }}
            </button>
          </div>
        </section>
        <!-- Service Info -->
        <div class="mb-8 flex items-start justify-between">
          <div>
            <div class="flex items-center space-x-3">
              <!-- Editable name -->
              <div class="name-editor">
                <div v-if="editingName" class="flex items-center gap-2">
                  <Input
                    ref="nameInput"
                    v-model="editedName"
                    type="text"
                    class="focus:border-brand focus:ring-brand rounded-md border border-gray-300 bg-white px-2 py-1 text-xl font-semibold text-gray-900 focus:outline-none focus:ring-1 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                    @keydown="handleNameKeydown"
                    @blur="saveName"
                    :disabled="savingName"
                  />
                  <span v-if="savingName" class="text-sm text-gray-400"
                    >Saving...</span
                  >
                </div>
                <h1
                  v-else
                  @click.stop="startEditingName"
                  class="cursor-pointer text-xl font-semibold text-gray-900 underline decoration-gray-300 decoration-dashed underline-offset-4 hover:decoration-gray-400 dark:text-white dark:decoration-gray-600 dark:hover:decoration-gray-500"
                  title="Click to rename"
                >
                  {{ serviceName }}
                </h1>
              </div>
              <span
                :class="[
                  'inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium',
                  serviceTypeBadge.classes
                ]"
              >
                {{ serviceTypeBadge.label }}
              </span>
            </div>

            <!-- Connection URL -->
            <div v-if="service.connectionUrl" class="mt-1">
              <div class="group flex items-center gap-2">
                <span
                  class="font-mono text-sm text-gray-500 dark:text-gray-400"
                >
                  {{ revealedUrl ? service.connectionUrl : maskedUrl }}
                </span>
                <button
                  @click="revealedUrl = !revealedUrl"
                  class="rounded p-0.5 text-gray-300 opacity-0 transition-opacity hover:text-gray-500 group-hover:opacity-100 dark:text-gray-600 dark:hover:text-gray-400"
                >
                  <EyeOff
                    v-if="revealedUrl"
                    class="h-3.5 w-3.5"
                    stroke-width="2"
                  />
                  <Eye v-else class="h-3.5 w-3.5" stroke-width="2" />
                </button>
                <button
                  @click="copyUrl"
                  class="rounded p-0.5 text-gray-300 opacity-0 transition-opacity hover:text-gray-500 group-hover:opacity-100 dark:text-gray-600 dark:hover:text-gray-400"
                >
                  <Check
                    v-if="copiedUrl"
                    class="h-3.5 w-3.5 text-emerald-500"
                    stroke-width="2"
                  />
                  <Copy v-else class="h-3.5 w-3.5" stroke-width="2" />
                </button>
              </div>
            </div>

            <!-- Internal host info -->
            <div
              v-if="service.internalHost"
              class="mt-2 flex items-center space-x-2"
            >
              <span
                class="inline-flex items-center rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 ring-1 ring-inset ring-gray-500/10 dark:bg-gray-800 dark:text-gray-400 dark:ring-gray-500/20"
              >
                Internal
              </span>
              <span class="font-mono text-sm text-gray-600 dark:text-gray-400">
                {{ service.internalHost }}:{{ service.internalPort }}
              </span>
            </div>
          </div>

          <div class="flex items-center space-x-2">
            <!-- More menu -->
            <RowActions
              :id="`service-actions-${service.id}`"
              :label="`Actions for ${serviceName}`"
              :busy="stopping || restarting"
              data-test="service-row-actions"
              class="[&_[data-slot=row-actions-trigger]]:size-7 text-gray-400 [&_[data-row-actions-menu]]:w-40 [&_[data-row-actions-menu]]:rounded-lg [&_[data-row-actions-menu]]:border-gray-200 [&_[data-row-actions-menu]]:bg-white [&_[data-row-actions-menu]]:px-0 [&_[data-row-actions-menu]]:py-1 [&_[data-row-actions-menu]]:shadow-lg dark:[&_[data-row-actions-menu]]:border-gray-700 dark:[&_[data-row-actions-menu]]:bg-gray-900 [&_[data-slot=row-actions-trigger]]:hover:bg-gray-100 [&_[data-slot=row-actions-trigger]]:hover:text-gray-700 dark:[&_[data-slot=row-actions-trigger]]:hover:bg-gray-800 dark:[&_[data-slot=row-actions-trigger]]:hover:text-gray-200"
            >
              <template #trigger>
                <EllipsisVertical class="h-4 w-4" />
              </template>
              <template #menu>
                <div class="contents">
                  <button
                    v-if="serviceStatus === 'running'"
                    @click="stopService"
                    :disabled="stopping"
                    class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    <StopCircle
                      class="h-4 w-4 text-gray-400"
                      stroke-width="2"
                    />
                    {{ stopping ? 'Stopping...' : 'Stop' }}
                  </button>
                  <button
                    v-else
                    @click="restartService"
                    :disabled="restarting"
                    class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    <Refresh class="h-4 w-4 text-gray-400" stroke-width="2" />
                    {{ restarting ? 'Starting...' : 'Start' }}
                  </button>
                  <Link
                    :href="`/projects/${project.slug}/environments/${environment.slug}/services/${service.id}/settings`"
                    class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    <Settings class="h-4 w-4 text-gray-400" stroke-width="2" />
                    Settings
                  </Link>
                  <button
                    @click="clearLogs"
                    class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    <Trash class="h-4 w-4 text-gray-400" stroke-width="2" />
                    Clear logs
                  </button>
                </div>
              </template>
            </RowActions>

            <!-- Status badge -->
            <span
              :class="[
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium',
                statusClasses.bg
              ]"
            >
              <span
                :class="['h-1.5 w-1.5 rounded-full', statusClasses.dot]"
              ></span>
              <span :class="statusClasses.text">{{ statusLabel }}</span>
            </span>
          </div>
        </div>

        <!-- Unified Card -->
        <div
          class="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
        >
          <!-- Logs Section -->
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
                  v-if="serviceStatus !== 'running'"
                  class="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                >
                  Not running
                </span>
              </button>
              <div class="flex items-center gap-2">
                <button
                  @click="logsOpen = !logsOpen"
                  class="rounded p-0.5 hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  <ChevronRight
                    :class="[
                      'h-4 w-4 text-gray-400 transition-transform duration-200',
                      logsOpen ? 'rotate-90' : ''
                    ]"
                    stroke-width="2"
                  />
                </button>
              </div>
            </div>

            <div v-show="logsOpen">
              <LogViewer
                :lines="logLines"
                :connected="logsConnected"
                :error="serviceStatus === 'running' ? logsError : ''"
                :inactive-message="
                  serviceStatus === 'running'
                    ? ''
                    : 'Service is not running. Start it to view logs.'
                "
                height="lg"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
