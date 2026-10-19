<script setup>
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import QuestJobList from './QuestJobList.vue'
import QuestJobDetail from './QuestJobDetail.vue'
import QuestGlobalRuns from './QuestGlobalRuns.vue'
import QuestRunDetail from './QuestRunDetail.vue'
import QuestRunningJobs from './QuestRunningJobs.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import Button from '@/components/ui/button/Button.vue'
import Input from '@/components/ui/input/Input.vue'
import Tabs from '@/components/ui/tabs/Tabs.vue'
import BareSelect from '@/components/BareSelect.vue'
import Refresh from '@/components/ui/icons/Refresh.vue'
import { questJobState, questRunTime } from '@/lib/questWorkspace.mjs'

const props = defineProps({ csrf: String })
const apiUrl = '/api/v1/bosun/quest'
const data = ref({ jobs: [], runs: [], available: false })
const error = ref('')
const actionError = ref('')
const loading = ref(true)
const submitting = ref(false)
const review = ref(null)
const requestId = ref('')
const now = ref(Date.now())
const activeTab = ref('jobs')
const jobTab = ref('runs')
const search = ref('')
const stateFilter = ref('all')
const runJobFilter = ref('all')
const runStateFilter = ref('all')
const selectedJobName = ref('')
const selectedRunId = ref('')
let timer
let controller
let stopped = false
const live = computed(
  () =>
    data.value.workspace || {
      mode: 'unavailable',
      capabilities: {},
      jobs: [],
      runs: [],
      legacyEvents: [],
      nextCursor: null
    }
)
const fresh = computed(
  () =>
    data.value.available &&
    !error.value &&
    now.value - (live.value.observedAt || 0) < 10000
)
const jobs = computed(() => live.value.jobs)
const selectedJob = computed(() =>
  jobs.value.find((job) => job.name === selectedJobName.value)
)
const selectedSummary = computed(() =>
  live.value.runs.find((run) => run.runId === selectedRunId.value)
)
const selectedRunJob = computed(
  () =>
    jobs.value.find((job) => job.name === selectedSummary.value?.jobName) ||
    selectedJob.value
)
const detailRevision = computed(() => selectedSummary.value?.revision || '')
const jobRuns = computed(() =>
  live.value.runs.filter((run) => run.jobName === selectedJobName.value)
)
const lastActivity = computed(() => {
  const result = {}
  for (const run of [...live.value.runs].sort(
    (a, b) => questRunTime(b) - questRunTime(a)
  ))
    if (!result[run.jobName]) result[run.jobName] = run
  return result
})
const state = (job) => questJobState(job, live.value, fresh.value)
const filteredJobs = computed(() =>
  jobs.value.filter(
    (job) =>
      `${job.name} ${job.friendlyName || ''} ${job.description || ''}`
        .toLowerCase()
        .includes(search.value.toLowerCase()) &&
      (stateFilter.value === 'all' ||
        (stateFilter.value === 'failed'
          ? lastActivity.value[job.name]?.state === 'failed'
          : state(job) === stateFilter.value))
  )
)
const filteredRuns = computed(() =>
  live.value.runs.filter(
    (run) =>
      (runJobFilter.value === 'all' || run.jobName === runJobFilter.value) &&
      (runStateFilter.value === 'all' || run.state === runStateFilter.value)
  )
)
function runDisabledReason(job) {
  const current = jobs.value.find((item) => item.name === job?.name)
  if (!fresh.value)
    return 'Current instance state is unavailable. Refresh to retry.'
  if (!current?.manualAllowed)
    return 'Manual execution is unavailable for this job.'
  if (current.cleanupEnabled === false)
    return 'Cleanup removal is disabled in instance configuration.'
  if (current.isRunning && current.withoutOverlapping)
    return 'This job is already running.'
  return ''
}
const canInvoke = (job) => !submitting.value && !runDisabledReason(job)
function clearFilters() {
  search.value = ''
  stateFilter.value = 'all'
}
function chooseJob(job) {
  selectedJobName.value = job.name
  selectedRunId.value = ''
  jobTab.value = 'runs'
  activeTab.value = 'jobs'
}
function closeJob() {
  selectedJobName.value = ''
  selectedRunId.value = ''
}
function chooseRun(run) {
  selectedRunId.value = run.runId
  selectedJobName.value = run.jobName
}
async function refresh() {
  if (controller || stopped) return
  controller = new AbortController()
  try {
    const response = await fetch(apiUrl, {
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    })
    if (!response.ok)
      throw new Error('Could not load instance jobs. Refresh to retry.')
    const value = await response.json()
    if (stopped) return
    data.value = value
    error.value = value.error || ''
  } catch (failure) {
    if (!stopped) error.value = failure.message
  } finally {
    controller = null
    loading.value = false
  }
}
function ask(job) {
  if (!canInvoke(job)) return
  actionError.value = ''
  review.value = job
  requestId.value = crypto.randomUUID()
}
async function run() {
  if (!review.value || !canInvoke(review.value)) return
  submitting.value = true
  try {
    const response = await fetch(`${apiUrl}/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-CSRF-Token': props.csrf || ''
      },
      body: JSON.stringify({
        name: review.value.name,
        requestId: requestId.value,
        jobInputs: {}
      })
    })
    const value = await response.json()
    if (!response.ok)
      throw new Error(value.error || 'Job could not be started.')
    chooseJob(review.value)
    selectedRunId.value = value.run.id
    review.value = null
    await refresh()
  } catch (failure) {
    actionError.value = failure.message
  } finally {
    submitting.value = false
  }
}
onMounted(() => {
  refresh()
  timer = setInterval(() => {
    now.value = Date.now()
    if (!document.hidden) refresh()
  }, 2000)
})
onBeforeUnmount(() => {
  stopped = true
  clearInterval(timer)
  controller?.abort()
})
const tabClass = (current, value) => [
  'border-b-2 py-3 text-sm font-medium',
  current === value
    ? 'border-gray-900 text-gray-900 dark:border-white dark:text-white'
    : 'border-transparent text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
]
const filterClass =
  'focus:border-brand min-h-10 rounded-none border-0 border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-0 dark:border-gray-700 dark:text-white dark:placeholder-gray-500 dark:focus:border-brand'
</script>
<template>
  <section data-test="instance-quest" class="space-y-6">
    <div class="flex items-start justify-between gap-4">
      <div>
        <h2 class="text-base font-semibold text-gray-900 dark:text-white">
          Instance jobs
        </h2>
        <p class="mt-1 text-sm text-gray-500">
          Slipway’s own Quest jobs · schedules in UTC
        </p>
      </div>
      <Button
        class="min-h-8 min-w-8 h-8 w-8 bg-transparent p-1 text-gray-500 hover:bg-gray-100 dark:bg-transparent dark:text-gray-400 dark:hover:bg-gray-800"
        aria-label="Refresh instance jobs"
        @click="refresh"
        ><Refresh class="h-4 w-4"
      /></Button>
    </div>
    <p v-if="error" role="alert" class="text-sm text-red-600 dark:text-red-400">
      {{ error }}
    </p>
    <p
      v-if="actionError"
      role="alert"
      class="text-sm text-red-600 dark:text-red-400"
    >
      {{ actionError }}
    </p>
    <p v-if="loading" class="text-sm text-gray-500" role="status">
      Loading jobs…
    </p>
    <p v-else-if="!data.available" class="text-sm text-gray-500">
      The instance Quest runtime is unavailable. Retained history is still
      available.
    </p>
    <QuestRunningJobs
      :jobs="jobs"
      :fresh="fresh"
      context-key="instance"
      @select-job="chooseJob"
    />
    <Tabs
      v-model="activeTab"
      aria-label="Quest workspace"
      class="quest-workspace-tabs"
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
          />
          <BareSelect
            v-model="stateFilter"
            aria-label="Filter jobs by state"
            :class="filterClass"
            :options="[
              { label: 'All states', value: 'all' },
              { label: 'Running', value: 'running' },
              { label: 'Paused', value: 'paused' },
              { label: 'Scheduled', value: 'scheduled' },
              { label: 'Inactive', value: 'inactive' },
              { label: 'Manual', value: 'manual' },
              { label: 'Last activity failed', value: 'failed' },
              { label: 'Unavailable', value: 'unavailable' }
            ]"
          />
        </div>
        <div
          :class="[
            'grid items-start gap-6',
            selectedJob && 'lg:grid-cols-[minmax(220px,0.7fr)_minmax(0,1.5fr)]'
          ]"
        >
          <QuestJobList
            :jobs="jobs"
            :filtered-jobs="filteredJobs"
            :selected-job-name="selectedJobName"
            :selected-job="selectedJob"
            :fresh="fresh"
            :now="now"
            :last-activity="lastActivity"
            :live="live"
            :state="state"
            :run-disabled-reason="runDisabledReason"
            :can-invoke="canInvoke"
            empty-text="No instance jobs found."
            empty-description="Instance jobs are defined in Slipway’s source."
            @choose-job="chooseJob"
            @run="ask"
            @clear-filters="clearFilters"
          />
          <QuestJobDetail
            v-if="selectedJob && activeTab === 'jobs'"
            v-model:tab="jobTab"
            :csrf="csrf || ''"
            :selected-job="selectedJob"
            :selected-run-job="selectedRunJob"
            :jobs="jobs"
            :live="live"
            :active-tab="activeTab"
            :fresh="fresh"
            :job-state="state(selectedJob)"
            :disabled-reason="runDisabledReason(selectedJob)"
            :can-run="canInvoke(selectedJob)"
            :can-run-selected="canInvoke(selectedRunJob)"
            :can-pause="false"
            changing-schedule=""
            :selected-run-id="selectedRunId"
            selected-event-id=""
            :detail-revision="detailRevision"
            :api-url="apiUrl"
            :job-runs="jobRuns"
            :job-events="[]"
            :scoped-job-history="{
              loading: false,
              error: '',
              nextCursor: null
            }"
            :now="now"
            @close-job="closeJob"
            @run="ask(selectedJob)"
            @close-run="selectedRunId = ''"
            @run-again="ask(selectedRunJob)"
            @select-run="chooseRun"
          />
        </div>
      </div>
      <div data-slot="tab-panel" data-value="runs" class="pt-4">
        <template v-if="activeTab === 'runs'">
          <QuestRunDetail
            v-if="selectedRunId"
            :api-url="apiUrl"
            :run-id="selectedRunId"
            :revision="detailRevision"
            :job="selectedRunJob"
            :can-run="canInvoke(selectedRunJob)"
            :can-cancel="false"
            :can-live-logs="false"
            :csrf="csrf || ''"
            @close="selectedRunId = ''"
            @run-again="ask(selectedRunJob)"
          />
          <QuestGlobalRuns
            v-else
            v-model:job-filter="runJobFilter"
            v-model:state-filter="runStateFilter"
            :live="live"
            :jobs="jobs"
            :filtered-runs="filteredRuns"
            :filtered-events="[]"
            :selected-run-id="selectedRunId"
            selected-event-id=""
            :now="now"
            :more-loading="false"
            more-error=""
            @select-run="chooseRun"
          />
        </template>
      </div>
    </Tabs>
    <ConfirmModal
      :show="Boolean(review)"
      :loading="submitting"
      :confirm-disabled="!canInvoke(review)"
      :title="
        review?.name === 'retain-deployment-images'
          ? 'Clean up deployment images?'
          : review?.name === 'retain-build-cache'
          ? 'Clean up old build cache?'
          : `Run ${review?.friendlyName || review?.name || 'job'}?`
      "
      :message="
        review?.name === 'retain-deployment-images'
          ? 'Remove eligible old deployment images now, preserving container, deployment and recovery references. Cleanup runs in bounded batches; run again for a remaining backlog.'
          : review?.name === 'retain-build-cache'
          ? 'Remove only unused old build cache using the configured storage target. Deployment images and volumes are not pruned. Builds wait for this bounded maintenance run.'
          : 'This runs the instance job immediately with its existing configured defaults. It can perform operational work. Its regular schedule stays in place.'
      "
      :confirm-label="
        ['retain-deployment-images', 'retain-build-cache'].includes(
          review?.name
        )
          ? 'Clean up'
          : 'Run job'
      "
      @confirm="run"
      @cancel="review = null"
    />
  </section>
</template>
