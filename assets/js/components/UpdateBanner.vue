<script setup>
import { ref, onMounted } from 'vue'
import { Link } from '@inertiajs/vue3'
import Tooltip from '@/components/Tooltip.vue'
import { useUpdateCheck } from '@/composables/useUpdateCheck'

const { updateInfo, check } = useUpdateCheck()
const dismissed = ref(false)

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

  check().then(() => {
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
      class="border-b border-brand-200/50 bg-brand-50/50 px-4 py-2.5 dark:border-brand-900/30 dark:bg-brand-950/20"
    >
      <div class="mx-auto flex max-w-6xl items-center justify-between">
        <div class="flex items-center space-x-3">
          <div class="flex h-7 w-7 items-center justify-center rounded-full bg-brand-100 dark:bg-brand-900/40">
            <svg
              class="h-3.5 w-3.5 text-brand-600 dark:text-brand-400"
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
          <p class="text-sm text-gray-700 dark:text-gray-300">
            <span class="font-medium text-gray-900 dark:text-white">Slipway {{ updateInfo.latestVersion }}</span>
            is available
            <span class="hidden text-gray-400 dark:text-gray-500 sm:inline">&middot; currently {{ updateInfo.currentVersion }}</span>
          </p>
        </div>
        <div class="flex items-center space-x-2">
          <Link
            href="/settings/update"
            class="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
          >
            Update
          </Link>
          <Tooltip text="Dismiss">
            <button
              @click="dismiss"
              class="rounded-md p-1.5 text-gray-400 hover:bg-brand-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-brand-900/30 dark:hover:text-gray-300"
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
