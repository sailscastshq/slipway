<script setup>
import { ref, onMounted } from 'vue'
import { Link } from '@inertiajs/vue3'
import Tooltip from '@/components/Tooltip.vue'

const updateInfo = ref(null)
const dismissed = ref(false)
const checking = ref(false)

async function checkForUpdates() {
  checking.value = true
  try {
    const response = await fetch('/api/v1/system/check-update')
    if (response.ok) {
      updateInfo.value = await response.json()
    }
  } catch (err) {
    console.error('Failed to check for updates:', err)
  } finally {
    checking.value = false
  }
}

function dismiss() {
  dismissed.value = true
  // Store dismissal in localStorage with version to not show again for same version
  if (updateInfo.value?.latestVersion) {
    localStorage.setItem('slipway_update_dismissed', updateInfo.value.latestVersion)
  }
}

onMounted(() => {
  // Check if this version was already dismissed
  const dismissedVersion = localStorage.getItem('slipway_update_dismissed')

  checkForUpdates().then(() => {
    if (updateInfo.value?.latestVersion === dismissedVersion) {
      dismissed.value = true
    }
  })
})
</script>

<template>
  <Transition
    enter-active-class="transition duration-300 ease-out"
    enter-from-class="translate-y-2 opacity-0"
    enter-to-class="translate-y-0 opacity-100"
    leave-active-class="transition duration-200 ease-in"
    leave-from-class="translate-y-0 opacity-100"
    leave-to-class="translate-y-2 opacity-0"
  >
    <div
      v-if="updateInfo?.updateAvailable && !dismissed"
      class="border-b border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-800/50 dark:bg-emerald-950/50"
    >
      <div class="mx-auto flex max-w-6xl items-center justify-between">
        <div class="flex items-center space-x-3">
          <!-- Update icon -->
          <div class="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/50">
            <svg
              class="h-4 w-4 text-emerald-600 dark:text-emerald-400"
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
          <div>
            <p class="text-sm font-medium text-emerald-900 dark:text-emerald-100">
              Slipway {{ updateInfo.latestVersion }} is available
            </p>
            <p class="text-sm text-emerald-700 dark:text-emerald-400">
              You're currently running {{ updateInfo.currentVersion }}
            </p>
          </div>
        </div>
        <div class="flex items-center space-x-2">
          <Link
            href="/settings/update"
            class="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500"
          >
            View Update
          </Link>
          <Tooltip text="Dismiss">
            <button
              @click="dismiss"
              class="rounded-md p-1.5 text-emerald-600 hover:bg-emerald-100 dark:text-emerald-400 dark:hover:bg-emerald-900/50"
            >
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  </Transition>
</template>
