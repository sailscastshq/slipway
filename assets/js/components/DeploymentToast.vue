<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { Link, router } from '@inertiajs/vue3'

const props = defineProps({
  deployment: Object
})

const emit = defineEmits(['complete', 'dismiss'])

const status = ref(props.deployment.status)
const startTime = ref(props.deployment.startedAt || Date.now())
const elapsed = ref(0)
const dismissed = ref(false)
const exiting = ref(false)
let eventSource = null
let timerInterval = null

const statusConfig = computed(() => {
  const configs = {
    pending: {
      label: 'Queued',
      color: 'text-gray-400',
      bgColor: 'bg-gray-500',
      icon: 'clock'
    },
    building: {
      label: 'Building',
      color: 'text-blue-400',
      bgColor: 'bg-blue-500',
      icon: 'building'
    },
    pushing: {
      label: 'Pushing',
      color: 'text-purple-400',
      bgColor: 'bg-purple-500',
      icon: 'upload'
    },
    deploying: {
      label: 'Deploying',
      color: 'text-amber-400',
      bgColor: 'bg-amber-500',
      icon: 'rocket'
    },
    running: {
      label: 'Deployed',
      color: 'text-emerald-400',
      bgColor: 'bg-emerald-500',
      icon: 'check'
    },
    failed: {
      label: 'Failed',
      color: 'text-red-400',
      bgColor: 'bg-red-500',
      icon: 'x'
    },
    cancelled: {
      label: 'Cancelled',
      color: 'text-gray-400',
      bgColor: 'bg-gray-500',
      icon: 'x'
    }
  }
  return configs[status.value] || configs.pending
})

const isActive = computed(() => {
  return ['pending', 'building', 'pushing', 'deploying'].includes(status.value)
})

const elapsedFormatted = computed(() => {
  const mins = Math.floor(elapsed.value / 60)
  const secs = elapsed.value % 60
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
})

function connectToStream() {
  if (eventSource) eventSource.close()

  eventSource = new EventSource(`/api/v1/deployments/${props.deployment.id}/stream`)

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data)
      if (data.status) {
        status.value = data.status

        // Deployment finished
        if (['running', 'failed', 'cancelled'].includes(data.status)) {
          eventSource.close()
          eventSource = null

          // Auto-dismiss after 5 seconds
          setTimeout(() => {
            dismiss()
          }, 5000)
        }
      }
    } catch (e) { /* ignore */ }
  }

  eventSource.onerror = () => {
    // Reconnect after 3 seconds if still active
    setTimeout(() => {
      if (isActive.value && !eventSource) {
        connectToStream()
      }
    }, 3000)
  }
}

function startTimer() {
  elapsed.value = Math.floor((Date.now() - startTime.value) / 1000)
  timerInterval = setInterval(() => {
    elapsed.value = Math.floor((Date.now() - startTime.value) / 1000)
  }, 1000)
}

function dismiss() {
  exiting.value = true
  setTimeout(() => {
    dismissed.value = true
    emit('dismiss', props.deployment.id)
  }, 300)
}

function goToDeployment() {
  router.visit(`/projects/${props.deployment.project.slug}/deployments/${props.deployment.id}`)
}

onMounted(() => {
  connectToStream()
  startTimer()
})

onUnmounted(() => {
  if (eventSource) eventSource.close()
  if (timerInterval) clearInterval(timerInterval)
})

watch(() => props.deployment.status, (newStatus) => {
  status.value = newStatus
})
</script>

<template>
  <Transition
    enter-active-class="transition ease-out duration-300"
    enter-from-class="translate-y-full opacity-0"
    enter-to-class="translate-y-0 opacity-100"
    leave-active-class="transition ease-in duration-200"
    leave-from-class="translate-y-0 opacity-100"
    leave-to-class="translate-y-full opacity-0"
  >
    <div
      v-if="!dismissed"
      :class="[
        'pointer-events-auto w-80 overflow-hidden rounded-xl border shadow-2xl backdrop-blur-sm transition-all',
        exiting ? 'translate-y-full opacity-0' : '',
        'border-gray-700/50 bg-gray-900/95'
      ]"
    >
      <!-- Progress bar at top -->
      <div class="h-0.5 w-full bg-gray-800">
        <div
          v-if="isActive"
          :class="['h-full transition-all duration-300', statusConfig.bgColor]"
          :style="{ width: isActive ? '100%' : '0%', animation: isActive ? 'pulse 2s ease-in-out infinite' : 'none' }"
        ></div>
        <div
          v-else
          :class="['h-full w-full', statusConfig.bgColor]"
        ></div>
      </div>

      <!-- Content -->
      <div class="p-4">
        <div class="flex items-start gap-3">
          <!-- Status icon -->
          <div :class="['flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', isActive ? 'bg-gray-800' : (status === 'running' ? 'bg-emerald-500/20' : 'bg-red-500/20')]">
            <!-- Spinning loader for active states -->
            <svg v-if="isActive" class="h-5 w-5 animate-spin text-white" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <!-- Check for success -->
            <svg v-else-if="status === 'running'" class="h-5 w-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
            </svg>
            <!-- X for failed/cancelled -->
            <svg v-else class="h-5 w-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>

          <!-- Details -->
          <div class="min-w-0 flex-1">
            <div class="flex items-center justify-between">
              <p :class="['text-sm font-medium', statusConfig.color]">
                {{ statusConfig.label }}
              </p>
              <button
                @click.stop="dismiss"
                class="rounded p-0.5 text-gray-500 hover:bg-gray-800 hover:text-gray-300"
              >
                <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <button
              @click="goToDeployment"
              class="mt-0.5 block w-full truncate text-left text-sm font-medium text-white hover:underline"
            >
              {{ deployment.project.name }}
              <span class="text-gray-500">/</span>
              {{ deployment.environment.name }}
              <template v-if="deployment.app">
                <span class="text-gray-500">/</span>
                {{ deployment.app.name }}
              </template>
            </button>

            <div class="mt-2 flex items-center gap-3 text-xs text-gray-400">
              <span v-if="deployment.gitBranch" class="flex items-center gap-1">
                <svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                {{ deployment.gitBranch }}
              </span>
              <span class="flex items-center gap-1">
                <svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {{ elapsedFormatted }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.6;
  }
}
</style>
