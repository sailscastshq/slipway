<script setup>
import Button from '@/components/ui/button/Button.vue'
import Tooltip from '@/components/ui/tooltip/Tooltip.vue'
import Play from '@/components/ui/icons/Play.vue'
import QuestStatus from './QuestStatus.vue'
import { questScheduleLabel as scheduleLabel } from '@/lib/questSchedule.mjs'
import {
  questRunTime,
  questRelativeTime,
  questAbsoluteTime
} from '@/lib/questWorkspace.mjs'
defineProps({
  jobs: Array,
  filteredJobs: Array,
  selectedJobName: String,
  selectedJob: Object,
  fresh: Boolean,
  now: Number,
  lastActivity: Object,
  live: Object,
  state: Function,
  runDisabledReason: Function,
  canInvoke: Function,
  emptyText: { type: String, default: 'No jobs found in this deployment.' },
  emptyDescription: {
    type: String,
    default: 'Define jobs in your app’s source and deploy them here.'
  }
})
const emit = defineEmits(['choose-job', 'run', 'clear-filters'])
</script>
<template>
  <div
    data-test="quest-jobs-list"
    :class="['min-w-0', selectedJob && 'hidden lg:block']"
  >
    <div
      v-if="!selectedJob && jobs.length"
      class="hidden grid-cols-[minmax(0,1fr)_130px_150px_44px] gap-4 px-2 py-2 text-xs text-gray-500 dark:text-gray-400 sm:grid"
    >
      <span>Job</span><span>Schedule</span><span>Latest activity</span><span />
    </div>
    <div
      v-for="job in filteredJobs"
      :key="job.name"
      data-test="quest-job-row"
      :class="[
        'group rounded-md',
        selectedJobName === job.name && 'bg-gray-50 dark:bg-gray-900/50'
      ]"
    >
      <div
        :class="[
          'flex items-start gap-3 px-2 py-4',
          !selectedJob &&
            'sm:grid sm:grid-cols-[minmax(0,1fr)_130px_150px_44px] sm:items-center sm:gap-4'
        ]"
      >
        <button
          type="button"
          :aria-label="`View ${job.friendlyName || job.name}`"
          :aria-pressed="selectedJobName === job.name"
          class="min-w-0 flex-1 text-left"
          @click="emit('choose-job', job)"
        >
          <span class="flex flex-wrap items-center gap-x-2 gap-y-1"
            ><span class="text-sm font-medium text-gray-900 dark:text-white">{{
              job.friendlyName || job.name
            }}</span
            ><QuestStatus
              v-if="
                [
                  'running',
                  'paused',
                  'unavailable',
                  'loading',
                  'unknown'
                ].includes(state(job))
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
              >Next {{ questRelativeTime(job.nextRunAt, now) }}</span
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
            >Next {{ questRelativeTime(job.nextRunAt, now) }}</span
          >
        </div>
        <div v-if="!selectedJob" class="hidden text-xs sm:block">
          <template v-if="lastActivity[job.name]"
            ><QuestStatus :state="lastActivity[job.name].state" /><span
              class="mt-1 block text-[11px] text-gray-400"
              >{{ questRelativeTime(questRunTime(lastActivity[job.name]), now)
              }}{{ lastActivity[job.name].legacy ? ' · Legacy' : '' }}</span
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
            @click="emit('run', job)"
            ><Play class="h-3.5 w-3.5" stroke-width="1.5" /></Button
        ></Tooltip>
      </div>
    </div>
    <div v-if="!filteredJobs.length" class="px-5 py-12 text-center">
      <p class="text-sm text-gray-500 dark:text-gray-400">
        {{ jobs.length ? 'No jobs match these filters.' : emptyText }}
      </p>
      <button
        v-if="jobs.length"
        type="button"
        class="mt-2 text-xs underline"
        @click="emit('clear-filters')"
      >
        Clear filters
      </button>
      <p v-else class="mt-2 text-xs text-gray-400">
        {{ emptyDescription }}
      </p>
    </div>
  </div>
</template>
