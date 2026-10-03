<script setup>
import { Head, router, usePage } from '@inertiajs/vue3'
import {
  computed,
  defineAsyncComponent,
  inject,
  onBeforeUnmount,
  ref,
  watch
} from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'
import AppNavbarVersion from '@/components/AppNavbarVersion.vue'
import Breadcrumb from '@/components/ui/breadcrumb/Breadcrumb.vue'
import Tabs from '@/components/ui/tabs/Tabs.vue'
import Button from '@/components/ui/button/Button.vue'
import Input from '@/components/ui/input/Input.vue'
import Select from '@/components/ui/select/Select.vue'
import Tooltip from '@/components/ui/tooltip/Tooltip.vue'
import SidebarOpen from '@/components/ui/icons/SidebarOpen.vue'
import SidebarClose from '@/components/ui/icons/SidebarClose.vue'
import ExternalLink from '@/components/ui/icons/ExternalLink.vue'
import Refresh from '@/components/ui/icons/Refresh.vue'
import Play from '@/components/ui/icons/Play.vue'
import Pause from '@/components/ui/icons/Pause.vue'
import Clock from '@/components/ui/icons/Clock.vue'
import X from '@/components/ui/icons/X.vue'
import ChevronLeft from '@/components/ui/icons/ChevronLeft.vue'
import Spinner from '@/components/SlipwaySpinner.vue'
import QuestStatus from '@/components/quest/QuestStatus.vue'
import QuestRuns from '@/components/quest/QuestRuns.vue'
import { useQueryState } from '@/components/ui/durable-ui/useQueryState'
import { useEventSource } from '@/composables/sse'
import {
  normalizeQuestWorkspace,
  questJobState,
  mergeQuestRuns,
  questRunTime,
  questRelativeTime,
  questAbsoluteTime,
  questInputType,
  questInputMetadataAvailable,
  questOverlapLabel,
  createQuestHistoryLoader,
  questDueTimes,
  questSnapshotIsFresh,
  createQuestSnapshotAuthority
} from '@/lib/questWorkspace.mjs'

const QuestRunDetail = defineAsyncComponent(() =>
  import('@/components/quest/QuestRunDetail.vue')
)
const QuestRunDialog = defineAsyncComponent(() =>
  import('@/components/quest/QuestRunDialog.vue')
)

defineOptions({ layout: AppLayout })
const props = defineProps({
  project: Object,
  environment: Object,
  hasQuestFeature: Boolean,
  questFeature: Object,
  appRunning: Boolean,
  workspace: Object,
  jobs: Array,
  jobsError: String,
  jobHistory: { type: Array, default: () => [] }
})
const page = usePage()
const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')
const live = ref(normalizeQuestWorkspace(props.workspace, props))
const streamStale = ref(false)
const streamError = ref('')
const now = ref(Date.now())
const snapshotAuthorityFresh = ref(false)
const snapshotAuthority = createQuestSnapshotAuthority({
  onChange(value) {
    snapshotAuthorityFresh.value = value
    now.value = Date.now()
  }
})
snapshotAuthority.observe(live.value)
onBeforeUnmount(() => snapshotAuthority.dispose())
const timer = setInterval(() => {
  now.value = Date.now()
}, 15000)
onBeforeUnmount(() => clearInterval(timer))
const activeTab = useQueryState('view', 'jobs', {
  validate: (value) => ['jobs', 'runs'].includes(value)
})
const selectedJobName = useQueryState('job', '')
const selectedRunId = useQueryState('run', '')
// Telemetry identity is local-only; it must never masquerade as a run URL.
const selectedEventId = ref('')
const jobTab = ref('runs')
const search = ref('')
const stateFilter = ref('all')
const runStateFilter = ref('all')
const runJobFilter = ref('all')
const refreshing = ref(false)
const moreLoading = ref(false)
const moreError = ref('')
const historyExpanded = ref(false)
const jobHistoryReader = createQuestHistoryLoader()
const scopedJobHistory = ref({
  key: '',
  runs: [],
  legacyEvents: [],
  nextCursor: null,
  loaded: false,
  loading: false,
  error: ''
})
onBeforeUnmount(() => jobHistoryReader.cancel())
const actionError = ref('')
const changingSchedule = ref('')
const review = ref(null)
const reviewOpen = ref(false)
const runDetail = ref(null)
const envPath = computed(() =>
  props.environment.slug === 'production'
    ? ''
    : `/environments/${encodeURIComponent(props.environment.slug)}`
)
const apiUrl = computed(
  () =>
    `/api/v1/projects/${encodeURIComponent(props.project.slug)}${
      envPath.value
    }/quest`
)
const actionUrl = computed(
  () =>
    `/projects/${encodeURIComponent(props.project.slug)}${envPath.value}/quest`
)
const sseUrl = computed(() =>
  props.hasQuestFeature && props.appRunning ? `${apiUrl.value}/stream` : null
)
const { connected, connect, close } = useEventSource(sseUrl, {
  onMessage(message) {
    if (message.error) {
      streamStale.value = true
      streamError.value = message.error
      return
    }
    streamError.value = ''
    if (message.workspace) {
      applyWorkspace(message.workspace)
      streamStale.value = false
    } else if (message.jobs || message.jobHistory || message.jobsError) {
      applyWorkspace(null, message)
      streamStale.value = false
    }
  },
  onError() {
    streamStale.value = true
  }
})
function applyWorkspace(workspace, fallback = props) {
  // An SSE observation may arrive between display-clock ticks. Compare its
  // timestamp to receipt time, never to the prior tick's cached clock.
  now.value = Date.now()
  const next = normalizeQuestWorkspace(workspace, fallback)
  if (next.target.runtimeId === live.value.target.runtimeId) {
    next.runs = mergeQuestRuns(live.value.runs, next.runs)
    if (historyExpanded.value) next.nextCursor = live.value.nextCursor
    next.legacyEvents = mergeEvents(live.value.legacyEvents, next.legacyEvents)
  }
  if (next.target.runtimeId !== live.value.target.runtimeId)
    historyExpanded.value = false
  snapshotAuthority.observe(next)
  live.value = next
}
function mergeEvents(current, incoming) {
  const map = new Map(current.map((event) => [String(event.eventId), event]))
  for (const event of incoming) map.set(String(event.eventId), event)
  return [...map.values()]
}
watch(
  () => props.workspace,
  (workspace) => {
    applyWorkspace(workspace)
    streamStale.value = false
  }
)
watch(
  () => [props.jobs, props.jobHistory, props.jobsError],
  () => {
    if (!props.workspace) applyWorkspace(null)
  }
)
watch(sseUrl, (url) => {
  streamStale.value = true
  url ? connect() : close()
})
watch(selectedJobName, () => {
  selectedEventId.value = ''
  runDetail.value = null
})
watch(selectedRunId, (id) => {
  if (id) selectedEventId.value = ''
  runDetail.value = null
})
const snapshotFresh = computed(
  () =>
    snapshotAuthorityFresh.value && questSnapshotIsFresh(live.value, now.value)
)
const fresh = computed(
  () => props.appRunning && !streamStale.value && snapshotFresh.value
)
const jobs = computed(() => live.value.jobs)
const selectedJob = computed(() =>
  jobs.value.find((job) => job.name === selectedJobName.value)
)
const state = (job) => questJobState(job, live.value, fresh.value)
const inputMetadataAvailable = computed(() =>
  questInputMetadataAvailable(selectedJob.value, live.value)
)
const selectedScheduleTimes = computed(() =>
  questDueTimes(selectedJob.value?.nextRunAt, selectedJob.value?.timezone)
)
const scheduleLabel = (job) =>
  job.scheduleType === 'unavailable' ? 'Unavailable' : job.schedule || 'Manual'
