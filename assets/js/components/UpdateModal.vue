<script setup>
import { ref } from 'vue'
import SlippyLoader from '@/components/SlippyLoader.vue'

const props = defineProps({
  updateInfo: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['close'])

const updating = ref(false)
const updateError = ref(null)
const updateStatus = ref('') // 'pulling', 'restarting', 'waiting', 'success'

async function applyUpdate() {
  updating.value = true
  updateError.value = null
  updateStatus.value = 'pulling'

  try {
    const response = await fetch('/api/v1/system/apply-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    })

    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.message || 'Failed to initiate update')
    }

    updateStatus.value = 'restarting'
    await new Promise(resolve => setTimeout(resolve, 5000))
    updateStatus.value = 'waiting'
    await waitForHealthy()

    updateStatus.value = 'success'
    setTimeout(() => window.location.reload(), 1500)
  } catch (err) {
    if (err.name === 'TypeError' || err.message.includes('fetch')) {
      updateStatus.value = 'waiting'
      try {
        await waitForHealthy()
        updateStatus.value = 'success'
        setTimeout(() => window.location.reload(), 1500)
      } catch {
        updateError.value = 'Slipway did not come back up. Check your server.'
        updating.value = false
      }
    } else {
      updateError.value = err.message
      updating.value = false
      updateStatus.value = ''
    }
  }
}

async function waitForHealthy(maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(resolve => setTimeout(resolve, 2000))
    try {
      const res = await fetch('/health')
      if (res.ok) return
    } catch {
      // Still down — keep polling
    }
  }
  throw new Error('timeout')
}

function formatDate(dateString) {
  if (!dateString) return ''
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
}
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <!-- Backdrop -->
        <div
          class="absolute inset-0 bg-black/50"
          @click="!updating && emit('close')"
        ></div>

        <!-- Modal -->
        <div class="relative w-full max-w-md rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900">
          <!-- Header -->
          <div class="flex items-start space-x-4 border-b border-gray-200 p-5 dark:border-gray-800">
            <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/50">
              <svg
                class="h-5 w-5 text-emerald-600 dark:text-emerald-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </div>
            <div class="min-w-0 flex-1">
              <h3 class="text-lg font-semibold text-gray-900 dark:text-white">
                Update Available
              </h3>
              <p class="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                Slipway {{ updateInfo.latestVersion }} is ready to install
              </p>
              <p v-if="updateInfo.publishedAt" class="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
                Released {{ formatDate(updateInfo.publishedAt) }}
              </p>
            </div>
            <button
              v-if="!updating"
              @click="emit('close')"
              class="rounded-md p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <!-- Version Comparison -->
          <div class="border-b border-gray-200 px-5 py-4 dark:border-gray-800">
            <div class="flex items-center justify-center space-x-4 rounded-md bg-gray-50 p-3 dark:bg-gray-800/50">
              <div class="text-center">
                <p class="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Current</p>
                <p class="mt-1 font-mono text-sm text-gray-700 dark:text-gray-300">{{ updateInfo.currentVersion }}</p>
              </div>
              <svg class="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
              <div class="text-center">
                <p class="text-xs uppercase tracking-wide text-emerald-600 dark:text-emerald-400">Latest</p>
                <p class="mt-1 font-mono text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                  {{ updateInfo.latestVersion }}
                </p>
              </div>
            </div>
          </div>

          <!-- Body -->
          <div class="p-5">
            <!-- Updating State -->
            <div v-if="updating" class="flex flex-col items-center py-2 text-center">
              <SlippyLoader size="h-7 w-7" class="mb-3 text-emerald-600 dark:text-emerald-400" />
              <p class="text-sm font-medium text-gray-900 dark:text-white">
                <template v-if="updateStatus === 'pulling'">Pulling latest image...</template>
                <template v-else-if="updateStatus === 'restarting'">Restarting Slipway...</template>
                <template v-else-if="updateStatus === 'waiting'">Waiting for Slipway to come back up...</template>
                <template v-else-if="updateStatus === 'success'">Update complete! Reloading...</template>
              </p>
              <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Your data is preserved. This may take up to a minute.
              </p>
            </div>

            <!-- Error State -->
            <div v-else-if="updateError" class="space-y-3">
              <div class="rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-800/50 dark:bg-red-950/30">
                <div class="flex items-start space-x-2">
                  <svg class="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                  <p class="text-sm text-red-700 dark:text-red-300">{{ updateError }}</p>
                </div>
              </div>
              <div class="flex items-center space-x-3">
                <button
                  @click="applyUpdate"
                  class="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
                >
                  Try Again
                </button>
                <button
                  @click="emit('close')"
                  class="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  Cancel
                </button>
              </div>
            </div>

            <!-- Ready State -->
            <div v-else class="space-y-4">
              <div class="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-800/50 dark:bg-amber-950/30">
                <svg class="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <p class="text-sm text-amber-800 dark:text-amber-200">
                  Slipway will briefly go offline during the update.
                </p>
              </div>
              <div class="flex items-center justify-end space-x-3">
                <button
                  @click="emit('close')"
                  class="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  Cancel
                </button>
                <button
                  @click="applyUpdate"
                  class="inline-flex items-center space-x-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
                >
                  <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  <span>Update Now</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
