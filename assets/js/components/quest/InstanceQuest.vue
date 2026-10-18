<script setup>
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import QuestStatus from './QuestStatus.vue'
import QuestResult from './QuestResult.vue'
import LogViewer from '@/components/LogViewer.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import Button from '@/components/ui/button/Button.vue'
import Select from '@/components/ui/select/Select.vue'
import Refresh from '@/components/ui/icons/Refresh.vue'
import Play from '@/components/ui/icons/Play.vue'

const props = defineProps({ csrf: String })
const data = ref({ jobs: [], runs: [], available: false })
const error = ref('')
const loading = ref(true)
const submitting = ref(false)
const selectedJob = ref('all')
const selectedId = ref('')
const review = ref(null)
const requestId = ref('')
let timer
let controller
let stopped = false
const options = computed(() => [
  { value: 'all', label: 'All jobs' },
  ...data.value.jobs.map((job) => ({
    value: job.name,
    label: job.friendlyName || job.name
  }))
])
const runs = computed(() =>
  data.value.runs.filter(
    (run) => selectedJob.value === 'all' || run.name === selectedJob.value
  )
)
const selected = computed(() =>
  data.value.runs.find((run) => run.id === selectedId.value)
)
const active = computed(() =>
  ['requested', 'running', 'cancelling', 'unconfirmed'].includes(
    selected.value?.state
  )
)
const lines = computed(() =>
  [selected.value?.logs?.stdout, selected.value?.logs?.stderr]
    .filter(Boolean)
    .join('\n')
    .split('\n')
    .filter(Boolean)
)
const result = computed(() => {
  try {
    return JSON.parse(selected.value?.result || 'null')
  } catch {
    return { status: 'too_large' }
  }
})
function time(value) {
  return value ? new Date(value).toLocaleString() : '—'
}
function schedule(job) {
  return job.schedule?.cron || job.schedule?.interval || 'Manual'
}
async function refresh() {
  if (controller || stopped) return
  controller = new AbortController()
  try {
    const response = await fetch('/api/v1/bosun/quest', {
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
  review.value = job
  requestId.value = crypto.randomUUID()
}
async function run() {
  if (submitting.value) return
  submitting.value = true
  try {
    const response = await fetch('/api/v1/bosun/quest/run', {
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
    selectedId.value = value.run.id
    review.value = null
    await refresh()
  } catch (failure) {
    error.value = failure.message
  } finally {
    submitting.value = false
  }
}
onMounted(() => {
  refresh()
  timer = setInterval(() => {
    if (!document.hidden) refresh()
  }, 2000)
})
onBeforeUnmount(() => {
  stopped = true
  clearInterval(timer)
  controller?.abort()
})
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
        variant="ghost"
        aria-label="Refresh instance jobs"
        @click="refresh"
        ><Refresh class="h-4 w-4"
      /></Button>
    </div>
    <p v-if="error" role="alert" class="text-sm text-red-600 dark:text-red-400">
      {{ error }}
    </p>
    <p v-if="loading" class="text-sm text-gray-500" role="status">
      Loading jobs…
    </p>
    <p v-else-if="!data.available" class="text-sm text-gray-500">
      The instance Quest runtime is unavailable.
    </p>
    <div
      v-else
      class="divide-y divide-gray-200 border-y border-gray-200 dark:divide-gray-800 dark:border-gray-800"
    >
      <article
        v-for="job in data.jobs"
        :key="job.name"
        class="flex items-start justify-between gap-4 py-4"
      >
        <div class="min-w-0 space-y-1">
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="text-sm font-medium text-gray-900 dark:text-white">
              {{ job.friendlyName || job.name }}
            </h3>
            <QuestStatus
              :state="
                job.runningCount
                  ? 'running'
                  : job.paused
                  ? 'paused'
                  : job.scheduled
                  ? 'scheduled'
                  : 'inactive'
              "
            />
          </div>
          <p class="text-xs text-gray-500">{{ job.description }}</p>
          <p class="text-xs text-gray-500">
            <span class="font-mono">{{ schedule(job) }}</span> ·
            {{ job.schedule?.timezone || 'UTC' }}
          </p>
          <p class="text-xs text-gray-500">Next: {{ time(job.nextRunAt) }}</p>
          <p
            v-if="job.name === 'retain-deployment-images'"
            class="text-xs text-gray-500"
          >
            Preview by default. Removal requires server configuration.
          </p>
        </div>
        <Button
          variant="outline"
          class="shrink-0"
          :disabled="!job.manualAllowed || submitting"
          :aria-label="`Run ${job.friendlyName || job.name}`"
          @click="ask(job)"
          ><Play class="h-3.5 w-3.5" />Run</Button
        >
      </article>
    </div>
    <div class="space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h3 class="text-sm font-medium text-gray-900 dark:text-white">
          Run history
        </h3>
        <div
          class="w-56 border-b border-dashed border-gray-300 dark:border-gray-700"
        >
          <Select
            v-model="selectedJob"
            :options="options"
            aria-label="Filter instance runs"
            class="border-0 bg-transparent shadow-none"
          />
        </div>
      </div>
      <p v-if="!runs.length" class="py-4 text-sm text-gray-500">
        No runs recorded yet. Scheduled and manual runs appear here.
      </p>
      <div v-else class="divide-y divide-gray-200 dark:divide-gray-800">
        <button
          v-for="item in runs"
          :key="item.id"
          class="flex w-full flex-wrap items-center justify-between gap-2 py-3 text-left text-xs text-gray-500 hover:text-gray-900 dark:hover:text-white"
          :aria-pressed="selectedId === item.id"
          @click="selectedId = item.id"
        >
          <span
            >{{ item.name
            }}<span class="ml-2"
              >{{ item.trigger }} · {{ time(item.startedAt) }}</span
            ></span
          ><QuestStatus :state="item.state" />
        </button>
      </div>
    </div>
    <section
      v-if="selected"
      class="space-y-4 border-t border-gray-200 pt-5 dark:border-gray-800"
      aria-label="Instance run detail"
    >
      <div class="flex flex-wrap items-center gap-2">
        <h3 class="text-sm font-medium text-gray-900 dark:text-white">
          {{ selected.name }}
        </h3>
        <QuestStatus :state="selected.state" />
      </div>
      <p
        v-if="selected.error || selected.reason"
        class="text-sm text-red-600 dark:text-red-400"
      >
        {{ selected.error || selected.reason }}
      </p>
      <p v-if="!data.liveLogs && active" class="text-xs text-gray-500">
        Live output requires the Linux Quest child runtime. Retained output
        appears after completion.
      </p>
      <p v-if="selected.logs?.truncated" class="text-xs text-gray-500">
        Showing the retained output tail.
      </p>
      <LogViewer
        :key="selected.id"
        :lines="lines"
        :connected="active && data.liveLogs"
        :complete="!active"
        :inactive-message="
          active && !data.liveLogs ? 'Waiting for completion' : ''
        "
      />
      <QuestResult :result="result" :pending="active" />
    </section>
    <ConfirmModal
      :show="Boolean(review)"
      :loading="submitting"
      :title="`Run ${review?.friendlyName || review?.name || 'job'}?`"
      message="This runs the instance job immediately with its existing configured defaults. It can perform operational work. Its regular schedule stays in place."
      confirm-label="Run job"
      @confirm="run"
      @cancel="review = null"
    />
  </section>
</template>
