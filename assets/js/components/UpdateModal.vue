<script setup>
import WarningTriangle from '@/components/ui/icons/WarningTriangle.vue'
import Refresh from '@/components/ui/icons/Refresh.vue'
import Download from '@/components/ui/icons/Download.vue'
import Check from '@/components/ui/icons/Check.vue'
import ArrowRight from '@/components/ui/icons/ArrowRight.vue'
import X from '@/components/ui/icons/X.vue'
import { ref, watch, onUnmounted } from 'vue'
import Spinner from '@/components/SlipwaySpinner.vue'
import Alert from '@/components/ui/alert/Alert.vue'
import { useEventSource } from '@/composables/sse'

const props = defineProps({
  updateInfo: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['close'])

const updating = ref(false)
const updateError = ref(null)
const updatePhase = ref('') // 'pulling', 'backing-up', 'validating', 'swapping', 'waiting', 'success'
const updateDetail = ref('')
const updateTargetVersion = ref(props.updateInfo.latestVersion || null)

const {
  connected: sseConnected,
  close: disconnectSSE,
  connect: connectSSE
} = useEventSource('/api/v1/system/stream-update', {
  immediate: false,
  autoReconnect: false,
  onMessage(data) {
    updatePhase.value = data.phase
    updateDetail.value = data.detail || ''

    if (data.phase === 'failed') {
      disconnectSSE()
      updateError.value = data.detail || 'Update failed'
      updating.value = false
      updatePhase.value = ''
    }
  }
})

// When SSE drops during an update (server restarting), poll for health
watch(sseConnected, (isConnected, wasConnected) => {
  if (
    wasConnected &&
    !isConnected &&
    updating.value &&
    updatePhase.value !== 'failed'
  ) {
    updatePhase.value = 'waiting'
    updateDetail.value = ''
    waitForHealthy(updateTargetVersion.value)
      .then(() => {
        updatePhase.value = 'success'
        updateDetail.value = ''
        setTimeout(() => window.location.reload(), 1500)
      })
      .catch((err) => {
        updateError.value =
          err.message || 'Slipway did not come back up. Check your server.'
        updating.value = false
        updatePhase.value = ''
      })
  }
})

async function applyUpdate() {
  updating.value = true
  updateError.value = null
  updatePhase.value = 'starting'
  updateDetail.value = 'Initiating update...'

  try {
    const response = await fetch('/api/v1/system/apply-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    })

    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.message || 'Failed to initiate update')
    }

    const data = await response.json().catch(() => ({}))
    updateTargetVersion.value =
      data.targetVersion || props.updateInfo.latestVersion || null
    connectSSE()
  } catch (err) {
    updateError.value = err.message
    updating.value = false
    updatePhase.value = ''
  }
}

async function waitForHealthy(expectedVersion, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2000))
    let res
    try {
      res = await fetch('/health')
    } catch {
      // Still down — keep polling.
      continue
    }

    if (!res.ok) continue

    const health = await res.json().catch(() => ({}))
    if (!expectedVersion || health.version === expectedVersion) return

    if (health.version) {
      throw new Error(
        `Slipway came back on v${health.version}, so the update likely rolled back before v${expectedVersion} finished.`
      )
    }

    throw new Error(
      `Slipway came back without version metadata, so v${expectedVersion} could not be confirmed.`
    )
  }
  throw new Error('timeout')
}

const phaseLabels = {
  starting: 'Initiating update...',
  checking: 'Checking for updates...',
  pulling: 'Pulling image...',
  'backing-up': 'Backing up database...',
  inspecting: 'Reading container configuration...',
  validating: 'Validating new version...',
  swapping: 'Swapping containers...',
  waiting: 'Waiting for Slipway to come back up...',
  success: 'Update complete! Reloading...'
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
          class="absolute inset-0 bg-black/50 backdrop-blur-sm"
          @click="!updating && emit('close')"
        ></div>

        <!-- Modal -->
        <div
          class="relative w-full max-w-md overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900"
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
              v-if="!updating"
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
                <p
                  class="mt-1.5 font-mono text-sm text-gray-600 dark:text-gray-400"
                >
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
            <div
              v-if="updating"
              class="flex flex-col items-center py-4 text-center"
            >
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
                v-if="updateDetail"
                class="mt-0.5 text-xs text-gray-500 dark:text-gray-400"
              >
                {{ updateDetail }}
              </p>
              <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Your data is preserved. This may take up to a minute.
              </p>
            </div>

            <!-- Error State -->
            <div v-else-if="updateError" class="space-y-3">
              <div
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
              </div>
              <div class="flex items-center space-x-3">
                <button
                  @click="applyUpdate"
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
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
