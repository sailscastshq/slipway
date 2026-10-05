<script setup>
import { computed, ref, watch } from 'vue'
import ChevronDown from '@/components/ui/icons/ChevronDown.vue'

const props = defineProps({
  jobs: { type: Array, default: () => [] },
  fresh: Boolean,
  contextKey: String
})
const emit = defineEmits(['select-job'])
// A disclosure preference belongs to this mounted app workspace, never to
// another app or browser user. Stream updates do not reset it.
const expanded = ref(false)
watch(
  () => props.contextKey,
  () => {
    expanded.value = false
  }
)
const running = computed(() =>
  props.jobs.filter((job) => job.isRunning === true)
)
const incomplete = computed(
  () =>
    !props.fresh || props.jobs.some((job) => typeof job.isRunning !== 'boolean')
)
const label = computed(() =>
  !props.fresh
    ? 'Running activity unknown'
    : running.value.length
    ? `${running.value.length} ${
        running.value.length === 1 ? 'job' : 'jobs'
      } running${incomplete.value ? ' · activity incomplete' : ''}`
    : incomplete.value
    ? 'Running activity incomplete'
    : 'No jobs running'
)
</script>

<template>
  <section
    data-test="quest-running-jobs"
    aria-label="Running jobs"
    class="mb-6"
  >
    <button
      v-if="running.length || incomplete"
      type="button"
      :aria-expanded="expanded"
      aria-controls="quest-running-jobs-list"
      class="min-h-11 flex w-full items-center gap-2 py-1 text-left text-sm text-gray-700 dark:text-gray-300"
      @click="expanded = !expanded"
    >
      <span
        class="h-1.5 w-1.5 shrink-0 rounded-full"
        :class="fresh && running.length ? 'bg-emerald-500' : 'bg-gray-400'"
      />
      <span class="min-w-0 flex-1">{{ label }}</span>
      <ChevronDown
        class="h-4 w-4 text-gray-400"
        :class="expanded && 'rotate-180'"
      />
    </button>
    <p v-else class="py-1 text-xs text-gray-400 dark:text-gray-500">
      {{ label }}
    </p>
    <div
      v-show="expanded && (running.length || incomplete)"
      id="quest-running-jobs-list"
      class="mt-2"
    >
      <p v-if="!fresh" class="mb-2 text-xs text-gray-500 dark:text-gray-400">
        Last observed activity. Current state is unavailable.
      </p>
      <p
        v-else-if="incomplete"
        class="mb-2 text-xs text-gray-500 dark:text-gray-400"
      >
        Some jobs have not reported their running state.
      </p>
      <ul class="space-y-1">
        <li v-for="job in running" :key="job.name">
          <button
            type="button"
            class="min-h-11 flex w-full items-center justify-between gap-3 py-2 text-left text-sm text-gray-900 dark:text-white"
            @click="emit('select-job', job)"
          >
            <span class="min-w-0 truncate">{{
              job.friendlyName || job.name
            }}</span>
            <span class="shrink-0 text-xs text-gray-500 dark:text-gray-400"
              >{{ fresh ? 'Running' : 'Last observed running' }}
              <span aria-hidden="true">→</span></span
            >
          </button>
        </li>
      </ul>
      <p
        v-if="!running.length"
        class="py-2 text-xs text-gray-500 dark:text-gray-400"
      >
        No running jobs were reported in this snapshot.
      </p>
    </div>
  </section>
</template>
