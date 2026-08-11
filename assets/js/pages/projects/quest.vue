<script setup>
import { Head, router, useForm } from '@inertiajs/vue3'
import { inject, ref, computed, nextTick, watch, onMounted } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'
import Breadcrumb from '@/components/Breadcrumb.vue'
import Tooltip from '@/components/Tooltip.vue'
import Spinner from '@/components/SlipwaySpinner.vue'
import { useQueryState } from '@/composables/useQueryState'
import { useEventSource } from '@/composables/sse'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  project: Object,
  environment: Object,
  hasQuestFeature: Boolean,
  questFeature: Object,
  appRunning: Boolean,
  jobs: Array,
  jobsError: String,
  jobHistory: {
    type: Array,
    default: () => []
  }
})

const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')

// Live-updating state: initialized from Inertia props, updated via SSE
const liveJobs = ref(props.jobs || [])
const liveHistory = ref(props.jobHistory || [])
const liveError = ref(props.jobsError)

// Local state for actions
const runningJob = ref(null)
const jobOutputs = ref({})
const pauseForm = useForm({})
const resumeForm = useForm({})
const logContainers = ref({})
const expandedRun = useQueryState('run', '')
const _initialRun =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('run')
if (_initialRun) expandedRun.value = _initialRun

onMounted(async () => {
  if (expandedRun.value) {
    await nextTick()
    await nextTick()
    const el = runLogContainers.value[Number(expandedRun.value)]
    if (el) el.scrollTop = el.scrollHeight
  }
})
const runLogContainers = ref({})

// Auto-scroll log output to bottom when content changes
watch(
  jobOutputs,
  async () => {
    await nextTick()
    for (const el of Object.values(logContainers.value)) {
      if (el) el.scrollTop = el.scrollHeight
    }
  },
  { deep: true }
)

// Expanded job (persisted via URL query param)
const expandedJob = useQueryState('job', '')
// Eagerly read URL param so the accordion is expanded on first render
// (useQueryState defers to onMounted which can race with SSE updates)
const _initialJob =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('job')
if (_initialJob) expandedJob.value = _initialJob

function toggleExpand(jobName) {
  expandedJob.value = expandedJob.value === jobName ? '' : jobName
  expandedRun.value = ''
}

async function toggleRun(idx) {
  expandedRun.value = expandedRun.value === idx ? '' : idx
  await nextTick()
  await nextTick()
  const el = runLogContainers.value[Number(idx)]
  if (el) el.scrollTop = el.scrollHeight
}

// SSE: stream live job state + history
const sseUrl = computed(() => {
  if (!props.hasQuestFeature || !props.appRunning) return null
  return `/api/v1/projects/${props.project.slug}${envPath()}/quest/stream`
})

const { connected } = useEventSource(sseUrl, {
  onMessage(msg) {
    if (msg.jobs) liveJobs.value = msg.jobs
    if (msg.jobHistory) liveHistory.value = msg.jobHistory
    if (msg.jobsError !== undefined) liveError.value = msg.jobsError
  }
})

// Aggregate stats computed from history
const stats = computed(() => {
  const history = liveHistory.value
  const now = Date.now()
  const oneDayAgo = now - 24 * 60 * 60 * 1000

  // Filter to completed/failed events only
  const runs = history.filter(
    (h) => h.event === 'completed' || h.event === 'failed'
  )
  const runs24h = runs.filter((h) => h.recordedAt >= oneDayAgo)

  const succeeded = runs24h.filter((h) => h.event === 'completed').length
  const failed = runs24h.filter((h) => h.event === 'failed').length
  const total = succeeded + failed
  const successRate = total > 0 ? Math.round((succeeded / total) * 100) : 100

  return { total, succeeded, failed, successRate }
})

