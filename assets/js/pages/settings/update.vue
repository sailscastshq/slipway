<script setup>
import { Head, Link } from '@inertiajs/vue3'
import { inject, ref, watch, onUnmounted } from 'vue'
import { useEventSource } from '@/composables/sse'
import AppLayout from '@/layouts/AppLayout.vue'
import SlippyLoader from '@/components/SlippyLoader.vue'
import { Spinner } from '@/components/ui/spinner'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  updateInfo: {
    type: Object,
    required: true
  }
})

const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')
const checking = ref(false)
const updating = ref(false)
const updateError = ref(null)
const updatePhase = ref('')
const updateDetail = ref('')
const localUpdateInfo = ref(props.updateInfo)
const lastChecked = ref(new Date())
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

async function checkAgain() {
  checking.value = true
  try {
    const response = await fetch('/api/v1/system/check-update')
    if (response.ok) {
      localUpdateInfo.value = await response.json()
      lastChecked.value = new Date()
    }
  } catch (err) {
    console.error('Failed to check for updates:', err)
  } finally {
    checking.value = false
  }
}

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
      data.targetVersion || localUpdateInfo.value.latestVersion || null
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

function formatTime(date) {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  })
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
  <Head
    :title="
      localUpdateInfo.updateAvailable
        ? 'Update Available | Slipway'
        : 'Updates | Slipway'
    "
  ></Head>
  <div class="flex h-full flex-col">
    <!-- Header -->
    <div
      class="flex items-center justify-between border-b border-gray-200 py-4 pl-4 pr-4 dark:border-gray-800 sm:pl-4 sm:pr-8"
    >
      <div class="flex items-center space-x-3">
        <button
          @click="toggleMobileMenu"
          class="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white md:hidden"
        >
          <svg
            class="h-5 w-5"
            viewBox="-0.5 -0.5 16 16"
            fill="none"
            stroke="currentColor"
          >
            <path
              d="M12.777 14.285H2.223c-.833 0-1.508-.675-1.508-1.508V2.223c0-.833.675-1.508 1.508-1.508h10.554c.833 0 1.508.675 1.508 1.508v10.554c0 .833-.675 1.508-1.508 1.508Z"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1"
            />
            <path
              d="M5.615 14.285V.715"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1"
            />
            <path
              d="M2.6 5.992 3.919 7.5 2.6 9.008"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1"
            />
          </svg>
        </button>
        <!-- Desktop sidebar toggle -->
        <button
          @click="toggleSidebar"
          class="hidden text-gray-400 dark:text-gray-500 md:block"
        >
          <svg
            v-if="sidebarCollapsed"
            class="h-5 w-5"
            viewBox="-0.5 -0.5 16 16"
            fill="none"
            stroke="currentColor"
          >
            <path
              d="M12.777 14.285H2.223c-.833 0-1.508-.675-1.508-1.508V2.223c0-.833.675-1.508 1.508-1.508h10.554c.833 0 1.508.675 1.508 1.508v10.554c0 .833-.675 1.508-1.508 1.508Z"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1"
            />
            <path
              d="M5.615 14.285V.715"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1"
            />
            <path
              d="M2.6 5.992 3.919 7.5 2.6 9.008"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1"
            />
          </svg>
          <svg
            v-else
            class="h-5 w-5"
            viewBox="-0.5 -0.5 16 16"
            fill="none"
            stroke="currentColor"
          >
            <path
              d="M12.777 14.285H2.223c-.833 0-1.508-.675-1.508-1.508V2.223c0-.833.675-1.508 1.508-1.508h10.554c.833 0 1.508.675 1.508 1.508v10.554c0 .833-.675 1.508-1.508 1.508Z"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1"
            />
            <path
              d="M5.615 14.285V.715"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1"
            />
            <path
              d="M3.919 5.992 2.6 7.5l1.319 1.508"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1"
            />
          </svg>
        </button>
        <nav class="flex items-center text-sm">
          <Link
            href="/settings"
            class="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            settings
          </Link>
          <span class="mx-2 text-gray-300 dark:text-gray-600">/</span>
          <span class="font-medium text-gray-900 dark:text-white">update</span>
        </nav>
      </div>
      <div class="flex items-center space-x-4">
        <a
          href="https://docs.sailscasts.com/slipway"
          target="_blank"
          class="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
        >
          Docs
          <svg
            class="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
            />
          </svg>
        </a>
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
      <div class="mx-auto max-w-2xl">
        <!-- ═══ Up to Date ═══ -->
        <div
          v-if="!localUpdateInfo.updateAvailable"
          class="rounded-lg border border-gray-200 dark:border-gray-800"
        >
          <!-- Status -->
          <div class="flex flex-col items-center px-6 py-10 text-center">
            <div
              class="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800"
            >
              <svg
                class="h-7 w-7 text-gray-900 dark:text-white"
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
            </div>
            <h1 class="text-xl font-semibold text-gray-900 dark:text-white">
              You're up to date
            </h1>
            <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
              Slipway is running the latest version.
            </p>
          </div>

          <!-- Version + check -->
          <div class="border-t border-gray-200 px-6 py-4 dark:border-gray-800">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm font-medium text-gray-900 dark:text-white">
                  v{{ localUpdateInfo.currentVersion }}
                </p>
                <p class="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
                  Checked {{ formatTime(lastChecked) }}
                </p>
              </div>
              <button
                @click="checkAgain"
                :disabled="checking"
                class="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                <Spinner v-if="checking" class="h-3.5 w-3.5" />
                <svg
                  v-else
                  class="h-3.5 w-3.5"
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
                Check for updates
              </button>
            </div>
          </div>

          <!-- Links -->
          <div class="border-t border-gray-200 px-6 py-4 dark:border-gray-800">
            <div class="flex flex-wrap gap-4">
              <a
                href="https://github.com/sailscastshq/slipway/releases"
                target="_blank"
                class="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
              >
                <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                  <path
                    d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
                  />
                </svg>
                Changelog
                <svg
                  class="h-3 w-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                  />
                </svg>
              </a>
              <a
                href="https://docs.sailscasts.com/slipway"
                target="_blank"
                class="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
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
                    d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                  />
                </svg>
                Documentation
                <svg
                  class="h-3 w-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                  />
                </svg>
              </a>
            </div>
          </div>
        </div>

        <!-- ═══ Update Available ═══ -->
        <div
          v-else
          class="rounded-lg border border-gray-200 dark:border-gray-800"
        >
          <!-- Header -->
          <div class="p-6">
            <div class="flex items-start space-x-4">
              <div
                class="bg-brand-100 dark:bg-brand-900/40 flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
              >
                <svg
                  class="h-5.5 w-5.5 text-brand-600 dark:text-brand-400"
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
                <h1 class="text-xl font-semibold text-gray-900 dark:text-white">
                  Slipway {{ localUpdateInfo.latestVersion }}
                </h1>
                <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  You're running {{ localUpdateInfo.currentVersion }}
                </p>
                <p
                  v-if="localUpdateInfo.publishedAt"
                  class="mt-0.5 text-xs text-gray-400 dark:text-gray-500"
                >
                  Released {{ formatDate(localUpdateInfo.publishedAt) }}
                </p>
              </div>
            </div>
          </div>

          <!-- Version Comparison -->
          <div
            class="mx-6 mb-6 rounded-lg border border-gray-200 bg-gray-50 p-5 dark:border-gray-800 dark:bg-gray-800/50"
          >
            <div class="flex items-center justify-center space-x-8">
              <div class="text-center">
                <p
                  class="text-[10px] uppercase tracking-widest text-gray-400 dark:text-gray-500"
                >
                  Current
                </p>
                <p
                  class="mt-2 font-mono text-lg text-gray-500 dark:text-gray-400"
                >
                  {{ localUpdateInfo.currentVersion }}
                </p>
              </div>
              <svg
                class="h-5 w-5 text-gray-300 dark:text-gray-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M13 7l5 5m0 0l-5 5m5-5H6"
                />
              </svg>
              <div class="text-center">
                <p
                  class="text-brand-600 dark:text-brand-400 text-[10px] uppercase tracking-widest"
                >
                  Latest
                </p>
                <p
                  class="mt-2 font-mono text-lg font-semibold text-gray-900 dark:text-white"
                >
                  {{ localUpdateInfo.latestVersion }}
                </p>
              </div>
            </div>
          </div>

          <!-- Update Action -->
          <div class="border-t border-gray-200 p-6 dark:border-gray-800">
            <!-- Updating State -->
            <div
              v-if="updating"
              class="flex flex-col items-center py-6 text-center"
            >
              <Spinner
                v-if="updatePhase !== 'success'"
                class="text-brand-600 dark:text-brand-400 mb-4 h-8 w-8"
              >
                <SlippyLoader />
              </Spinner>
              <div
                v-else
                class="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/40"
              >
                <svg
                  class="h-5 w-5 text-green-600 dark:text-green-400"
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
            <div v-else-if="updateError" class="space-y-4">
              <div
                class="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800/50 dark:bg-red-950/30"
              >
                <div class="flex items-start space-x-3">
                  <svg
                    class="mt-0.5 h-5 w-5 shrink-0 text-red-600 dark:text-red-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
                    />
                  </svg>
                  <div>
                    <p
                      class="text-sm font-medium text-red-900 dark:text-red-100"
                    >
                      Update failed
                    </p>
                    <p class="mt-1 text-sm text-red-700 dark:text-red-300">
                      {{ updateError }}
                    </p>
                  </div>
                </div>
              </div>
              <div class="flex items-center space-x-3">
                <button
                  @click="applyUpdate"
                  class="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
                >
                  Try Again
                </button>
                <span class="text-sm text-gray-500 dark:text-gray-400"
                  >or update manually (see below)</span
                >
              </div>
            </div>

            <!-- Ready State -->
            <div v-else class="flex items-center justify-between gap-4">
              <p class="text-sm text-gray-600 dark:text-gray-400">
                The dashboard will briefly go offline while the container
                restarts, then reload automatically.
              </p>
              <button
                @click="applyUpdate"
                class="inline-flex shrink-0 items-center space-x-2 rounded-md bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
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
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  />
                </svg>
                <span>Update Now</span>
              </button>
            </div>
          </div>

          <!-- Manual Update Fallback -->
          <div class="border-t border-gray-200 px-6 py-5 dark:border-gray-800">
            <details class="group">
              <summary
                class="flex items-center justify-between text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                <span>Manual update instructions</span>
                <svg
                  class="h-4 w-4 transition-transform group-open:rotate-180"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </summary>
              <div class="mt-4 space-y-3">
                <p class="text-sm text-gray-600 dark:text-gray-400">
                  SSH into your server and re-run the install script. It detects
                  the existing installation, reuses your secrets, pulls this
                  release, and restarts Slipway.
                </p>
                <pre
                  class="overflow-x-auto rounded-lg bg-gray-900 p-3 text-sm text-gray-100 dark:bg-gray-950"
                ><code>curl -fsSL https://raw.githubusercontent.com/sailscastshq/slipway/main/install.sh | bash -s -- {{ localUpdateInfo.latestVersion }}</code></pre>
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  Your data is stored on Docker volumes and is preserved across
                  updates.
                </p>
              </div>
            </details>
          </div>

          <!-- Release Notes Link -->
          <div class="border-t border-gray-200 px-6 py-4 dark:border-gray-800">
            <div class="flex flex-wrap gap-4">
              <a
                v-if="localUpdateInfo.releaseUrl"
                :href="localUpdateInfo.releaseUrl"
                target="_blank"
                class="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
              >
                <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                  <path
                    d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
                  />
                </svg>
                Release notes
                <svg
                  class="h-3 w-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                  />
                </svg>
              </a>
              <a
                href="https://docs.sailscasts.com/slipway/updates"
                target="_blank"
                class="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
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
                    d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                  />
                </svg>
                Update docs
                <svg
                  class="h-3 w-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                  />
                </svg>
              </a>
            </div>
          </div>
        </div>

        <!-- Back Link -->
        <div class="mt-6 text-center">
          <Link
            href="/settings"
            class="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            &larr; Back to Settings
          </Link>
        </div>
      </div>
    </div>
  </div>
</template>
