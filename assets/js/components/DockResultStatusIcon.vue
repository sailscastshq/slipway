<script setup>
import X from '@/components/ui/icons/X.vue'
import Check from '@/components/ui/icons/Check.vue'
import { computed } from 'vue'

const props = defineProps({
  status: {
    type: String,
    default: 'success'
  },
  contained: Boolean
})

const statusClasses = computed(() => {
  if (props.status === 'error') {
    return props.contained
      ? 'bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400'
      : 'text-red-500'
  }

  return props.contained
    ? 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400'
    : 'text-green-600 dark:text-green-400'
})
</script>

<template>
  <span
    :class="[
      'flex shrink-0 items-center justify-center',
      contained ? 'h-5 w-5 rounded-full' : 'h-3.5 w-3.5',
      statusClasses
    ]"
    aria-hidden="true"
  >
    <X
      v-if="status === 'error'"
      :class="contained ? 'h-3 w-3' : 'h-3.5 w-3.5'"
    />
    <Check v-else :class="contained ? 'h-3 w-3' : 'h-3.5 w-3.5'" />
  </span>
</template>
