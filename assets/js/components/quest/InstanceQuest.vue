<script setup>
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import QuestStatus from './QuestStatus.vue'
import InstanceQuestRun from './InstanceQuestRun.vue'
import ChevronRight from '@/components/ui/icons/ChevronRight.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import Button from '@/components/ui/button/Button.vue'
import Refresh from '@/components/ui/icons/Refresh.vue'
import Play from '@/components/ui/icons/Play.vue'
import RowActions from '@/components/ui/row-actions/RowActions.vue'

const props = defineProps({ csrf: String })
const data = ref({ jobs: [], runs: [], available: false })
const error = ref('')
const loading = ref(true)
const submitting = ref(false)
const expandedJobs = ref(new Set())
const expandedRuns = ref(new Set())
const review = ref(null)
const requestId = ref('')
let timer
let controller
let stopped = false
const runsByJob = computed(() => {
  const grouped = new Map()
  for (const run of data.value.runs) {
    if (!grouped.has(run.name)) grouped.set(run.name, [])
    grouped.get(run.name).push(run)
  }
  return grouped
})
function toggle(set, key) {
  if (set.has(key)) set.delete(key)
  else set.add(key)
}
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
    expandedJobs.value.add(value.run.name)
    expandedRuns.value.add(value.run.id)
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
        class="min-h-8 min-w-8 h-8 w-8 bg-transparent p-1 text-gray-500 hover:bg-gray-100 dark:bg-transparent dark:text-gray-400 dark:hover:bg-gray-800"
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
    <div v-else class="space-y-2">
      <article v-for="job in data.jobs" :key="job.name" :data-job="job.name">
        <div
          class="flex items-start gap-2 rounded-lg px-2 py-3 hover:bg-gray-50 dark:hover:bg-gray-900/50"
        >
          <button
            type="button"
            class="flex min-w-0 flex-1 items-start gap-2 text-left"
            :aria-label="`Runs for ${job.friendlyName || job.name}`"
            :aria-expanded="expandedJobs.has(job.name)"
            :aria-controls="`instance-runs-${job.name}`"
            @click="toggle(expandedJobs, job.name)"
          >
            <ChevronRight
              class="mt-0.5 h-4 w-4 shrink-0 text-gray-400 transition-transform motion-reduce:transition-none"
              :class="{ 'rotate-90': expandedJobs.has(job.name) }"
            />
            <div class="min-w-0 flex-1 space-y-1">
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
                <span class="text-xs text-gray-400"
                  >{{ runsByJob.get(job.name)?.length || 0 }}
                  {{
                    runsByJob.get(job.name)?.length === 1 ? 'run' : 'runs'
                  }}</span
                >
              </div>
              <p class="text-xs text-gray-500">{{ job.description }}</p>
              <p class="text-xs text-gray-500">
                <span class="font-mono">{{ schedule(job) }}</span> ·
                {{ job.schedule?.timezone || 'UTC' }}
                <span class="ml-2 inline-block"
                  >Next: {{ time(job.nextRunAt) }}</span
                >
              </p>
            </div>
          </button>
          <RowActions
            :id="`instance-job-actions-${job.name}`"
            :label="`Actions for ${job.friendlyName || job.name}`"
            :busy="submitting"
            class="shrink-0 text-gray-400 dark:text-gray-400"
          >
            <template #menu>
              <button
                type="button"
                :disabled="
                  !job.manualAllowed ||
                  submitting ||
                  job.cleanupEnabled === false
                "
                class="flex w-full items-center rounded px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-800"
                @click="ask(job)"
              >
                <Play class="mr-2 h-4 w-4" />Run now
              </button>
            </template>
          </RowActions>
        </div>
        <div
          v-if="expandedJobs.has(job.name)"
          :id="`instance-runs-${job.name}`"
          class="ml-3 space-y-1 pb-3 sm:ml-8"
          :aria-label="`Runs for ${job.friendlyName || job.name}`"
          role="region"
        >
          <p
            v-if="!runsByJob.get(job.name)?.length"
            class="px-3 py-3 text-xs text-gray-500"
          >
            No runs recorded yet. Scheduled and manual runs appear here.
          </p>
          <InstanceQuestRun
            v-for="item in runsByJob.get(job.name) || []"
            :key="item.id"
            :run="item"
            :expanded="expandedRuns.has(item.id)"
            :live-logs="data.liveLogs"
            @toggle="toggle(expandedRuns, item.id)"
          />
        </div>
      </article>
    </div>
    <ConfirmModal
      :show="Boolean(review)"
      :loading="submitting"
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
