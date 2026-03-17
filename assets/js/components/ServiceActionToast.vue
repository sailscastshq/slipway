<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import SlippyLoader from '@/components/SlippyLoader.vue'

const props = defineProps({
  action: Object
})

const emit = defineEmits(['dismiss'])

const elapsed = ref(0)
let timerInterval = null

const actionLabel = computed(() => {
  if (props.action.status === 'in_progress') {
    const labels = {
      starting: 'Starting',
      stopping: 'Stopping',
      restarting: 'Restarting',
      creating: 'Creating'
    }
    return labels[props.action.action] || props.action.action
  }
  if (props.action.status === 'failed')
    return (
      'Failed to ' + props.action.action.replace('ing', '').replace('pp', 'p')
    )
  const labels = {
    starting: 'Started',
    stopping: 'Stopped',
    restarting: 'Restarted',
    creating: 'Created'
  }
  return labels[props.action.action] || 'Done'
})

const elapsedFormatted = computed(() => `${elapsed.value}s`)

function startTimer() {
  elapsed.value = Math.floor((Date.now() - props.action.startedAt) / 1000)
  timerInterval = setInterval(() => {
    elapsed.value = Math.floor((Date.now() - props.action.startedAt) / 1000)
  }, 1000)
}

function dismiss() {
  emit('dismiss', props.action.id)
}

onMounted(() => startTimer())
onUnmounted(() => {
  if (timerInterval) clearInterval(timerInterval)
})
</script>

<template>
  <div
    class="flex w-80 items-start space-x-3 rounded-lg border border-gray-200 bg-white p-4 shadow-lg dark:border-gray-700 dark:bg-gray-900"
  >
    <!-- Icon -->
    <div class="mt-0.5 shrink-0">
      <!-- Spinner for in progress -->
      <SlippyLoader v-if="action.status === 'in_progress'" class="text-brand" />
      <!-- Check for success -->
      <svg
        v-else-if="action.status === 'success'"
        class="h-5 w-5 text-green-500 dark:text-green-400"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M5 13l4 4L19 7"
        />
      </svg>
      <!-- X for failed -->
      <svg
        v-else
        class="h-5 w-5 text-red-500 dark:text-red-400"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M6 18L18 6M6 6l12 12"
        />
      </svg>
    </div>

    <!-- Content -->
    <div class="min-w-0 flex-1">
      <p class="text-sm text-gray-900 dark:text-white">
        <span class="font-medium">{{ actionLabel }}</span>
        {{ ' ' }}
        <span class="text-gray-500 dark:text-gray-400">{{
          action.serviceName
        }}</span>
      </p>
      <p class="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
        {{ action.serviceType }} · {{ elapsedFormatted }}
      </p>
    </div>

    <!-- Dismiss -->
    <button
      @click="dismiss"
      class="shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
    >
      <svg
        class="h-4 w-4"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M6 18L18 6M6 6l12 12"
        />
      </svg>
    </button>
  </div>
</template>
