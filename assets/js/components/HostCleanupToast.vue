<script setup>
import { computed } from 'vue'
import { Link } from '@inertiajs/vue3'
import Spinner from '@/components/SlipwaySpinner.vue'
import CheckCircle from '@/components/ui/icons/CheckCircle.vue'
import X from '@/components/ui/icons/X.vue'
const props = defineProps({ cleanup: Object })
defineEmits(['dismiss'])
const outcome = computed(() =>
  props.cleanup.run?.result?.status === 'available'
    ? props.cleanup.run.result.value
    : null
)
const phase = computed(() => {
  const state = props.cleanup.run?.state
  if (props.cleanup.refreshing) return 'refreshing'
  if (state === 'failed')
    return props.cleanup.progress?.phase === 'unconfirmed'
      ? 'unconfirmed'
      : 'failed'
  if (['unconfirmed', 'interrupted'].includes(state)) return 'unconfirmed'
  if (outcome.value?.status) return outcome.value.status
  if (
    ['requested', 'running', 'cancelling'].includes(state) &&
    props.cleanup.progress?.phase === 'complete'
  )
    return 'finalizing'
  return props.cleanup.progress?.phase || state
})
const busy = computed(() =>
  [
    'requested',
    'running',
    'checking',
    'pruning',
    'refreshing',
    'finalizing'
  ].includes(phase.value)
)
const title = computed(() =>
  props.cleanup.error
    ? 'Progress connection interrupted'
    : {
        requested: 'Cleanup requested',
        running: 'Cleanup running',
        checking: 'Checking disk cleanup',
        pruning: 'Pruning unused build cache',
        refreshing: 'Refreshing disk measurements',
        finalizing: 'Finishing cleanup',
        complete: 'Build cache cleanup complete',
        held: 'Cleanup held',
        'dry-run': 'Preview complete',
        failed: 'Build cache cleanup failed',
        unconfirmed: 'Cleanup outcome unconfirmed',
        interrupted: 'Cleanup outcome unconfirmed',
        skipped: 'Cleanup did not start'
      }[phase.value] || 'Cleanup outcome unconfirmed'
)
const description = computed(
  () =>
    props.cleanup.error ||
    props.cleanup.run?.error ||
    props.cleanup.progress?.error ||
    {
      requested: 'The registered job has not started yet.',
      running: 'Waiting for verified stage details from the cleanup worker.',
      complete:
        'Disk availability is a net measurement; Docker cache accounting can differ.',
      checking:
        'Verifying maintenance ownership, active work and cache policy.',
      pruning:
        'Docker is removing eligible unused cache. Deployment images and volumes stay intact.',
      finalizing:
        'Waiting for confirmed job completion and maintenance release.',
      refreshing:
        'Reading the actual host disk change and Docker cache accounting.',
      held: 'Another operation or safety check prevented cleanup. No retry is queued.',
      'dry-run':
        'Removal is disabled or this run was a preview. No cache was removed.',
      unconfirmed:
        'Inspect the daemon before retrying. The maintenance hold stays in place.',
      failed: 'Review the retained run before retrying.'
    }[phase.value] ||
    'The retained run contains the cleanup result.'
)
const bytes = (value) => {
  if (!Number.isFinite(value)) return 'Not measured'
  if (!value) return '0 B'
  const unit = Math.min(
    Math.max(0, Math.floor(Math.log(Math.abs(value)) / Math.log(1024))),
    4
  )
  return `${(value / 1024 ** unit).toFixed(1)} ${
    ['B', 'KiB', 'MiB', 'GiB', 'TiB'][unit]
  }`
}
const measured = computed(
  () =>
    outcome.value?.filesystemAvailableDeltaBytes ??
    props.cleanup.progress?.filesystemAvailableDeltaBytes
)
const reported = computed(
  () =>
    outcome.value?.dockerReportedReclaimed ||
    props.cleanup.progress?.dockerReportedReclaimed
)
</script>
<template>
  <div
    data-test="host-cleanup-toast"
    class="w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900"
  >
    <div
      class="h-1"
      :class="
        busy
          ? 'animate-pulse bg-gray-400 motion-reduce:animate-none'
          : phase === 'complete'
          ? 'bg-emerald-500'
          : 'bg-amber-500'
      "
    ></div>
    <div class="p-4">
      <div class="flex items-start gap-3">
        <Spinner
          v-if="busy"
          class="size-5 mt-0.5 shrink-0 text-gray-600 dark:text-white"
        />
        <CheckCircle
          v-else-if="phase === 'complete'"
          class="size-5 mt-0.5 shrink-0 text-emerald-500"
        />
        <X
          v-else
          class="size-5 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400"
        />
        <div class="min-w-0 flex-1">
          <p
            role="status"
            aria-live="polite"
            class="text-sm font-medium text-gray-900 dark:text-white"
          >
            {{ title }}
          </p>
          <p
            class="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400"
          >
            {{ description }}
          </p>
          <dl
            v-if="phase === 'complete'"
            class="mt-3 space-y-1 text-xs text-gray-600 dark:text-gray-300"
          >
            <div class="flex justify-between gap-3">
              <dt>Net disk available</dt>
              <dd class="font-medium">
                {{ measured > 0 ? '+' : '' }}{{ bytes(measured) }}
              </dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt>Docker reported</dt>
              <dd class="font-medium">{{ reported || 'Not reported' }}</dd>
            </div>
          </dl>
          <Link
            :href="`/lookout?cleanup=${cleanup.run.runId}`"
            class="mt-3 inline-block text-xs font-medium text-gray-900 underline underline-offset-2 dark:text-white"
            >View details</Link
          >
        </div>
        <button
          type="button"
          aria-label="Dismiss disk cleanup status"
          class="rounded p-0.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          @click="$emit('dismiss')"
        >
          <X class="size-4" />
        </button>
      </div>
    </div>
  </div>
</template>
