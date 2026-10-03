<script setup>
import { computed } from 'vue'
import QuestStatus from './QuestStatus.vue'
import {
  formatQuestDuration,
  questRelativeTime,
  questAbsoluteTime,
  questRunTime
} from '@/lib/questWorkspace.mjs'
const props = defineProps({
  runs: { type: Array, default: () => [] },
  legacyEvents: { type: Array, default: () => [] },
  jobs: { type: Array, default: () => [] },
  selectedRun: String,
  selectedEvent: String,
  showJob: Boolean,
  emptyText: { type: String, default: 'No runs recorded yet.' },
  now: Number
})
const emit = defineEmits(['select'])
const entries = computed(() =>
  [
    ...props.runs.map((run) => ({ ...run, key: `run:${run.runId}` })),
    ...props.legacyEvents.map((event) => ({
      ...event,
      legacy: true,
      key: `event:${event.eventId}`,
      state: event.event
    }))
  ].sort((a, b) => questRunTime(b) - questRunTime(a))
)
const name = (entry) =>
  props.jobs.find((job) => job.name === entry.jobName)?.friendlyName ||
  entry.jobName
</script>
<template>
  <div
    data-test="quest-runs-list"
    class="divide-y divide-gray-100 dark:divide-gray-800"
  >
    <p
      v-if="!entries.length"
      class="px-4 py-10 text-center text-sm text-gray-500 dark:text-gray-400"
    >
      {{ emptyText }}
    </p>
    <button
      v-for="entry in entries"
      :key="entry.key"
      type="button"
      :data-test="entry.legacy ? 'quest-legacy-event' : 'quest-run-row'"
      :aria-label="`${entry.legacy ? 'Open legacy event' : 'Open run'}: ${name(
        entry
      )}, ${entry.state}`"
      :aria-pressed="
        entry.legacy
          ? selectedEvent === String(entry.eventId)
          : selectedRun === entry.runId
      "
      :class="[
        'flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-900/50',
        (entry.legacy
          ? selectedEvent === String(entry.eventId)
          : selectedRun === entry.runId) && 'bg-gray-50 dark:bg-gray-900/50'
      ]"
      @click="emit('select', entry)"
    >
      <QuestStatus :state="entry.state" />
      <span
        v-if="showJob"
        class="min-w-0 flex-1 truncate font-medium text-gray-900 dark:text-white"
        >{{ name(entry) }}</span
      >
      <span
        v-else
        class="min-w-0 flex-1 truncate text-xs text-gray-500 dark:text-gray-400"
        >{{
          entry.legacy
            ? 'Legacy event'
            : entry.trigger === 'scheduled' || entry.trigger === 'schedule'
            ? 'Scheduled'
            : entry.trigger === 'manual'
            ? 'Manual'
            : entry.trigger || 'Run'
        }}<span
          v-if="!entry.legacy"
          class="ml-2 font-mono text-[10px] text-gray-400"
          >{{ entry.runId?.slice(0, 8) }}</span
        ></span
      >
      <span v-if="entry.legacy && showJob" class="text-[10px] text-gray-400"
        >Legacy</span
      >
      <span class="text-xs tabular-nums text-gray-500 dark:text-gray-400">{{
        formatQuestDuration(entry.duration)
      }}</span>
      <time
        :datetime="
          questRunTime(entry)
            ? new Date(questRunTime(entry)).toISOString()
            : undefined
        "
        :title="questAbsoluteTime(questRunTime(entry))"
        class="text-xs tabular-nums text-gray-500 dark:text-gray-400"
        >{{ questRelativeTime(questRunTime(entry), now) }}</time
      >
    </button>
  </div>
</template>
