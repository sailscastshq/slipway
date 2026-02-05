<script setup>
import { Link, Head, usePoll, router } from '@inertiajs/vue3'
import { inject, ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  project: Object,
  environment: Object,
  deployment: Object
})

const toggleMobileMenu = inject('toggleMobileMenu')
const logContainer = ref(null)

const isInProgress = computed(() =>
  ['pending', 'building', 'deploying'].includes(props.deployment.status)
)

const allLogs = computed(() => {
  const build = props.deployment.buildLogs || ''
  const deploy = props.deployment.deployLogs || ''
  return (build + deploy).trim()
})

const highlightedLogs = computed(() => {
  if (!allLogs.value) return ''
  return allLogs.value.split('\n').map(highlightLine).join('\n')
})

function highlightLine(line) {
  // Escape HTML entities first
  let s = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  // Step number at start of line (#0, #1, etc.)
  s = s.replace(/^(#\d+)/, '<span class="text-cyan-600 dark:text-cyan-500">$1</span>')

  // DONE marker with timing
  s = s.replace(/\bDONE (\d+\.\d+s)/, '<span class="text-green-600 dark:text-green-400 font-semibold">DONE</span> <span class="text-gray-400 dark:text-gray-500">$1</span>')

  // ERROR marker
  s = s.replace(/\bERROR\b/g, '<span class="text-red-600 dark:text-red-400 font-semibold">ERROR</span>')

  // CANCELED marker
  s = s.replace(/\bCANCELED\b/g, '<span class="text-yellow-600 dark:text-yellow-400 font-semibold">CANCELED</span>')

  // Build stage steps [1/6], [2/6], etc.
  s = s.replace(/\[(\d+\/\d+)\]/, '<span class="text-yellow-600 dark:text-yellow-400">[$1]</span>')

  // [internal] tag
  s = s.replace(/\[internal\]/, '<span class="text-gray-400 dark:text-gray-500">[internal]</span>')

  // [auth] tag
  s = s.replace(/\[auth\]/, '<span class="text-gray-400 dark:text-gray-500">[auth]</span>')

  // Dockerfile instructions
  s = s.replace(/\b(FROM|RUN|COPY|WORKDIR|EXPOSE|CMD|ENTRYPOINT|ENV|ARG|ADD|LABEL|USER|VOLUME)\b/, '<span class="text-purple-600 dark:text-purple-400">$1</span>')

  // "done" at end of line
  s = s.replace(/\bdone$/, '<span class="text-green-600 dark:text-green-500">done</span>')

  // sha256 hashes — dim them
  s = s.replace(/(sha256:)([a-f0-9]+)/g, '<span class="text-gray-400 dark:text-gray-600">$1$2</span>')

  // Docker image references (e.g. docker.io/library/node:22-slim)
  s = s.replace(/(docker\.io\/[^\s@]+)/g, '<span class="text-blue-600 dark:text-blue-400">$1</span>')

  return s
}

// Poll for updates while deployment is in progress
const { stop } = usePoll(2000, {
  keepAlive: true,
  autoStart: isInProgress.value
})

// Stop polling when deployment completes
watch(isInProgress, (inProgress) => {
  if (!inProgress) stop()
})

// Auto-scroll log container when logs update
watch(allLogs, async () => {
  await nextTick()
  if (logContainer.value) {
    logContainer.value.scrollTop = logContainer.value.scrollHeight
  }
}, { immediate: true })

function statusBadge(status) {
  const map = {
    running: { label: 'Running', classes: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
    building: { label: 'Building', classes: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
    deploying: { label: 'Deploying', classes: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
    pending: { label: 'Pending', classes: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' },
    failed: { label: 'Failed', classes: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
    stopped: { label: 'Stopped', classes: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
    cancelled: { label: 'Cancelled', classes: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' }
  }
  return map[status] || { label: status, classes: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' }
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

// Rollback
const canRollback = computed(() =>
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
  if (slideProgress.value < 0.33) return 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
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
    const currentX = moveEvent.type === 'touchmove' ? moveEvent.touches[0].clientX : moveEvent.clientX
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

onBeforeUnmount(() => { if (cleanupSlide) cleanupSlide() })

function executeRollback() {
  rollingBack.value = true
  router.post(
    `/api/v1/projects/${props.project.slug}/environments/${props.environment.slug}/rollback`,
    { deploymentId: props.deployment.id },
    {
      onSuccess: (page) => {
        const newDeployment = page.props?.deployment
        if (newDeployment?.id) {
          router.visit(`/projects/${props.project.slug}/deployments/${newDeployment.id}`)
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
          <Link
            :href="`/projects/${project.slug}/environments/${environment.slug}`"
            class="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >
            {{ environment.name.toLowerCase() }}
          </Link>
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <span class="font-medium text-gray-900 dark:text-white">
            {{ deployment.id }}
          </span>
        </nav>
      </div>
    </div>

    <!-- Content -->
    <div class="flex flex-1 flex-col overflow-hidden px-4 py-6 sm:px-8 sm:py-8">
      <div class="mx-auto flex w-full max-w-5xl flex-1 flex-col overflow-hidden">
        <!-- Deployment Info -->
        <div class="mb-6 flex items-start justify-between">
          <div>
            <div class="flex items-center space-x-3">
              <h1 class="text-xl font-semibold text-gray-900 dark:text-white">Deployment</h1>
              <span :class="['inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium', statusBadge(deployment.status).classes]">
                {{ statusBadge(deployment.status).label }}
              </span>
              <span
                v-if="deployment.isCurrentDeployment"
                class="inline-flex items-center rounded-md bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand"
              >
                current
              </span>
              <span
                v-if="isInProgress"
                class="inline-flex items-center space-x-1 text-xs text-blue-600 dark:text-blue-400"
              >
                <svg class="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span>In progress</span>
              </span>
            </div>
          </div>
          <!-- Slide to Rollback -->
          <div
            v-if="canRollback"
            ref="slideTrack"
            class="relative h-10 w-56 select-none overflow-hidden rounded-full border border-gray-200 bg-gray-100 dark:border-gray-800 dark:bg-gray-900"
          >
            <!-- Track fill -->
            <div
              class="absolute inset-y-0 left-0"
              :class="[trackFill, { 'transition-[width] duration-300': !isSliding }]"
              :style="{ width: `${slideProgress * 100}%` }"
            ></div>

            <!-- Label -->
            <span class="pointer-events-none absolute inset-0 flex items-center justify-center text-xs font-medium text-gray-400 dark:text-gray-500">
              {{ rollingBack ? 'Rolling back...' : slideProgress > 0.85 ? 'Release to confirm' : 'Slide to rollback' }}
            </span>

            <!-- Thumb -->
            <div
              class="absolute bottom-0.5 top-0.5 flex w-10 items-center justify-center rounded-full shadow-lg"
              :class="[
                rollingBack ? 'bg-red-500 text-white cursor-not-allowed' : thumbColor + ' cursor-grab active:cursor-grabbing',
                { 'transition-all duration-300 ease-out': !isSliding }
              ]"
              :style="{ left: `calc(${(1 - slideProgress) * 100}% - ${(1 - slideProgress) * 2.5}rem)` }"
              @mousedown.prevent="startSlide"
              @touchstart.prevent="startSlide"
            >
              <svg v-if="!rollingBack" class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
              </svg>
              <svg v-else class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            </div>
          </div>
        </div>

        <!-- Metadata -->
        <div class="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <dt class="text-xs text-gray-500 dark:text-gray-400">Triggered by</dt>
            <dd class="mt-1 text-sm text-gray-900 dark:text-white">
              {{ deployment.triggeredBy?.fullName || 'System' }}
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
              <span v-if="deployment.gitCommit" class="ml-1 font-mono text-xs text-gray-500">
                {{ deployment.gitCommit.slice(0, 7) }}
              </span>
            </dd>
          </div>
        </div>

        <!-- Log Viewer -->
        <div class="flex flex-1 flex-col overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
          <div class="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-2 dark:border-gray-800 dark:bg-gray-900">
            <span class="text-xs font-medium text-gray-500 dark:text-gray-400">Build &amp; Deploy Logs</span>
          </div>
          <div
            ref="logContainer"
            class="flex-1 overflow-y-auto bg-gray-50 p-4 font-mono text-xs leading-5 text-gray-700 dark:bg-gray-950 dark:text-gray-300"
          >
            <pre v-if="allLogs" class="whitespace-pre-wrap break-all" v-html="highlightedLogs"></pre>
            <div v-else-if="isInProgress" class="flex items-center space-x-2 text-gray-500">
              <svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span>Waiting for logs...</span>
            </div>
            <span v-else class="text-gray-500">No logs available.</span>
          </div>
        </div>
      </div>
    </div>

  </div>
</template>