const canInvoke = (job) =>
  fresh.value &&
  questSnapshotIsFresh(live.value) &&
  live.value.capabilities.invoke &&
  !!live.value.target.runtimeId &&
  !!job?.metadataVersion &&
  job.paused === false &&
  typeof job.isRunning === 'boolean' &&
  !job.validationErrors?.length &&
  !(job.withoutOverlapping && job.isRunning) &&
  questInputMetadataAvailable(job, live.value)
const runDisabledReason = (job) =>
  !fresh.value
    ? 'Live runtime unavailable'
    : job?.paused === null || job?.isRunning == null
    ? 'Live job state unavailable'
    : job?.paused
    ? 'Resume this schedule before running'
    : job?.validationErrors?.length
    ? 'Fix the job definition before running'
    : job?.withoutOverlapping && job?.isRunning
    ? 'An execution is already running'
    : !live.value.capabilities.invoke
    ? 'This runtime does not support manual runs'
    : !questInputMetadataAvailable(job, live.value)
    ? 'Input metadata unavailable'
    : !job?.metadataVersion
    ? 'Job metadata unavailable'
    : ''
const canPause = (job) =>
  fresh.value &&
  questSnapshotIsFresh(live.value) &&
  !!live.value.target.runtimeId &&
  !!job?.schedule &&
  job.schedule !== 'manual' &&
  (job.paused === true
    ? live.value.capabilities.resume
    : job.paused === false && live.value.capabilities.pause)
const counts = computed(() => ({
  running: jobs.value.filter((job) => state(job) === 'running').length,
  paused: jobs.value.filter((job) => state(job) === 'paused').length
}))
const lastActivity = computed(() => {
  const result = {}
  for (const entry of [
    ...live.value.runs,
    ...live.value.legacyEvents.map((event) => ({
      ...event,
      state: event.event,
      legacy: true
    }))
  ].sort((a, b) => questRunTime(b) - questRunTime(a)))
    if (!result[entry.jobName]) result[entry.jobName] = entry
  return result
})
const filteredJobs = computed(() =>
  jobs.value.filter((job) => {
    const matchesSearch = `${job.name} ${job.friendlyName || ''} ${
      job.description || ''
    }`
      .toLowerCase()
      .includes(search.value.toLowerCase())
    const matchesState =
      stateFilter.value === 'all' ||
      (stateFilter.value === 'failed'
        ? lastActivity.value[job.name]?.state === 'failed'
        : state(job) === stateFilter.value)
    return matchesSearch && matchesState
  })
)
const filteredRuns = computed(() =>
  live.value.runs.filter(
    (run) =>
      (runJobFilter.value === 'all' || run.jobName === runJobFilter.value) &&
      (runStateFilter.value === 'all' || run.state === runStateFilter.value)
  )
)
const filteredEvents = computed(() =>
  live.value.legacyEvents.filter(
    (event) =>
      (runJobFilter.value === 'all' || event.jobName === runJobFilter.value) &&
      (runStateFilter.value === 'all' || event.event === runStateFilter.value)
  )
)
const selectedHistoryKey = computed(
  () =>
    `${apiUrl.value}:${live.value.target.appId || ''}:${selectedJobName.value}`
)
const jobRuns = computed(() =>
  mergeQuestRuns(
    scopedJobHistory.value.key === selectedHistoryKey.value
      ? scopedJobHistory.value.runs
      : [],
    live.value.runs.filter((run) => run.jobName === selectedJobName.value)
  )
)
const jobEvents = computed(() =>
  mergeEvents(
    scopedJobHistory.value.key === selectedHistoryKey.value
      ? scopedJobHistory.value.legacyEvents
      : [],
    live.value.legacyEvents.filter(
      (event) => event.jobName === selectedJobName.value
    )
  )
)
watch(
  () => [
    selectedHistoryKey.value,
    activeTab.value,
    jobTab.value,
    selectedJob.value?.name
  ],
  () => {
    if (scopedJobHistory.value.key !== selectedHistoryKey.value) {
      jobHistoryReader.cancel()
      scopedJobHistory.value = {
        key: selectedHistoryKey.value,
        runs: [],
        legacyEvents: [],
        nextCursor: null,
        loaded: false,
        loading: false,
        error: ''
      }
    }
    if (
      activeTab.value !== 'jobs' ||
      jobTab.value !== 'runs' ||
      !selectedJob.value
    ) {
      jobHistoryReader.cancel()
      scopedJobHistory.value.loading = false
      return
    }
    if (!scopedJobHistory.value.loaded && !scopedJobHistory.value.loading)
      loadJobHistory()
  },
  { immediate: true }
)
async function loadJobHistory(more = false) {
  if (
    !selectedJob.value ||
    scopedJobHistory.value.loading ||
    (more && !scopedJobHistory.value.nextCursor)
  )
    return
  const state = scopedJobHistory.value
  const jobName = selectedJobName.value
  state.loading = true
  state.error = ''
  const params = new URLSearchParams({ job: jobName })
  if (more) params.set('cursor', state.nextCursor)
  const result = await jobHistoryReader.load(`${apiUrl.value}/runs?${params}`)
  if (
    result.stale ||
    state !== scopedJobHistory.value ||
    state.key !== selectedHistoryKey.value
  )
    return
  state.loading = false
  if (result.error) {
    state.error = result.error
    return
  }
  state.runs = mergeQuestRuns(
    more ? state.runs : [],
    result.data.runs.filter((run) => run.jobName === jobName)
  )
  state.legacyEvents = mergeEvents(
    more ? state.legacyEvents : [],
    result.data.legacyEvents.filter((event) => event.jobName === jobName)
  )
  state.nextCursor = result.data.nextCursor || null
  state.loaded = true
}
const selectedSummary = computed(() =>
  live.value.runs.find((run) => run.runId === selectedRunId.value)
)
const detailRevision = computed(() =>
  selectedSummary.value
    ? `${selectedSummary.value.state}:${
        selectedSummary.value.finishedAt || ''
      }:${selectedSummary.value.resultStatus || ''}`
    : ''
)
const selectedRunJob = computed(
  () =>
    jobs.value.find(
      (job) =>
        job.name ===
        (selectedSummary.value?.jobName || runDetail.value?.jobName)
    ) || selectedJob.value
)
const reviewStale = computed(
  () =>
    !!review.value &&
    (!canInvoke(jobs.value.find((job) => job.name === review.value.job.name)) ||
      live.value.target.runtimeId !== review.value.target.runtimeId ||
      jobs.value.find((job) => job.name === review.value.job.name)
        ?.metadataVersion !== review.value.job.metadataVersion)
)
const tabClass = (current, value) => [
  'border-b-2 py-3 text-sm font-medium',
  current === value
    ? 'border-gray-900 text-gray-900 dark:border-white dark:text-white'
    : 'border-transparent text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
]
const filterClass =
  'min-h-9 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300'
