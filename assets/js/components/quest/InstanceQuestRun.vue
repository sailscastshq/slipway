<script setup>
import { computed } from 'vue'
import ChevronRight from '@/components/ui/icons/ChevronRight.vue'
import LogViewer from '@/components/LogViewer.vue'
import QuestStatus from './QuestStatus.vue'
import QuestResult from './QuestResult.vue'

const props = defineProps({ run: Object, expanded: Boolean, liveLogs: Boolean })
defineEmits(['toggle'])
const active = computed(() =>
  ['requested', 'running', 'cancelling', 'unconfirmed'].includes(
    props.run.state
  )
)
const lines = computed(() =>
  [props.run.logs?.stdout, props.run.logs?.stderr]
    .filter(Boolean)
    .join('\n')
    .split('\n')
    .filter(Boolean)
)
const result = computed(() => {
  try {
    return JSON.parse(props.run.result || 'null')
  } catch {
    return { status: 'too_large' }
  }
})
function time(value) {
  return value ? new Date(value).toLocaleString() : '—'
}
</script>

<template>
  <div :data-run="run.id" class="min-w-0">
    <button
      type="button"
      class="flex w-full flex-wrap items-center gap-2 rounded px-3 py-2 text-left text-xs text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-900/50"
      :aria-expanded="expanded"
      :aria-controls="`instance-run-${run.id}`"
      :aria-label="`${run.trigger} run · ${time(run.startedAt)}`"
      @click="$emit('toggle')"
    >
      <ChevronRight
        class="h-3.5 w-3.5 shrink-0 transition-transform motion-reduce:transition-none"
        :class="{ 'rotate-90': expanded }"
      />
      <span class="capitalize">{{ run.trigger }}</span>
      <span>{{ time(run.startedAt) }}</span>
      <QuestStatus :state="run.state" />
    </button>
    <section
      v-if="expanded"
      :id="`instance-run-${run.id}`"
      class="space-y-3 px-3 pb-4 pt-2"
      aria-label="Instance run detail"
    >
      <p
        v-if="run.error || run.reason"
        class="text-sm text-red-600 dark:text-red-400"
      >
        {{ run.error || run.reason }}
      </p>
      <p v-if="!liveLogs && active" class="text-xs text-gray-500">
        Live output requires the Linux Quest child runtime. Retained output
        appears after completion.
      </p>
      <p v-if="run.logs?.truncated" class="text-xs text-gray-500">
        Showing the retained output tail.
      </p>
      <LogViewer
        :lines="lines"
        :connected="active && liveLogs"
        :complete="!active"
        :inactive-message="active && !liveLogs ? 'Waiting for completion' : ''"
      />
      <QuestResult :result="result" :pending="active" />
    </section>
  </div>
</template>
