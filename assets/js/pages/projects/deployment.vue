<script setup>
import { Link, Head, router } from '@inertiajs/vue3'
import {
  inject,
  ref,
  computed,
  watch,
  nextTick,
  onMounted,
  onBeforeUnmount
} from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'
import Breadcrumb from '@/components/Breadcrumb.vue'
import SlippyLoader from '@/components/SlippyLoader.vue'
import { useEventSource } from '@/composables/sse'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  project: Object,
  environment: Object,
  deployment: Object
})

const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')
const logContainer = ref(null)

// SSE-powered real-time updates
const sseStatus = ref(null)
const sseLogs = ref('')

const deployment = computed(() => ({
  ...props.deployment,
  ...(sseStatus.value ? { status: sseStatus.value } : {})
}))

const isInProgress = computed(() =>
  ['pending', 'building', 'deploying'].includes(deployment.value.status)
)

const allLogs = computed(() => {
  const build = props.deployment.buildLogs || ''
  const deploy = props.deployment.deployLogs || ''
  return (build + deploy + sseLogs.value).trim()
})

const highlightedLogs = computed(() => {
  if (!allLogs.value) return ''
  return allLogs.value.split('\n').map(highlightLine).join('\n')
})

function highlightLine(line) {
  // Escape HTML entities first
  let s = line
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // Step number at start of line (#0, #1, etc.)
  s = s.replace(
    /^(#\d+)/,
    '<span class="text-cyan-600 dark:text-cyan-500">$1</span>'
  )

  // DONE marker with timing
  s = s.replace(
    /\bDONE (\d+\.\d+s)/,
    '<span class="text-green-600 dark:text-green-400 font-semibold">DONE</span> <span class="text-gray-400 dark:text-gray-500">$1</span>'
  )

  // ERROR marker
  s = s.replace(
    /\bERROR\b/g,
    '<span class="text-red-600 dark:text-red-400 font-semibold">ERROR</span>'
  )

  // CANCELED marker
  s = s.replace(
    /\bCANCELED\b/g,
    '<span class="text-yellow-600 dark:text-yellow-400 font-semibold">CANCELED</span>'
  )

  // Build stage steps [1/6], [2/6], etc.
  s = s.replace(
    /\[(\d+\/\d+)\]/,
    '<span class="text-yellow-600 dark:text-yellow-400">[$1]</span>'
  )

  // [internal] tag
  s = s.replace(
    /\[internal\]/,
    '<span class="text-gray-400 dark:text-gray-500">[internal]</span>'
  )

  // [auth] tag
  s = s.replace(
    /\[auth\]/,
    '<span class="text-gray-400 dark:text-gray-500">[auth]</span>'
  )

  // Dockerfile instructions
  s = s.replace(
    /\b(FROM|RUN|COPY|WORKDIR|EXPOSE|CMD|ENTRYPOINT|ENV|ARG|ADD|LABEL|USER|VOLUME)\b/,
    '<span class="text-purple-600 dark:text-purple-400">$1</span>'
  )

  // "done" at end of line
  s = s.replace(
    /\bdone$/,
    '<span class="text-green-600 dark:text-green-500">done</span>'
  )

  // sha256 hashes — dim them
  s = s.replace(
    /(sha256:)([a-f0-9]+)/g,
    '<span class="text-gray-400 dark:text-gray-600">$1$2</span>'
  )

  // Docker image references (e.g. docker.io/library/node:22-slim)
  s = s.replace(
    /(docker\.io\/[^\s@]+)/g,
    '<span class="text-blue-600 dark:text-blue-400">$1</span>'
  )

  return s
}

const { close: disconnectDeploymentStream } = useEventSource(
  `/api/v1/deployments/${props.deployment.id}/stream`,
  {
    immediate: isInProgress.value,
    onMessage(data) {
      if (data.status) {
        sseStatus.value = data.status
        if (['running', 'failed', 'cancelled'].includes(data.status)) {
          disconnectDeploymentStream()
          router.reload()
        }
      }
      if (data.output) {
        sseLogs.value += data.output + '\n'
      }
    }
  }
)

// Auto-scroll log container when logs update
watch(
  allLogs,
  async () => {
    await nextTick()
    if (logContainer.value) {
      logContainer.value.scrollTop = logContainer.value.scrollHeight
    }
  },
  { immediate: true }
)

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
      label: 'Queued',
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
    }
  }
  return (
    map[status] || {
      label: status,
      classes: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
    }
  )
}

