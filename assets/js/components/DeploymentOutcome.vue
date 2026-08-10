<script setup>
import { computed } from 'vue'

const props = defineProps({
  deployment: {
    type: Object,
    required: true
  }
})

const presentation = computed(() => {
  const styles = {
    succeeded:
      'bg-gray-100 text-gray-700 ring-gray-500/15 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-400/20',
    'in-progress':
      'bg-blue-50 text-blue-700 ring-blue-600/15 dark:bg-blue-950/60 dark:text-blue-300 dark:ring-blue-400/20',
    failed:
      'bg-red-50 text-red-700 ring-red-600/15 dark:bg-red-950/60 dark:text-red-300 dark:ring-red-400/20',
    cancelled:
      'bg-gray-100 text-gray-600 ring-gray-500/15 dark:bg-gray-800 dark:text-gray-400 dark:ring-gray-400/20',
    neutral:
      'bg-gray-100 text-gray-600 ring-gray-500/15 dark:bg-gray-800 dark:text-gray-400 dark:ring-gray-400/20'
  }

  return {
    label: props.deployment.outcomeLabel || props.deployment.status,
    classes: styles[props.deployment.outcome] || styles.neutral
  }
})

const isCurrent = computed(
  () =>
    props.deployment.isCurrent === true ||
    props.deployment.isCurrentDeployment === true
)
</script>

<template>
  <span class="inline-flex shrink-0 items-center gap-1.5">
    <span
      data-test="deployment-outcome"
      :class="[
        'inline-flex h-5 items-center whitespace-nowrap rounded-[5px] px-1.5 text-[11px] font-medium leading-none ring-1 ring-inset',
        presentation.classes
      ]"
    >
      {{ presentation.label }}
    </span>
    <span
      v-if="isCurrent"
      data-test="current-deployment-marker"
      class="inline-flex items-center gap-1 text-[11px] font-medium leading-none text-emerald-700 dark:text-emerald-400"
    >
      <span
        aria-hidden="true"
        class="h-1.5 w-1.5 rounded-full bg-emerald-500"
      ></span>
      <span>Live</span>
      <span class="sr-only"> — currently serving traffic</span>
    </span>
  </span>
</template>