const jobFilterOptions = computed(() => [
  { label: 'All jobs', value: 'all' },
  ...jobs.value.map((job) => ({
    label: job.friendlyName || job.name,
    value: job.name
  }))
])
const displayValue = (value) =>
  value === undefined
    ? '—'
    : typeof value === 'string'
    ? JSON.stringify(value)
    : JSON.stringify(value)
function clearFilters() {
  search.value = ''
  stateFilter.value = 'all'
}
function chooseJob(job) {
  selectedRunId.value = ''
  selectedEventId.value = ''
  selectedJobName.value = job.name
  jobTab.value = 'runs'
}
function closeJob() {
  selectedRunId.value = ''
  selectedEventId.value = ''
  selectedJobName.value = ''
}
function chooseRun(run) {
  if (run.legacy) {
    selectedRunId.value = ''
    selectedEventId.value = String(run.eventId)
  } else {
    selectedEventId.value = ''
    selectedJobName.value = run.jobName
    selectedRunId.value = run.runId
  }
}
function onRunLoaded(run) {
  runDetail.value = run
  if (
    run.runId &&
    activeTab.value === 'jobs' &&
    jobs.value.some((job) => job.name === run.jobName) &&
    selectedJobName.value !== run.jobName
  )
    selectedJobName.value = run.jobName
}
function closeRun() {
  selectedRunId.value = ''
  selectedEventId.value = ''
  runDetail.value = null
}
function openRun(job, previous) {
  now.value = Date.now()
  if (!canInvoke(job)) return
  review.value = {
    job: JSON.parse(JSON.stringify(job)),
    target: {
      ...live.value.target,
      appName: live.value.target.appName || props.project.name,
      environmentName:
        live.value.target.environmentName || props.environment.name,
      isProduction:
        props.environment.isProduction === true ||
        props.environment.slug === 'production'
    },
    inputs: Object.fromEntries(
      Object.entries(previous?.inputs || {}).filter(
        ([name]) => !job.inputs?.find((input) => input.name === name)?.sensitive
      )
    ),
    priorRunId: previous?.runId
  }
  reviewOpen.value = true
}
function accepted(run) {
  live.value.runs = mergeQuestRuns(live.value.runs, [run])
  selectedJobName.value = run.jobName
  selectedRunId.value = run.runId
  selectedEventId.value = ''
  jobTab.value = 'runs'
}
async function togglePause(job) {
  now.value = Date.now()
  if (!canPause(job) || changingSchedule.value) return
  changingSchedule.value = job.name
  actionError.value = ''
  const operation = job.paused ? 'resume' : 'pause'
  try {
    const response = await fetch(
      `${actionUrl.value}/${encodeURIComponent(job.name)}/${operation}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': page.props._csrf || '',
          Accept: 'application/json'
        },
        body: JSON.stringify({ runtimeId: live.value.target.runtimeId })
      }
    )
    if (!response.ok)
      throw new Error(
        `Could not ${operation} this job (HTTP ${response.status}). Refresh to check its current state.`
      )
    const data = await response.json()
    if (!(data.workspace || data)?.version)
      throw new Error(
        'No updated schedule state was received. Refresh to check before trying again.'
      )
    applyWorkspace(data.workspace || data)
  } catch (failure) {
    actionError.value =
      failure.message ||
      'The schedule change is unconfirmed. Refresh to check before trying again.'
  } finally {
    changingSchedule.value = ''
  }
}
function refresh() {
  if (refreshing.value) return
  refreshing.value = true
  router.reload({
    only: [
      'workspace',
      'jobs',
      'jobsError',
      'jobHistory',
      'appRunning',
      'hasQuestFeature'
    ],
    preserveScroll: true,
    onFinish: () => {
      refreshing.value = false
      if (sseUrl.value && !connected.value) connect()
    }
  })
}
async function loadMore() {
  if (!live.value.nextCursor || moreLoading.value) return
  moreLoading.value = true
  moreError.value = ''
  try {
    const response = await fetch(
      `${apiUrl.value}/runs?cursor=${encodeURIComponent(live.value.nextCursor)}`
    )
    if (!response.ok)
      throw new Error(`Could not load more history (HTTP ${response.status}).`)
    const data = await response.json()
    live.value.runs = mergeQuestRuns(live.value.runs, data.runs || [])
    live.value.legacyEvents = mergeEvents(
      live.value.legacyEvents,
      data.legacyEvents || []
    )
    live.value.nextCursor = data.nextCursor || null
    historyExpanded.value = true
  } catch (failure) {
    moreError.value = failure.message
  } finally {
    moreLoading.value = false
  }
}
</script>

<template>
  <Head :title="`Quest - ${project.name} | Slipway`" />
  <div class="flex h-full flex-col">
    <div
      class="flex items-center justify-between gap-3 border-b border-gray-200 py-4 pl-4 pr-4 dark:border-gray-800 sm:pr-8"
    >
      <div class="flex min-w-0 items-center space-x-3">
        <button
          aria-label="Open navigation"
          class="rounded-md p-1 text-gray-500 dark:text-gray-400 md:hidden"
          @click="toggleMobileMenu"
        >
          <SidebarOpen class="h-5 w-5" stroke-width="1" />
        </button>
        <button
          aria-label="Toggle sidebar"
          class="hidden text-gray-400 dark:text-gray-500 md:block"
          @click="toggleSidebar"
        >
          <SidebarOpen
            v-if="sidebarCollapsed"
            class="h-5 w-5"
            stroke-width="1"
          /><SidebarClose v-else class="h-5 w-5" stroke-width="1" />
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
      <div class="flex items-center gap-4">
        <Tooltip
          :text="
            fresh && connected
              ? 'Live runtime updates active'
              : 'Live runtime state unavailable'
          "
          ><span
            data-test="quest-stream-status"
            role="status"
            class="flex items-center gap-1.5 text-xs"
            :class="fresh && connected ? 'text-emerald-500' : 'text-gray-400'"
            ><span
              class="h-1.5 w-1.5 rounded-full"
              :class="fresh && connected ? 'bg-emerald-500' : 'bg-gray-400'"
            /><span class="hidden sm:inline">{{
              fresh && connected
                ? 'Live'
                : streamError
                ? 'Unavailable'
                : streamStale
                ? 'Reconnecting'
                : live.mode === 'resident' && !snapshotFresh
                ? 'Stale'
                : 'Unavailable'
            }}</span></span
          ></Tooltip
        >
        <a
          href="https://docs.sailscasts.com/slipway/quest"
          target="_blank"
          rel="noopener noreferrer"
          class="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >Docs<ExternalLink class="h-3.5 w-3.5" stroke-width="2"
        /></a>
        <AppNavbarVersion />
      </div>
    </div>
    <main class="flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
      <div data-test="quest-workspace" class="mx-auto max-w-5xl">
        <div class="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 class="text-xl font-semibold text-gray-900 dark:text-white">
              Quest
            </h1>
            <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Jobs and their runs in {{ environment.name.toLowerCase() }}.
            </p>
          </div>
          <Tooltip text="Refresh workspace"
            ><Button
              aria-label="Refresh workspace"
              :disabled="refreshing"
              class="min-h-8 min-w-8 bg-transparent p-1.5 text-gray-400 hover:bg-gray-100 dark:bg-transparent dark:text-gray-500 dark:hover:bg-gray-800"
              @click="refresh"
              ><Refresh
                :class="['h-4 w-4', refreshing && 'animate-spin']"
                stroke-width="1.5" /></Button
          ></Tooltip>
        </div>
        <div
          v-if="!hasQuestFeature"
          class="rounded-lg border border-dashed border-gray-300 px-6 py-12 text-center dark:border-gray-700"
        >
          <Clock class="mx-auto h-8 w-8 text-gray-400" />
          <h2 class="mt-3 text-sm font-medium">
            sails-hook-quest not detected
          </h2>
          <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Deploy your app with sails-hook-quest installed to enable jobs.
          </p>
          <a
            href="https://docs.sailscasts.com/sails-quest"
            target="_blank"
            rel="noopener noreferrer"
            class="text-brand-600 dark:text-brand-400 mt-3 inline-block text-sm"
            >Learn more</a
          >
        </div>
        <template v-else>
          <div
            v-if="!appRunning || !fresh || live.reason"
            role="status"
            data-test="quest-runtime-unavailable"
            class="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md bg-gray-50 px-3 py-2.5 text-xs text-gray-600 dark:bg-gray-900 dark:text-gray-400"
          >
            <span>{{
              !appRunning
                ? 'App not running. Retained history is still available.'
                : streamError
                ? streamError
                : streamStale
                ? 'Reconnecting to the runtime. Controls are unavailable until live state returns.'
                : live.mode === 'resident' && !snapshotFresh
                ? 'Runtime state is stale or unavailable. Refresh to restore current controls.'
                : live.reason ||
                  (live.mode === 'legacy'
                    ? 'Live controls require a resident Quest runtime. Legacy history is still available.'
                    : 'Live runtime state is unavailable. Retained history is still available.')
            }}</span
            ><span
              v-if="live.observedAt"
              :title="questAbsoluteTime(live.observedAt)"
              >Observed {{ questRelativeTime(live.observedAt, now) }}</span
            >
          </div>
          <div
            v-if="actionError"
            role="alert"
            class="mb-4 rounded-md bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
          >
            {{ actionError }}
          </div>
          <Tabs v-model="activeTab" aria-label="Quest workspace">
            <div
              class="flex items-center justify-between gap-3 border-b border-gray-200 dark:border-gray-800"
            >
              <div data-slot="tabs-list" class="-mb-px flex gap-6">
                <button data-value="jobs" :class="tabClass(activeTab, 'jobs')">
                  Jobs
                  <span class="ml-1 text-xs font-normal text-gray-400">{{
                    jobs.length
                  }}</span></button
                ><button data-value="runs" :class="tabClass(activeTab, 'runs')">
                  Runs
                </button>
              </div>
              <div
                v-if="fresh"
                class="hidden gap-3 text-xs text-gray-500 dark:text-gray-400 sm:flex"
              >
                <span v-if="counts.running">{{ counts.running }} running</span
                ><span v-if="counts.paused">{{ counts.paused }} paused</span>
              </div>
            </div>
            <div data-slot="tab-panel" data-value="jobs" class="pt-4">
              <div
                :class="[
                  'mb-4 flex flex-wrap gap-2',
                  selectedJob && 'hidden lg:flex'
                ]"
              >
                <Input
                  v-model="search"
                  type="search"
                  aria-label="Search jobs"
                  placeholder="Search jobs…"
                  :class="[filterClass, 'sm:max-w-64 min-w-0 flex-1']"
                /><Select
                  v-model="stateFilter"
                  aria-label="Filter jobs by state"
                  :class="filterClass"
                  :options="[
                    { label: 'All states', value: 'all' },
                    { label: 'Running', value: 'running' },
                    { label: 'Paused', value: 'paused' },
                    { label: 'Scheduled', value: 'scheduled' },
                    { label: 'Manual', value: 'manual' },
                    { label: 'Last activity failed', value: 'failed' },
                    { label: 'Unavailable', value: 'unavailable' }
                  ]"
                />
              </div>
              <div
                :class="[
                  'grid items-start gap-5',
                  selectedJob &&
                    'lg:grid-cols-[minmax(230px,0.8fr)_minmax(0,1.4fr)]'
                ]"
              >
                <div
                  data-test="quest-jobs-list"
                  :class="[
                    'min-w-0 overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950',
                    selectedJob && 'hidden lg:block'
                  ]"
                >
                  <div
                    v-if="!selectedJob && jobs.length"
                    class="hidden grid-cols-[minmax(0,1fr)_130px_150px_44px] gap-4 border-b border-gray-200 bg-gray-50/60 px-4 py-2 text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-900/30 dark:text-gray-400 sm:grid"
                  >
                    <span>Job</span><span>Schedule</span
                    ><span>Latest activity</span><span />
                  </div>
                  <div
                    v-for="job in filteredJobs"
                    :key="job.name"
                    data-test="quest-job-row"
                    :class="[
                      'group border-b border-gray-100 last:border-b-0 dark:border-gray-800',
                      selectedJobName === job.name &&
                        'bg-gray-50 dark:bg-gray-900/50'
                    ]"
                  >
                    <div
                      :class="[
                        'flex items-start gap-3 px-4 py-3.5',
                        !selectedJob &&
                          'sm:grid sm:grid-cols-[minmax(0,1fr)_130px_150px_44px] sm:items-center sm:gap-4'
                      ]"
                    >
                      <button
                        type="button"
                        :aria-label="`View ${job.friendlyName || job.name}`"
                        :aria-pressed="selectedJobName === job.name"
                        class="min-w-0 flex-1 text-left"
                        @click="chooseJob(job)"
                      >
                        <span
                          class="flex flex-wrap items-center gap-x-2 gap-y-1"
                          ><span
                            class="text-sm font-medium text-gray-900 dark:text-white"
                            >{{ job.friendlyName || job.name }}</span
                          ><QuestStatus
                            v-if="
                              ['running', 'paused', 'unavailable'].includes(
                                state(job)
                              )
                            "
                            :state="state(job)" /></span
                        ><span
                          v-if="job.description && !selectedJob"
                          class="mt-1 block truncate text-xs text-gray-500 dark:text-gray-400"
                          >{{ job.description }}</span
                        ><span
                          :class="[
                            'mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400',
                            !selectedJob && 'sm:hidden'
                          ]"
                          ><span>{{ scheduleLabel(job) }}</span
                          ><span v-if="fresh && job.nextRunAt && !job.paused"
                            >Next
                            {{ questRelativeTime(job.nextRunAt, now) }}</span
                          ></span
                        >
                      </button>
                      <div
                        v-if="!selectedJob"
                        class="hidden text-xs text-gray-600 dark:text-gray-400 sm:block"
                      >
                        <span>{{ scheduleLabel(job) }}</span
                        ><span
                          v-if="fresh && job.nextRunAt && !job.paused"
                          :title="questAbsoluteTime(job.nextRunAt)"
                          class="mt-1 block text-[11px] text-gray-400"
                          >Next
                          {{ questRelativeTime(job.nextRunAt, now) }}</span
                        >
                      </div>
                      <div v-if="!selectedJob" class="hidden text-xs sm:block">
                        <template v-if="lastActivity[job.name]"
                          ><QuestStatus
                            :state="lastActivity[job.name].state"
                          /><span class="mt-1 block text-[11px] text-gray-400"
                            >{{
                              questRelativeTime(
                                questRunTime(lastActivity[job.name]),
                                now
                              )
                            }}{{
                              lastActivity[job.name].legacy ? ' · Legacy' : ''
                            }}</span
                          ></template
                        ><span v-else class="text-gray-400">{{
                          live.nextCursor ? 'No activity loaded' : 'No runs yet'
                        }}</span>
                      </div>
                      <Tooltip :text="runDisabledReason(job) || 'Run job'"
                        ><Button
                          :aria-label="`Run ${job.friendlyName || job.name}`"
                          data-test="quest-open-run"
                          :disabled="!canInvoke(job)"
                          class="min-h-8 min-w-8 bg-transparent p-1.5 text-gray-500 hover:bg-gray-100 dark:bg-transparent dark:text-gray-400 dark:hover:bg-gray-800"
                          @click="openRun(job)"
                          ><Play
                            class="h-3.5 w-3.5"
                            stroke-width="1.5" /></Button
                      ></Tooltip>
                    </div>
                  </div>
                  <div
                    v-if="!filteredJobs.length"
                    class="px-5 py-12 text-center"
                  >
                    <p class="text-sm text-gray-500 dark:text-gray-400">
                      {{
                        jobs.length
                          ? 'No jobs match these filters.'
                          : 'No jobs found in this deployment.'
                      }}
                    </p>
                    <button
                      v-if="jobs.length"
                      type="button"
                      class="mt-2 text-xs underline"
                      @click="clearFilters"
                    >
                      Clear filters
                    </button>
                    <p v-else class="mt-2 text-xs text-gray-400">
                      Define jobs in your app’s source and deploy them here.
                    </p>
                  </div>
                </div>
                <section
                  v-if="selectedJob"
                  data-test="quest-job-detail"
                  class="min-w-0"
                  aria-labelledby="quest-job-title"
                >
                  <button
                    type="button"
                    class="mb-3 flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 lg:hidden"
                    @click="closeJob"
                  >
                    <ChevronLeft class="h-3.5 w-3.5" />All jobs
                  </button>
                  <div
                    class="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950"
                  >
                    <div class="px-4 pt-4">
                      <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0">
                          <h2
                            id="quest-job-title"
                            class="text-sm font-semibold text-gray-900 dark:text-white"
                          >
                            {{ selectedJob.friendlyName || selectedJob.name }}
                          </h2>
                          <p
                            class="mt-1 break-all font-mono text-[10px] text-gray-400"
                          >
                            {{ selectedJob.script || selectedJob.name }}
                          </p>
                        </div>
                        <button
                          type="button"
                          aria-label="Close job details"
                          class="rounded p-1 text-gray-400 hover:text-gray-900 dark:hover:text-white"
                          @click="closeJob"
                        >
                          <X class="h-4 w-4" />
                        </button>
                      </div>
                      <p
                        v-if="selectedJob.description"
                        class="mt-3 text-xs leading-5 text-gray-500 dark:text-gray-400"
                      >
                        {{ selectedJob.description }}
                      </p>
                      <div
                        class="mt-4 flex flex-wrap items-center justify-between gap-3"
                      >
                        <div class="flex items-center gap-2">
                          <QuestStatus :state="state(selectedJob)" /><span
                            v-if="selectedJob.withoutOverlapping"
                            class="text-[10px] text-gray-400"
                            >No overlap</span
                          >
                        </div>
                        <Tooltip
                          :text="runDisabledReason(selectedJob) || 'Run job'"
                          ><Button
                            data-test="quest-open-run"
                            :aria-label="`Run ${
                              selectedJob.friendlyName || selectedJob.name
                            }`"
                            :disabled="!canInvoke(selectedJob)"
                            class="min-h-8 px-2.5 py-1 text-xs"
                            @click="openRun(selectedJob)"
                            ><Play class="h-3 w-3" />Run job</Button
                          ></Tooltip
                        >
                      </div>
                      <p
                        v-if="selectedJob.validationErrors?.length"
                        role="alert"
                        class="mt-3 text-xs text-red-600 dark:text-red-400"
                      >
                        This job definition is invalid:
                        {{
                          selectedJob.validationErrors
                            .map((error) =>
                              typeof error === 'string' ? error : error.message
                            )
                            .join(' · ')
                        }}
                      </p>
                    </div>
                    <Tabs v-model="jobTab" aria-label="Job details">
                      <div
                        data-slot="tabs-list"
                        class="mt-2 flex gap-5 border-b border-gray-200 px-4 dark:border-gray-800"
                      >
                        <button
                          data-value="runs"
                          :class="tabClass(jobTab, 'runs')"
                        >
                          Runs</button
                        ><button
                          data-value="inputs"
                          :class="tabClass(jobTab, 'inputs')"
                        >
                          Inputs
                          <span
                            v-if="
                              inputMetadataAvailable &&
                              selectedJob.inputs?.length
                            "
                            class="ml-1 text-[10px] text-gray-400"
                            >{{ selectedJob.inputs.length }}</span
                          ></button
                        ><button
                          data-value="schedule"
                          :class="tabClass(jobTab, 'schedule')"
                        >
                          Schedule
                        </button>
                      </div>
                      <div data-slot="tab-panel" data-value="runs">
                        <template
                          v-if="activeTab === 'jobs' && jobTab === 'runs'"
                        >
                          <QuestRunDetail
                            v-if="selectedRunId || selectedEventId"
                            embedded
                            :api-url="apiUrl"
                            :run-id="selectedRunId"
                            :event-id="selectedEventId"
                            :revision="detailRevision"
                            :job="selectedRunJob"
                            :can-run="canInvoke(selectedRunJob)"
                            :can-cancel="live.capabilities.cancel"
                            @loaded="onRunLoaded"
                            @close="closeRun"
                            @run-again="openRun(selectedRunJob, $event)"
                          />
                          <template v-else>
                            <QuestRuns
                              :runs="jobRuns"
                              :legacy-events="jobEvents"
                              :jobs="jobs"
                              :selected-run="selectedRunId"
                              :selected-event="selectedEventId"
                              :now="now"
                              :empty-text="
                                scopedJobHistory.loading
                                  ? 'Loading history…'
                                  : scopedJobHistory.error
                                  ? 'History unavailable.'
                                  : scopedJobHistory.nextCursor
                                  ? 'No runs for this job in loaded history.'
                                  : 'No runs recorded yet.'
                              "
                              @select="chooseRun"
                            />
                            <p
                              class="border-t border-gray-100 px-4 py-2 text-[10px] text-gray-400 dark:border-gray-800"
                            >
                              {{ live.historyScope
                              }}{{
                                jobEvents.length
                                  ? ' · Legacy telemetry may be incomplete'
                                  : ''
                              }}{{
                                scopedJobHistory.nextCursor
                                  ? ' · Showing loaded history'
                                  : ''
                              }}
                            </p>
                            <div
                              v-if="
                                scopedJobHistory.nextCursor ||
                                scopedJobHistory.error
                              "
                              class="border-t border-gray-100 px-4 py-3 dark:border-gray-800"
                            >
                              <Button
                                v-if="scopedJobHistory.nextCursor"
                                :disabled="scopedJobHistory.loading"
                                class="min-h-8 border border-gray-200 bg-transparent px-3 py-1 text-xs text-gray-600 hover:bg-gray-100 dark:border-gray-800 dark:bg-transparent dark:text-gray-400 dark:hover:bg-gray-900"
                                @click="loadJobHistory(true)"
                                >{{
                                  scopedJobHistory.loading
                                    ? 'Loading…'
                                    : 'Load more history'
                                }}</Button
                              >
                              <p
                                v-if="scopedJobHistory.error"
                                role="alert"
                                class="mt-2 text-xs text-red-600 dark:text-red-400"
                              >
                                {{ scopedJobHistory.error }}
                                <button
                                  type="button"
                                  class="ml-1 underline"
                                  :disabled="scopedJobHistory.loading"
                                  @click="loadJobHistory()"
                                >
                                  Try again
                                </button>
                              </p>
                            </div>
                          </template>
                        </template>
                      </div>
                      <div
                        data-slot="tab-panel"
                        data-value="inputs"
                        class="divide-y divide-gray-100 dark:divide-gray-800"
                      >
                        <p
                          v-if="
                            !inputMetadataAvailable ||
                            !selectedJob.inputs?.length
                          "
                          class="px-4 py-8 text-sm text-gray-500 dark:text-gray-400"
                        >
                          {{
                            inputMetadataAvailable
                              ? 'This job takes no inputs.'
                              : 'Input metadata unavailable.'
                          }}
                        </p>
                        <div
                          v-for="input in inputMetadataAvailable
                            ? selectedJob.inputs
                            : []"
                          :key="input.name"
                          class="px-4 py-3"
                        >
                          <div class="flex flex-wrap items-center gap-2">
                            <span
                              class="font-mono text-xs text-gray-800 dark:text-gray-200"
                              >{{ input.name }}</span
                            ><span class="text-[10px] text-gray-400"
                              >{{ questInputType(input)
                              }}{{
                                input.required ? ' · required' : ' · optional'
                              }}{{
                                input.sensitive ? ' · sensitive' : ''
                              }}</span
                            >
                          </div>
                          <p
                            v-if="input.description"
                            class="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400"
                          >
                            {{ input.description }}
                          </p>
                          <p
                            v-if="
                              !input.sensitive &&
                              Object.prototype.hasOwnProperty.call(
                                input,
                                'defaultsTo'
                              )
                            "
                            class="mt-2 break-all font-mono text-[11px] text-gray-500 dark:text-gray-400"
                          >
                            Default: {{ displayValue(input.defaultsTo) }}
                          </p>
                          <p
                            v-if="!input.sensitive && input.isIn?.length"
                            class="mt-1 break-all text-[11px] text-gray-400"
                          >
                            Allowed:
                            {{ input.isIn.map(displayValue).join(', ') }}
                          </p>
                        </div>
                      </div>
                      <div
                        data-slot="tab-panel"
                        data-value="schedule"
                        class="p-4"
                      >
                        <dl
                          class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-3 text-xs"
                        >
                          <dt class="text-gray-400">Schedule</dt>
                          <dd class="text-gray-800 dark:text-gray-200">
                            {{
                              selectedJob.scheduleType === 'unavailable'
                                ? 'Unavailable'
                                : selectedJob.schedule || 'Manual only'
                            }}
                          </dd>
                          <dt
                            v-if="selectedJob.scheduleType"
                            class="text-gray-400"
                          >
                            Type
                          </dt>
                          <dd
                            v-if="selectedJob.scheduleType"
                            class="capitalize"
                          >
                            {{ selectedJob.scheduleType }}
                          </dd>
                          <dt v-if="selectedJob.schedule" class="text-gray-400">
                            Timezone
                          </dt>
                          <dd v-if="selectedJob.schedule">
                            {{
                              selectedScheduleTimes.runtimeZone ||
                              (selectedScheduleTimes.timezoneStatus ===
                              'invalid'
                                ? 'Invalid runtime timezone'
                                : 'Not reported by runtime')
                            }}
                          </dd>
                          <dt v-if="selectedJob.schedule" class="text-gray-400">
                            {{
                              selectedScheduleTimes.runtimeZone
                                ? 'Next run (runtime)'
                                : 'Next run (viewer)'
                            }}
                          </dt>
                          <dd v-if="selectedJob.schedule">
                            {{
                              !fresh
                                ? 'Unavailable'
                                : selectedJob.paused
                                ? 'Paused'
                                : selectedScheduleTimes.runtime ||
                                  selectedScheduleTimes.viewer ||
                                  'Not reported'
                            }}
                          </dd>
                          <template
                            v-if="
                              selectedJob.schedule &&
                              selectedScheduleTimes.runtimeZone &&
                              selectedScheduleTimes.viewer &&
                              fresh &&
                              !selectedJob.paused
                            "
                          >
                            <dt class="text-gray-400">Viewer time</dt>
                            <dd>{{ selectedScheduleTimes.viewer }}</dd>
                          </template>
                          <dt class="text-gray-400">Overlap</dt>
                          <dd>
                            {{ questOverlapLabel(selectedJob) }}
                          </dd>
                        </dl>
                        <p
                          v-if="
                            selectedJob.schedule &&
                            selectedJob.scheduledInputs == null
                          "
                          class="mt-4 text-xs text-gray-500 dark:text-gray-400"
                        >
                          Scheduled inputs: unavailable from this runtime.
                        </p>
                        <div
                          v-if="
                            selectedJob.scheduledInputs &&
                            Object.keys(selectedJob.scheduledInputs).length
                          "
                          class="mt-4"
                        >
                          <h3 class="text-xs text-gray-400">
                            Scheduled inputs
                          </h3>
                          <dl class="mt-2 space-y-1">
                            <div
                              v-for="(
                                value, name
                              ) in selectedJob.scheduledInputs"
                              :key="name"
                              class="flex gap-2 text-xs"
                            >
                              <dt class="font-mono text-gray-500">
                                {{ name }}
                              </dt>
                              <dd class="min-w-0 break-all font-mono">
                                {{
                                  selectedJob.inputs?.find(
                                    (input) => input.name === name
                                  )?.sensitive
                                    ? '••••••'
                                    : displayValue(value)
                                }}
                              </dd>
                            </div>
                          </dl>
                        </div>
                        <div
                          class="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-3 dark:border-gray-800"
                        >
                          <p class="text-[11px] text-gray-400">
                            Schedule defined in app source.
                          </p>
                          <Button
                            v-if="
                              selectedJob.schedule &&
                              selectedJob.schedule !== 'manual'
                            "
                            :disabled="
                              !canPause(selectedJob) || !!changingSchedule
                            "
                            class="min-h-8 border border-gray-200 bg-transparent px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:bg-transparent dark:text-gray-300 dark:hover:bg-gray-800"
                            @click="togglePause(selectedJob)"
                            ><Spinner
                              v-if="changingSchedule === selectedJob.name"
                              class="h-3 w-3"
                            /><Play
                              v-else-if="selectedJob.paused"
                              class="h-3 w-3"
                            /><Pause v-else class="h-3 w-3" />{{
                              selectedJob.paused
                                ? 'Resume schedule'
                                : 'Pause schedule'
                            }}</Button
                          >
                        </div>
                      </div>
                    </Tabs>
                  </div>
                </section>
                <div
                  v-else-if="selectedJobName"
                  role="status"
                  class="rounded-md border border-gray-200 p-4 text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400"
                >
                  This job is not present in the current deployment.
                  <button class="underline" type="button" @click="closeJob">
                    Clear selection
                  </button>
                </div>
              </div>
            </div>
            <div data-slot="tab-panel" data-value="runs" class="pt-4">
              <template v-if="activeTab === 'runs'">
                <QuestRunDetail
                  v-if="selectedRunId || selectedEventId"
                  :api-url="apiUrl"
                  :run-id="selectedRunId"
                  :event-id="selectedEventId"
                  :revision="detailRevision"
                  :job="selectedRunJob"
                  :can-run="canInvoke(selectedRunJob)"
                  :can-cancel="live.capabilities.cancel"
                  @loaded="onRunLoaded"
                  @close="closeRun"
                  @run-again="openRun(selectedRunJob, $event)"
                />
                <template v-else>
                  <div class="mb-4 flex flex-wrap items-center gap-2">
                    <Select
                      v-model="runJobFilter"
                      aria-label="Filter runs by job"
                      :class="[filterClass, 'max-w-64']"
                      :options="jobFilterOptions"
                    /><Select
                      v-model="runStateFilter"
                      aria-label="Filter runs by state"
                      :class="filterClass"
                      :options="[
                        { label: 'All states', value: 'all' },
                        { label: 'Running', value: 'running' },
                        { label: 'Accepted', value: 'accepted' },
                        { label: 'Requested', value: 'requested' },
                        { label: 'Unconfirmed', value: 'unconfirmed' },
                        { label: 'Completed', value: 'completed' },
                        { label: 'Failed', value: 'failed' },
                        { label: 'Interrupted', value: 'interrupted' }
                      ]"
                    /><span
                      data-test="quest-history-scope"
                      class="ml-auto text-xs text-gray-400"
                      >{{ live.historyScope
                      }}{{ live.nextCursor ? ' · Loaded history' : '' }}</span
                    >
                  </div>
                  <div
                    class="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800"
                  >
                    <QuestRuns
                      :runs="filteredRuns"
                      :legacy-events="filteredEvents"
                      :jobs="jobs"
                      show-job
                      :now="now"
                      :selected-run="selectedRunId"
                      :selected-event="selectedEventId"
                      :empty-text="
                        runJobFilter !== 'all' || runStateFilter !== 'all'
                          ? live.nextCursor
                            ? 'No runs match these filters in loaded history.'
                            : 'No runs match these filters.'
                          : 'No runs recorded yet.'
                      "
                      @select="chooseRun"
                    />
                  </div>
                  <div
                    class="mt-3 flex flex-wrap items-center justify-between gap-3"
                  >
                    <p
                      v-if="live.legacyEvents.length"
                      class="text-[11px] text-gray-400"
                    >
                      Legacy rows are telemetry events; correlated run details
                      may be unavailable.
                    </p>
                    <Button
                      v-if="live.nextCursor"
                      :disabled="moreLoading"
                      class="min-h-8 border border-gray-200 bg-transparent px-3 py-1 text-xs text-gray-600 hover:bg-gray-100 dark:border-gray-800 dark:bg-transparent dark:text-gray-400 dark:hover:bg-gray-900"
                      @click="loadMore"
                      >{{ moreLoading ? 'Loading…' : 'Load more' }}</Button
                    >
                  </div>
                  <p
                    v-if="moreError"
                    role="alert"
                    class="mt-2 text-xs text-red-600 dark:text-red-400"
                  >
                    {{ moreError }}
                  </p>
                </template>
              </template>
            </div>
          </Tabs>
          <QuestRunDetail
            v-if="activeTab === 'jobs' && !selectedJob && selectedRunId"
            class="mt-4"
            :api-url="apiUrl"
            :run-id="selectedRunId"
            :revision="detailRevision"
            :job="selectedRunJob"
            :can-run="canInvoke(selectedRunJob)"
            :can-cancel="live.capabilities.cancel"
            @loaded="onRunLoaded"
            @close="closeRun"
            @run-again="openRun(selectedRunJob, $event)"
          />
        </template>
      </div>
    </main>
    <QuestRunDialog
      v-if="review"
      v-model:open="reviewOpen"
      :review="review"
      :workspace="live"
      :stale="reviewStale"
      :api-url="apiUrl"
      :csrf="page.props._csrf || ''"
      @accepted="accepted"
    />
  </div>
</template>