// Per-job stats computed from history (single pass, cached by Vue)
const jobStatsMap = computed(() => {
  const map = {}
  for (const h of liveHistory.value) {
    if (h.event !== 'completed' && h.event !== 'failed') continue
    if (!map[h.jobName]) {
      map[h.jobName] = { lastRun: h, errors: 0, totalRuns: 0 }
    }
    map[h.jobName].totalRuns++
    if (h.event === 'failed') map[h.jobName].errors++
  }
  const result = {}
  for (const [name, s] of Object.entries(map)) {
    result[name] = {
      lastRunAt: s.lastRun.recordedAt,
      lastDuration: s.lastRun.duration,
      lastStatus: s.lastRun.event,
      lastError: s.lastRun.error,
      errorCount: s.errors,
      totalRuns: s.totalRuns
    }
  }
  return result
})

// Run history for the currently expanded job (computed, cached)
const expandedJobHistory = computed(() => {
  if (!expandedJob.value) return []
  return liveHistory.value
    .filter(
      (h) =>
        h.jobName === expandedJob.value &&
        (h.event === 'completed' || h.event === 'failed')
    )
    .slice(0, 20)
})

// Helpers
function timeAgo(timestamp) {
  if (!timestamp) return ''
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

function timeUntil(timestamp) {
  if (!timestamp) return ''
  const seconds = Math.floor((timestamp - Date.now()) / 1000)
  if (seconds < 0) return 'overdue'
  if (seconds < 60) return 'in <1m'
  if (seconds < 3600) return `in ${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `in ${Math.floor(seconds / 3600)}h`
  return `in ${Math.floor(seconds / 86400)}d`
}

function formatDuration(ms) {
  if (!ms && ms !== 0) return ''
  if (ms < 1) return '<1ms'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleDateString([], {
    month: 'short',
    day: 'numeric'
  })
}

function formatSchedule(job) {
  return job.schedule || 'manual'
}

function toggleJobPause(job) {
  if (job.paused) {
    resumeJob(job.name)
    return
  }

  pauseJob(job.name)
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]|\[\d+(?:;\d+)*m/g
function stripAnsi(text) {
  return text.replace(ANSI_RE, '')
}

function successRateColor(rate) {
  if (rate >= 95) return 'text-emerald-600 dark:text-emerald-400'
  if (rate >= 80) return 'text-yellow-600 dark:text-yellow-400'
  return 'text-red-600 dark:text-red-400'
}

// Job actions
function envPath() {
  return props.environment.slug !== 'production'
    ? `/environments/${props.environment.slug}`
    : ''
}

async function runJob(jobName) {
  runningJob.value = jobName
  jobOutputs.value[jobName] = { running: true, output: null }
  const startedAt = Date.now()

  try {
    const res = await fetch(
      `/api/v1/projects/${
        props.project.slug
      }${envPath()}/quest/jobs/${jobName}/run`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }
    )
    const data = await res.json()

    jobOutputs.value[jobName] = {
      running: false,
      output: {
        success: data.success,
        stdout: data.output || '',
        stderr: data.error || '',
        exitCode: data.exitCode
      }
    }

    // Inject into live history so stats + recent runs update immediately
    liveHistory.value = [
      {
        event: data.success ? 'completed' : 'failed',
        jobName,
        duration: Date.now() - startedAt,
        error: data.success ? null : data.error || 'Unknown error',
        stdout: data.output || null,
        stderr: data.success ? null : data.error || null,
        trigger: 'manual',
        recordedAt: Date.now()
      },
      ...liveHistory.value
    ]
  } catch (e) {
    jobOutputs.value[jobName] = {
      running: false,
      output: {
        success: false,
        stdout: '',
        stderr: e.message,
        exitCode: 1
      }
    }
  } finally {
    runningJob.value = null
  }
}

function dismissOutput(jobName) {
  delete jobOutputs.value[jobName]
}

function pauseJob(jobName) {
  pauseForm.post(
    `/projects/${props.project.slug}${envPath()}/quest/${jobName}/pause`,
    {
      preserveScroll: true
    }
  )
}

function resumeJob(jobName) {
  resumeForm.post(
    `/projects/${props.project.slug}${envPath()}/quest/${jobName}/resume`,
    {
      preserveScroll: true
    }
  )
}

function refresh() {
  router.reload({ only: ['jobs', 'jobsError', 'jobHistory'] })
}
</script>
<template>
  <Head :title="`Quest - ${project.name} | Slipway`"></Head>
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
            { label: 'quest' }
          ]"
        />
      </div>
      <div class="flex items-center space-x-4">
        <!-- SSE connection indicator -->
        <Tooltip
          :text="
            connected ? 'Live updates active' : 'Live updates disconnected'
          "
        >
          <span
            class="flex items-center space-x-1.5 text-xs"
            :class="
              connected
                ? 'text-emerald-500'
                : 'text-gray-400 dark:text-gray-500'
            "
          >
            <span class="relative flex h-2 w-2">
              <span
                v-if="connected"
                class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"
              ></span>
              <span
                class="relative inline-flex h-2 w-2 rounded-full"
                :class="
                  connected ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'
                "
              ></span>
            </span>
            <span class="hidden sm:inline">{{
              connected ? 'Live' : 'Offline'
            }}</span>
          </span>
        </Tooltip>
        <a
          href="https://docs.sailscasts.com/slipway/quest"
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
      <div class="mx-auto max-w-4xl">
        <!-- Header -->
        <div class="mb-8">
          <h1 class="text-xl font-semibold text-gray-900 dark:text-white">
            Quest
          </h1>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Manage scheduled jobs running in your application.
          </p>
        </div>

        <!-- Feature not available -->
        <div
          v-if="!hasQuestFeature"
          class="rounded-lg border border-dashed border-gray-300 px-6 py-12 text-center dark:border-gray-700"
        >
          <svg
            class="mx-auto h-10 w-10 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.5"
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <h3 class="mt-4 text-sm font-medium text-gray-900 dark:text-white">
            sails-hook-quest not detected
          </h3>
          <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Deploy your app with
            <code
              class="rounded bg-gray-100 px-1.5 py-0.5 text-xs dark:bg-gray-800"
              >sails-hook-quest</code
            >
            installed to enable job scheduling.
          </p>
          <a
            href="https://docs.sailscasts.com/sails-quest"
            target="_blank"
            class="mt-4 inline-flex items-center space-x-1 text-sm text-amber-600 hover:text-amber-500 dark:text-amber-400"
          >
            <span>Learn more</span>
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

        <!-- App not running -->
        <div
          v-else-if="!appRunning"
          class="rounded-lg border border-dashed border-gray-300 px-6 py-12 text-center dark:border-gray-700"
        >
          <svg
            class="mx-auto h-10 w-10 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.5"
              d="M5.636 18.364a9 9 0 010-12.728m12.728 0a9 9 0 010 12.728m-9.9-2.829a5 5 0 010-7.07m7.072 0a5 5 0 010 7.07M13 12a1 1 0 11-2 0 1 1 0 012 0z"
            />
          </svg>
          <h3 class="mt-4 text-sm font-medium text-gray-900 dark:text-white">
            App not running
          </h3>
          <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Deploy your app to see and manage scheduled jobs.
          </p>
        </div>

        <!-- Error -->
        <div
          v-else-if="liveError"
          class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-900/50 dark:bg-red-950/20"
        >
          <p class="text-sm text-red-700 dark:text-red-400">{{ liveError }}</p>
          <button
            @click="refresh"
            class="mt-2 text-sm text-red-600 underline hover:text-red-500 dark:text-red-400"
          >
            Try again
          </button>
        </div>

        <!-- Jobs list -->
        <div v-else-if="liveJobs.length > 0" class="space-y-6">
          <!-- Aggregate stats bar -->
          <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div
              class="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950"
            >
              <div
                class="text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400"
              >
                Total runs (24h)
              </div>
              <div
                class="mt-1 text-2xl font-semibold text-gray-900 dark:text-white"
              >
                {{ stats.total }}
              </div>
            </div>
            <div
              class="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950"
            >
              <div
                class="text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400"
              >
                Succeeded
              </div>
              <div
                class="mt-1 text-2xl font-semibold text-emerald-600 dark:text-emerald-400"
              >
                {{ stats.succeeded }}
              </div>
            </div>
            <div
              class="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950"
            >
              <div
                class="text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400"
              >
                Failed
              </div>
              <div
                class="mt-1 text-2xl font-semibold"
                :class="
                  stats.failed > 0
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-gray-900 dark:text-white'
                "
              >
                {{ stats.failed }}
              </div>
            </div>
            <div
              class="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950"
            >
              <div
                class="text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400"
              >
                Success rate
              </div>
              <div
                class="mt-1 text-2xl font-semibold"
                :class="successRateColor(stats.successRate)"
              >
                {{ stats.successRate }}%
              </div>
            </div>
          </div>

          <!-- Job list header -->
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-medium text-gray-900 dark:text-white">
              Scripts
            </h2>
            <Tooltip text="Refresh">
              <button
                @click="refresh"
                class="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
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
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
              </button>
            </Tooltip>
          </div>

          <div
            class="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-950"
          >
            <div v-for="job in liveJobs" :key="job.name">
              <!-- Job row -->
              <div class="px-4 py-4">
                <div class="flex items-start justify-between">
                  <button
                    @click="toggleExpand(job.name)"
                    class="flex-1 text-left"
                  >
                    <div class="flex items-center space-x-3">
                      <h3
                        class="text-sm font-medium text-gray-900 dark:text-white"
                      >
                        {{ job.friendlyName }}
                      </h3>
                      <span
                        v-if="job.isRunning"
                        class="inline-flex rounded-md bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                      >
                        Running
                      </span>
                      <span
                        v-else-if="job.paused"
                        class="inline-flex rounded-md bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                      >
                        Paused
                      </span>
                      <span
                        v-if="job.withoutOverlapping"
                        class="inline-flex rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                      >
                        no overlap
                      </span>
                    </div>
                    <p
                      v-if="job.description"
                      class="mt-1 text-sm text-gray-500 dark:text-gray-400"
                    >
                      {{ job.description }}
                    </p>
                    <div
                      class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1"
                    >
                      <!-- Schedule -->
                      <div
                        class="flex items-center space-x-1 text-xs text-gray-400 dark:text-gray-500"
                      >
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
                            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                          />
                        </svg>
                        <span>{{ formatSchedule(job) }}</span>
                      </div>
                      <!-- Last run info -->
                      <template v-if="jobStatsMap[job.name]">
                        <span
                          class="text-xs"
                          :class="
                            jobStatsMap[job.name].lastStatus === 'completed'
                              ? 'text-gray-500 dark:text-gray-400'
                              : 'text-red-600 dark:text-red-400'
                          "
                        >
                          {{ timeAgo(jobStatsMap[job.name].lastRunAt) }}
                          <span class="text-gray-300 dark:text-gray-600"
                            >&middot;</span
                          >
                          {{
                            formatDuration(jobStatsMap[job.name].lastDuration)
                          }}
                          <span class="text-gray-300 dark:text-gray-600"
                            >&middot;</span
                          >
                          <template
                            v-if="
                              jobStatsMap[job.name].lastStatus === 'completed'
                            "
                            >&#10003;</template
                          >
                          <template v-else>&#10007; failed</template>
                        </span>
                      </template>
                      <!-- Next run -->
                      <span
                        v-if="job.nextRunAt"
                        class="text-xs text-gray-400 dark:text-gray-500"
                      >
                        Next: {{ timeUntil(job.nextRunAt) }}
                      </span>
                    </div>
                  </button>

                  <div class="ml-4 flex items-center space-x-1">
                    <!-- Run button -->
                    <Tooltip text="Run now">
                      <button
                        @click="runJob(job.name)"
                        :aria-label="
                          runningJob === job.name
                            ? `Running ${job.name}`
                            : `Run ${job.name} now`
                        "
                        :disabled="runningJob === job.name || job.isRunning"
                        class="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                      >
                        <Spinner
                          v-if="runningJob === job.name"
                          class="h-4 w-4"
                        />
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
                            d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                          />
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                          />
                        </svg>
                      </button>
                    </Tooltip>

                    <!-- Pause/Resume button -->
                    <template v-if="job.scheduleType !== 'manual'">
                      <Tooltip :text="job.paused ? 'Resume' : 'Pause'">
                        <button
                          @click="toggleJobPause(job)"
                          :disabled="
                            pauseForm.processing || resumeForm.processing
                          "
                          class="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                        >
                          <svg
                            v-if="job.paused"
                            class="h-4 w-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                              d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
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
                              d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"
                            />
                          </svg>
                        </button>
                      </Tooltip>
                    </template>
                  </div>
                </div>

                <!-- Inline output (from manual run) -->
                <div v-if="jobOutputs[job.name]" class="mt-4">
                  <div
                    class="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800"
                  >
                    <div
                      class="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-2 dark:border-gray-800 dark:bg-gray-900"
                    >
                      <div class="flex items-center space-x-2">
                        <span
                          v-if="jobOutputs[job.name].running"
                          class="flex items-center space-x-1 text-xs font-medium text-gray-500 dark:text-gray-400"
                        >
                          <Spinner class="h-3 w-3" />
                          <span>Running...</span>
                        </span>
                        <span
                          v-else-if="jobOutputs[job.name].output?.success"
                          class="text-xs font-medium text-emerald-600 dark:text-emerald-400"
                          >Completed</span
                        >
                        <span
                          v-else
                          class="text-xs font-medium text-red-600 dark:text-red-400"
                          >Failed (exit
                          {{ jobOutputs[job.name].output?.exitCode }})</span
                        >
                      </div>
                      <button
                        @click="dismissOutput(job.name)"
                        class="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
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
                            d="M6 18L18 6M6 6l12 12"
                          />
                        </svg>
                      </button>
                    </div>
                    <div
                      :ref="
                        (el) => {
                          if (el) logContainers[job.name] = el
                        }
                      "
                      class="h-80 overflow-y-auto bg-gray-100 p-4 font-mono text-xs leading-5 text-gray-700 dark:bg-gray-950 dark:text-gray-300"
                    >
                      <template v-if="jobOutputs[job.name].running">
                        <div
                          class="flex items-center space-x-2 text-gray-500 dark:text-gray-400"
                        >
                          <Spinner class="h-4 w-4" />
                          <span>Executing script...</span>
                        </div>
                      </template>
                      <template v-else-if="jobOutputs[job.name].output">
                        <pre
                          v-if="jobOutputs[job.name].output.stdout"
                          class="whitespace-pre-wrap break-all text-gray-700 dark:text-gray-300"
                          >{{
                            stripAnsi(jobOutputs[job.name].output.stdout)
                          }}</pre
                        >
                        <pre
                          v-if="
                            !jobOutputs[job.name].output.success &&
                            jobOutputs[job.name].output.stderr
                          "
                          class="whitespace-pre-wrap break-all text-red-600 dark:text-red-400"
                          :class="{
                            'mt-2': jobOutputs[job.name].output.stdout
                          }"
                          >{{
                            stripAnsi(jobOutputs[job.name].output.stderr)
                          }}</pre
                        >
                        <div
                          v-if="
                            !jobOutputs[job.name].output.stdout &&
                            !jobOutputs[job.name].output.stderr
                          "
                          class="text-gray-500 dark:text-gray-400"
                        >
                          No output
                        </div>
                      </template>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Expanded run history -->
              <Transition
                enter-active-class="transition-all duration-200 ease-out"
                enter-from-class="max-h-0 opacity-0"
                enter-to-class="max-h-[600px] opacity-100"
                leave-active-class="transition-all duration-150 ease-in"
                leave-from-class="max-h-[600px] opacity-100"
                leave-to-class="max-h-0 opacity-0"
              >
                <div
                  v-if="expandedJob === job.name"
                  class="overflow-hidden border-t border-gray-100 dark:border-gray-800"
                >
                  <div class="px-4 py-4">
                    <h4
                      class="mb-3 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400"
                    >
                      Recent runs
                    </h4>

                    <div
                      v-if="expandedJobHistory.length === 0"
                      class="py-4 text-center text-sm text-gray-400 dark:text-gray-500"
                    >
                      No run history yet
                    </div>

                    <div v-else>
                      <div v-for="(run, idx) in expandedJobHistory" :key="idx">
                        <button
                          @click="toggleRun(String(idx))"
                          class="group flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-900/50"
                        >
                          <div class="flex items-center space-x-4">
                            <span
                              class="whitespace-nowrap text-xs text-gray-400 dark:text-gray-500"
                              >{{ formatDate(run.recordedAt) }}
                              {{ formatTime(run.recordedAt) }}</span
                            >
                            <span
                              class="whitespace-nowrap font-mono text-xs text-gray-600 dark:text-gray-300"
                              >{{ formatDuration(run.duration) }}</span
                            >
                            <span
                              v-if="run.trigger === 'manual'"
                              class="text-[10px] text-gray-400 dark:text-gray-500"
                              >manual</span
                            >
                          </div>
                          <Tooltip
                            :text="
                              run.event === 'completed'
                                ? 'Completed successfully'
                                : run.error || 'Failed'
                            "
                          >
                            <span
                              class="opacity-0 transition-opacity group-hover:opacity-100"
                              :class="
                                run.event === 'completed'
                                  ? 'text-gray-500 dark:text-gray-400'
                                  : 'text-red-600 dark:text-red-400'
                              "
                            >
                              <template v-if="run.event === 'completed'"
                                >&#10003;</template
                              >
                              <template v-else>&#10007;</template>
                            </span>
                          </Tooltip>
                        </button>
                        <div
                          v-if="
                            expandedRun === String(idx) &&
                            (run.stdout || run.stderr)
                          "
                        >
                          <div
                            :ref="
                              (el) => {
                                if (el) runLogContainers[idx] = el
                              }
                            "
                            class="max-h-60 overflow-y-auto bg-gray-100 p-4 font-mono text-xs leading-5 dark:bg-gray-950"
                          >
                            <pre
                              v-if="run.stdout"
                              class="whitespace-pre-wrap break-all text-gray-700 dark:text-gray-300"
                              >{{ stripAnsi(run.stdout) }}</pre
                            >
                            <pre
                              v-if="run.stderr"
                              class="whitespace-pre-wrap break-all text-red-600 dark:text-red-400"
                              :class="{ 'mt-2': run.stdout }"
                              >{{ stripAnsi(run.stderr) }}</pre
                            >
                          </div>
                        </div>
                        <div
                          v-else-if="
                            expandedRun === String(idx) &&
                            !run.stdout &&
                            !run.stderr
                          "
                          class="px-4 py-3 text-xs text-gray-400 dark:text-gray-500"
                        >
                          No output recorded
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </Transition>
            </div>
          </div>
        </div>

        <!-- Empty state -->
        <div
          v-else
          class="rounded-lg border border-dashed border-gray-300 px-6 py-12 text-center dark:border-gray-700"
        >
          <svg
            class="mx-auto h-10 w-10 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.5"
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <h3 class="mt-4 text-sm font-medium text-gray-900 dark:text-white">
            No scripts found
          </h3>
          <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Create scripts in your
            <code
              class="rounded bg-gray-100 px-1.5 py-0.5 text-xs dark:bg-gray-800"
              >scripts/</code
            >
            directory.
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
