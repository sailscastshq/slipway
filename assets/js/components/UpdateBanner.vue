<script setup>
import Refresh from '@/components/ui/icons/Refresh.vue'
import X from '@/components/ui/icons/X.vue'
import { ref, onMounted } from 'vue'
import { Link } from '@inertiajs/vue3'
import Tooltip from '@/components/ui/tooltip/Tooltip.vue'
import { useUpdateCheck } from '@/composables/useUpdateCheck'
import {
  LEGACY_LOCAL_STORAGE_KEYS,
  LOCAL_STORAGE_KEYS,
  readLocalStorageValue
} from '@/lib/localStorageKeys'

const { updateInfo, check } = useUpdateCheck()
const dismissed = ref(false)

function dismiss() {
  dismissed.value = true
  // Store dismissal in localStorage with version to not show again for same version
  if (updateInfo.value?.latestVersion) {
    localStorage.setItem(
      LOCAL_STORAGE_KEYS.updateDismissed,
      updateInfo.value.latestVersion
    )
  }
}

onMounted(() => {
  // Check if this version was already dismissed
  const dismissedVersion = readLocalStorageValue(
    LOCAL_STORAGE_KEYS.updateDismissed,
    LEGACY_LOCAL_STORAGE_KEYS.updateDismissed
  )

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
      class="border-brand-200/50 bg-brand-50/50 dark:border-brand-900/30 dark:bg-brand-950/20 border-b px-4 py-2.5"
    >
      <div class="mx-auto flex max-w-6xl items-center justify-between">
        <div class="flex items-center space-x-3">
          <div
            class="bg-brand-100 dark:bg-brand-900/40 flex h-7 w-7 items-center justify-center rounded-full"
          >
            <Refresh
              class="text-brand-600 dark:text-brand-400 h-3.5 w-3.5"
              stroke-width="2"
            />
          </div>
          <p class="text-sm text-gray-700 dark:text-gray-300">
            <span class="font-medium text-gray-900 dark:text-white"
              >Slipway {{ updateInfo.latestVersion }}</span
            >
            is available
            <span class="hidden text-gray-400 dark:text-gray-500 sm:inline"
              >&middot; currently {{ updateInfo.currentVersion }}</span
            >
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
              type="button"
              aria-label="Dismiss update notice"
              @click="dismiss"
              class="hover:bg-brand-100 dark:hover:bg-brand-900/30 rounded-md p-1.5 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
            >
              <X class="h-4 w-4" stroke-width="2" />
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  </Transition>
</template>
