<script setup>
import { computed } from 'vue'
import Select from '@/components/ui/select/Select.vue'
import Button from '@/components/ui/button/Button.vue'
import QuestRuns from './QuestRuns.vue'
const props = defineProps({
  live: Object,
  jobs: Array,
  filteredRuns: Array,
  filteredEvents: Array,
  selectedRunId: String,
  selectedEventId: String,
  now: Number,
  moreLoading: Boolean,
  moreError: String
})
const runJobFilter = defineModel('jobFilter', { type: String, required: true })
const runStateFilter = defineModel('stateFilter', {
  type: String,
  required: true
})
const emit = defineEmits(['select-run', 'load-more'])
const filterClass =
  'min-h-9 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300'
const jobFilterOptions = computed(() => [
  { label: 'All jobs', value: 'all' },
  ...props.jobs.map((job) => ({
    label: job.friendlyName || job.name,
    value: job.name
  }))
])
</script>
<template>
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
      @select="emit('select-run', $event)"
    />
  </div>
  <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
    <p v-if="live.legacyEvents.length" class="text-[11px] text-gray-400">
      Legacy rows are telemetry events; correlated run details may be
      unavailable.
    </p>
    <Button
      v-if="live.nextCursor"
      :disabled="moreLoading"
      class="min-h-8 border border-gray-200 bg-transparent px-3 py-1 text-xs text-gray-600 hover:bg-gray-100 dark:border-gray-800 dark:bg-transparent dark:text-gray-400 dark:hover:bg-gray-900"
      @click="emit('load-more')"
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
