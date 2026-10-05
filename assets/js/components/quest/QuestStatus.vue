<script setup>
import { computed } from 'vue'
import Badge from '@/components/ui/badge/Badge.vue'
const props = defineProps({ state: String })
const label = computed(
  () =>
    ({
      requested: 'Requested',
      accepted: 'Accepted',
      unconfirmed: 'Unconfirmed',
      queued: 'Queued',
      running: 'Running',
      started: 'Started',
      start: 'Started',
      completed: 'Completed',
      succeeded: 'Completed',
      failed: 'Failed',
      cancelled: 'Cancelled',
      cancelling: 'Cancelling',
      interrupted: 'Interrupted',
      timed_out: 'Timed out',
      timeout: 'Timed out',
      skipped: 'Skipped',
      paused: 'Paused',
      scheduled: 'Scheduled',
      inactive: 'Inactive',
      manual: 'Manual',
      unavailable: 'Unavailable',
      loading: 'Loading',
      unknown: 'Unknown'
    }[props.state] ||
    props.state ||
    'Unknown')
)
const tone = computed(
  () =>
    ({
      requested:
        'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400',
      unconfirmed:
        'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
      running:
        'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400',
      accepted:
        'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400',
      queued: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400',
      completed:
        'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
      succeeded:
        'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
      failed: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400',
      paused:
        'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
      interrupted:
        'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400'
    }[props.state])
)
</script>
<template>
  <Badge :class="tone" class="rounded px-1.5 text-[11px] font-normal">{{
    label
  }}</Badge>
</template>
