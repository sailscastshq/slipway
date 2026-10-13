<script setup>
import { computed } from 'vue'
import SlippyLoader from '@/components/SlippyLoader.vue'

const props = defineProps({
  title: { type: String, required: true },
  description: String,
  error: Boolean,
  loading: Boolean
})
// Match ordinary success/error toasts and the deployment loading status.
const statusColor = computed(() =>
  props.error
    ? 'text-red-500 dark:text-red-400'
    : props.loading
    ? 'text-amber-600 dark:text-amber-400'
    : 'text-green-500 dark:text-green-400'
)
</script>

<template>
  <div
    :role="error ? 'alert' : 'status'"
    :data-slot="error ? 'alert' : undefined"
    class="min-h-56 flex flex-col items-center justify-center px-4 py-8 text-center"
    data-testid="dock-diff-state"
  >
    <SlippyLoader quiet class="mb-4 h-8 w-8 shrink-0" :class="statusColor" />
    <h3 class="text-sm font-medium" :class="statusColor">
      {{ title }}
    </h3>
    <p
      v-if="description"
      class="mt-1 max-w-sm break-words text-sm text-gray-600 dark:text-gray-400"
    >
      {{ description }}
    </p>
    <div v-if="$slots.default" class="mt-3"><slot /></div>
  </div>
</template>