function formatDuration(seconds) {
  if (!seconds) return '—'
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${minutes}m ${secs}s`
}

function formatDate(timestamp) {
  if (!timestamp) return '—'
  return new Date(timestamp).toLocaleString()
}

// Cancel deployment
const cancelling = ref(false)

async function cancelDeployment() {
  if (cancelling.value) return
  cancelling.value = true

  try {
    const res = await fetch(
      `/api/v1/deployments/${props.deployment.id}/cancel`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }
    )

    if (res.ok) {
      disconnectDeploymentStream()
      sseStatus.value = 'cancelled'
      router.reload()
    } else {
      const data = await res.json()
      alert(data.message || 'Failed to cancel deployment')
    }
  } catch (e) {
    console.error('Failed to cancel:', e)
  } finally {
    cancelling.value = false
  }
}

// Rollback
const canRollback = computed(
  () =>
    props.deployment.status === 'running' &&
    !props.deployment.isCurrentDeployment &&
    props.deployment.imageName
)

const rollingBack = ref(false)

// Slide-to-rollback
const slideTrack = ref(null)
const slideProgress = ref(0)
const isSliding = ref(false)

const thumbColor = computed(() => {
  if (slideProgress.value < 0.33)
    return 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
  if (slideProgress.value < 0.66) return 'bg-yellow-500 text-white'
  return 'bg-red-500 text-white'
})

const trackFill = computed(() => {
  if (slideProgress.value < 0.33) return 'bg-transparent'
  if (slideProgress.value < 0.66) return 'bg-yellow-500/10'
  return 'bg-red-500/10'
})

let cleanupSlide = null

function startSlide(e) {
  if (rollingBack.value) return
  isSliding.value = true
  const startX = e.type === 'touchstart' ? e.touches[0].clientX : e.clientX
  const track = slideTrack.value
  const maxSlide = track.offsetWidth - 40

  const onMove = (moveEvent) => {
    const currentX =
      moveEvent.type === 'touchmove'
        ? moveEvent.touches[0].clientX
        : moveEvent.clientX
    const delta = startX - currentX
    slideProgress.value = Math.max(0, Math.min(1, delta / maxSlide))
  }

  const onEnd = () => {
    isSliding.value = false
    if (slideProgress.value > 0.85) {
      slideProgress.value = 1
      executeRollback()
    } else {
      slideProgress.value = 0
    }
    cleanup()
  }

  const cleanup = () => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onEnd)
    document.removeEventListener('touchmove', onMove)
    document.removeEventListener('touchend', onEnd)
    cleanupSlide = null
  }

  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onEnd)
  document.addEventListener('touchmove', onMove)
  document.addEventListener('touchend', onEnd)
  cleanupSlide = cleanup
}

onBeforeUnmount(() => {
  disconnectDeploymentStream()
  if (cleanupSlide) cleanupSlide()
})

function executeRollback() {
  rollingBack.value = true
  router.post(
    `/api/v1/projects/${props.project.slug}/environments/${props.environment.slug}/rollback`,
    { deploymentId: props.deployment.id },
    {
      onSuccess: (page) => {
        const newDeployment = page.props?.deployment
        if (newDeployment?.id) {
          router.visit(
            `/projects/${props.project.slug}/deployments/${newDeployment.id}`
          )
        }
      },
      onFinish: () => {
        rollingBack.value = false
        slideProgress.value = 0
      }
    }
  )
}
</script>
<template>
  <Head :title="`Deployment ${deployment.id} | Slipway`"></Head>
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
            { label: String(deployment.id) }
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
    <div class="flex flex-1 flex-col overflow-hidden px-4 py-6 sm:px-8 sm:py-8">
      <div
        class="mx-auto flex w-full max-w-5xl flex-1 flex-col overflow-hidden"
      >
        <!-- Deployment Info -->
        <div class="mb-6 flex items-start justify-between">
          <div>
            <div class="flex items-center space-x-3">
              <h1 class="text-xl font-semibold text-gray-900 dark:text-white">
                Deployment
              </h1>
              <span
                :class="[
                  'inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium',
                  statusBadge(deployment.status).classes
                ]"
              >
                {{ statusBadge(deployment.status).label }}
              </span>
              <span
                v-if="deployment.isCurrentDeployment"
                class="bg-brand/10 text-brand inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium"
              >
                current
              </span>
              <span
                v-if="isInProgress"
                class="inline-flex items-center space-x-1 text-xs text-blue-600 dark:text-blue-400"
              >
                <SlippyLoader size="h-3 w-3" />
                <span>In progress</span>
              </span>
            </div>
          </div>
          <!-- Cancel button (for in-progress deployments) -->
          <button
            v-if="isInProgress"
            data-test="cancel-deployment"
            @click="cancelDeployment"
            :disabled="cancelling"
            class="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            {{ cancelling ? 'Cancelling...' : 'Cancel' }}
          </button>
          <!-- Slide to Rollback -->
          <div
            v-if="canRollback"
            ref="slideTrack"
            class="relative h-10 w-56 select-none overflow-hidden rounded-full border border-gray-200 bg-gray-100 dark:border-gray-800 dark:bg-gray-900"
          >
            <!-- Track fill -->
            <div
              class="absolute inset-y-0 left-0"
              :class="[
                trackFill,
                { 'transition-[width] duration-300': !isSliding }
              ]"
              :style="{ width: `${slideProgress * 100}%` }"
            ></div>

            <!-- Label -->
            <span
              class="pointer-events-none absolute inset-0 flex items-center justify-center text-xs font-medium text-gray-400 dark:text-gray-500"
            >
              {{
                rollingBack
                  ? 'Rolling back...'
                  : slideProgress > 0.85
                  ? 'Release to confirm'
                  : 'Slide to rollback'
              }}
            </span>

            <!-- Thumb -->
            <div
              class="absolute bottom-0.5 top-0.5 flex w-10 items-center justify-center rounded-full shadow-lg"
              :class="[
                rollingBack
                  ? 'cursor-not-allowed bg-red-500 text-white'
                  : thumbColor + ' cursor-grab active:cursor-grabbing',
                { 'transition-all duration-300 ease-out': !isSliding }
              ]"
              :style="{
                left: `calc(${(1 - slideProgress) * 100}% - ${
                  (1 - slideProgress) * 2.5
                }rem)`
              }"
              @mousedown.prevent="startSlide"
              @touchstart.prevent="startSlide"
            >
              <svg
                v-if="!rollingBack"
                class="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M15 19l-7-7 7-7"
                />
              </svg>
              <SlippyLoader v-else size="h-4 w-4" />
            </div>
          </div>
        </div>

        <!-- Metadata -->
        <div class="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <dt class="text-xs text-gray-500 dark:text-gray-400">
              Triggered by
            </dt>
            <dd class="mt-1 text-sm text-gray-900 dark:text-white">
              {{
                deployment.triggeredBy?.fullName ||
                (deployment.triggerType === 'webhook' ? 'Git' : 'System')
              }}
            </dd>
          </div>
          <div>
            <dt class="text-xs text-gray-500 dark:text-gray-400">Started</dt>
            <dd class="mt-1 text-sm text-gray-900 dark:text-white">
              {{ formatDate(deployment.startedAt) }}
            </dd>
          </div>
          <div>
            <dt class="text-xs text-gray-500 dark:text-gray-400">Duration</dt>
            <dd class="mt-1 text-sm text-gray-900 dark:text-white">
              {{ formatDuration(deployment.duration) }}
            </dd>
          </div>
          <div v-if="deployment.gitBranch">
            <dt class="text-xs text-gray-500 dark:text-gray-400">Branch</dt>
            <dd class="mt-1 text-sm text-gray-900 dark:text-white">
              {{ deployment.gitBranch }}
              <span
                v-if="deployment.gitCommit"
                class="ml-1 font-mono text-xs text-gray-500"
              >
                {{ deployment.gitCommit.slice(0, 7) }}
              </span>
            </dd>
          </div>
        </div>

        <!-- Failure summary remains visible even when the pipeline failed before logs started. -->
        <section
          v-if="deployment.errorMessage"
          role="alert"
          aria-labelledby="deployment-error-title"
          :class="[
            'mb-6 rounded-lg border p-4',
            deployment.status === 'cancelled'
              ? 'border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900'
              : 'border-red-200 bg-red-50 dark:border-red-900/60 dark:bg-red-950/30'
          ]"
        >
          <div class="flex items-start gap-3">
            <svg
              :class="[
                'mt-0.5 h-5 w-5 shrink-0',
                deployment.status === 'cancelled'
                  ? 'text-gray-500 dark:text-gray-400'
                  : 'text-red-600 dark:text-red-400'
              ]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4c-.77-1.33-2.69-1.33-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z"
              />
            </svg>
            <div class="min-w-0">
              <h2
                id="deployment-error-title"
                :class="[
                  'text-sm font-semibold',
                  deployment.status === 'cancelled'
                    ? 'text-gray-900 dark:text-gray-100'
                    : 'text-red-900 dark:text-red-200'
                ]"
              >
                {{
                  deployment.status === 'cancelled'
                    ? 'Deployment cancelled'
                    : 'Deployment failed'
                }}
              </h2>
              <p
                :class="[
                  'mt-1 break-words text-sm leading-6',
                  deployment.status === 'cancelled'
                    ? 'text-gray-700 dark:text-gray-300'
                    : 'text-red-800 dark:text-red-300'
                ]"
              >
                {{ deployment.errorMessage }}
              </p>
              <p
                :class="[
                  'mt-2 text-xs',
                  deployment.status === 'cancelled'
                    ? 'text-gray-600 dark:text-gray-400'
                    : 'text-red-700 dark:text-red-400'
                ]"
              >
                {{
                  deployment.status === 'cancelled'
                    ? 'Any candidate release was cleaned up before traffic changed.'
                    : 'Review the stage logs below, correct the problem, and deploy again.'
                }}
              </p>
            </div>
          </div>
        </section>

        <!-- Log Viewer -->
        <div
          class="flex flex-1 flex-col overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800"
        >
          <div
            class="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-2 dark:border-gray-800 dark:bg-gray-900"
          >
            <span class="text-xs font-medium text-gray-500 dark:text-gray-400"
              >Build &amp; Deploy Logs</span
            >
          </div>
          <div
            ref="logContainer"
            class="flex-1 overflow-y-auto bg-gray-50 p-4 font-mono text-xs leading-5 text-gray-700 dark:bg-gray-950 dark:text-gray-300"
          >
            <pre
              v-if="allLogs"
              class="whitespace-pre-wrap break-all"
              v-html="highlightedLogs"
            ></pre>
            <div
              v-else-if="isInProgress"
              class="flex items-center space-x-2 text-gray-500"
            >
              <SlippyLoader size="h-4 w-4" />
              <span>Waiting for logs...</span>
            </div>
            <span v-else class="text-gray-500"
              >No additional logs were captured.</span
            >
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
