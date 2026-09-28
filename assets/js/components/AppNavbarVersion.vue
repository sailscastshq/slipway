<script setup>
import { computed } from 'vue'
import { usePage } from '@inertiajs/vue3'
import Tooltip from '@/components/ui/tooltip/Tooltip.vue'

const page = usePage()
const version = computed(() => page.props.slipwayVersion)
</script>

<template>
  <Tooltip v-if="version" text="Slipway version" placement="bottom">
    <span
      tabindex="0"
      aria-label="Slipway version"
      data-test="slipway-version"
      class="shrink-0 rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400"
      >v{{ version }}</span
    >
  </Tooltip>
</template>
