<script setup>
import SlippyLoader from '@/components/SlippyLoader.vue'

defineProps({
  title: { type: String, required: true },
  description: String,
  error: Boolean
})
</script>

<template>
  <div
    :role="error ? 'alert' : 'status'"
    class="min-h-56 flex flex-col items-center justify-center px-4 py-8 text-center"
    data-testid="dock-diff-state"
  >
    <SlippyLoader
      quiet
      class="mb-4 h-8 w-8 shrink-0 text-gray-500 dark:text-gray-400"
    />
    <h3
      class="text-sm font-medium"
      :class="
        error
          ? 'text-red-600 dark:text-red-400'
          : 'text-gray-950 dark:text-gray-100'
      "
    >
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
