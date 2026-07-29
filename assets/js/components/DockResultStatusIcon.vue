<script setup>
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
    <svg
      v-if="status === 'error'"
      :class="contained ? 'h-3 w-3' : 'h-3.5 w-3.5'"
      viewBox="0 0 20 20"
      fill="currentColor"
    >
      <path
        d="M5.47 5.47a.75.75 0 011.06 0L10 8.94l3.47-3.47a.75.75 0 111.06 1.06L11.06 10l3.47 3.47a.75.75 0 11-1.06 1.06L10 11.06l-3.47 3.47a.75.75 0 01-1.06-1.06L8.94 10 5.47 6.53a.75.75 0 010-1.06z"
      />
    </svg>
    <svg
      v-else
      :class="contained ? 'h-3 w-3' : 'h-3.5 w-3.5'"
      viewBox="0 0 20 20"
      fill="currentColor"
    >
      <path
        fill-rule="evenodd"
        d="M16.704 4.153a.75.75 0 01.143 1.051l-7 9.5a.75.75 0 01-1.127.08l-4.5-4.5a.75.75 0 011.06-1.06l3.89 3.889 6.48-8.817a.75.75 0 011.054-.143z"
        clip-rule="evenodd"
      />
    </svg>
  </span>
</template>
