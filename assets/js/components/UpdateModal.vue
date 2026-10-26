<script setup>
import WarningTriangle from '@/components/ui/icons/WarningTriangle.vue'
import Refresh from '@/components/ui/icons/Refresh.vue'
import Download from '@/components/ui/icons/Download.vue'
import Check from '@/components/ui/icons/Check.vue'
import ArrowRight from '@/components/ui/icons/ArrowRight.vue'
import X from '@/components/ui/icons/X.vue'
import Spinner from '@/components/SlipwaySpinner.vue'
import Alert from '@/components/ui/alert/Alert.vue'
import { useUpdateOperation } from '@/composables/useUpdateOperation'
import Dialog from '@/components/ui/dialog/Dialog.vue'

const props = defineProps({
  updateInfo: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['close'])

const {
  updating,
  updateError,
  updatePhase,
  updateDetail,
  connectionNotice,
  canRetry,
  applyUpdate: beginUpdate,
  phaseLabels
} = useUpdateOperation()
const applyUpdate = () => beginUpdate(props.updateInfo.latestVersion)

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
  <Dialog
    :open="true"
    @update:open="(value) => !value && emit('close')"
    aria-label="Slipway update"
    class="w-full max-w-md overflow-hidden rounded-xl border border-gray-200 bg-white p-0 shadow-2xl dark:border-gray-700 dark:bg-gray-900"
  >
    <!-- Header -->
    <div class="flex items-start space-x-4 p-5">
      <div
        class="bg-brand-100 dark:bg-brand-900/40 flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
      >
        <Refresh
          class="text-brand-600 dark:text-brand-400 h-5 w-5"
          stroke-width="2"
        />
      </div>
      <div class="min-w-0 flex-1">
        <h3 class="text-lg font-semibold text-gray-900 dark:text-white">
          Update Available
        </h3>
        <p class="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
          Slipway {{ updateInfo.latestVersion }} is ready to install
        </p>
        <p
          v-if="updateInfo.publishedAt"
          class="mt-0.5 text-xs text-gray-400 dark:text-gray-500"
        >
          Released {{ formatDate(updateInfo.publishedAt) }}
        </p>
      </div>
      <button
        aria-label="Close update"
        @click="emit('close')"
        class="rounded-md p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
      >
        <X class="h-5 w-5" stroke-width="2" />
      </button>
    </div>

    <!-- Version Comparison -->
    <div
      class="mx-5 mb-5 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-800/50"
    >
      <div class="flex items-center justify-center space-x-6">
        <div class="text-center">
          <p
            class="text-[10px] uppercase tracking-widest text-gray-400 dark:text-gray-500"
          >
            Current
          </p>
          <p class="mt-1.5 font-mono text-sm text-gray-600 dark:text-gray-400">
            {{ updateInfo.currentVersion }}
          </p>
        </div>
        <ArrowRight
          class="h-4 w-4 text-gray-300 dark:text-gray-600"
          stroke-width="2"
        />
        <div class="text-center">
          <p
            class="text-brand-600 dark:text-brand-400 text-[10px] uppercase tracking-widest"
          >
            Latest
          </p>
          <p
            class="mt-1.5 font-mono text-sm font-semibold text-gray-900 dark:text-white"
          >
            {{ updateInfo.latestVersion }}
          </p>
        </div>
      </div>
    </div>

    <!-- Body -->
    <div class="border-t border-gray-200 p-5 dark:border-gray-800">
      <!-- Updating State -->
      <div v-if="updating" class="flex flex-col items-center py-4 text-center">
        <Spinner
          v-if="updatePhase !== 'success'"
          class="text-brand-600 dark:text-brand-400 mb-3 h-7 w-7"
        />
        <div
          v-else
          class="mb-3 flex h-7 w-7 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/40"
        >
          <Check
            class="h-4 w-4 text-green-600 dark:text-green-400"
            stroke-width="2"
          />
        </div>
        <p class="text-sm font-medium text-gray-900 dark:text-white">
          {{ phaseLabels[updatePhase] || 'Updating...' }}
        </p>
        <p
          v-if="connectionNotice"
          role="status"
          class="mt-2 text-xs text-gray-500"
        >
          {{ connectionNotice }}
        </p>
        <p
          v-if="updateDetail"
          class="mt-0.5 text-xs text-gray-500 dark:text-gray-400"
        >
          {{ updateDetail }}
        </p>
        <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
          The update continues on your server if you close this window.
        </p>
      </div>

      <!-- Error State -->
      <div v-else-if="updateError" class="space-y-3">
        <Alert
          role="alert"
          class="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800/50 dark:bg-red-950/30"
        >
          <div class="flex items-start space-x-2">
            <WarningTriangle
              class="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400"
              stroke-width="2"
            />
            <p class="text-sm text-red-700 dark:text-red-300">
              {{ updateError }}
            </p>
          </div>
        </Alert>
        <div class="flex items-center space-x-3">
          <button
            @click="applyUpdate"
            :disabled="!canRetry"
            class="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
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
        <Alert
          role="note"
          class="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-inherit dark:border-amber-800/50 dark:bg-amber-950/30"
        >
          <WarningTriangle
            class="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
            stroke-width="2"
          />
          <p class="text-sm text-amber-800 dark:text-amber-200">
            Slipway will briefly go offline during the update.
          </p>
        </Alert>
        <div class="flex items-center justify-end space-x-3">
          <button
            @click="emit('close')"
            class="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            @click="applyUpdate"
            class="inline-flex items-center space-x-2 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
          >
            <Download class="h-4 w-4" stroke-width="2" />
            <span>Update Now</span>
          </button>
        </div>
      </div>
    </div>
  </Dialog>
</template>
