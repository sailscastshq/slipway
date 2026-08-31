<script setup>
import WarningTriangle from '@/components/ui/icons/WarningTriangle.vue'
import SidebarOpen from '@/components/ui/icons/SidebarOpen.vue'
import SidebarClose from '@/components/ui/icons/SidebarClose.vue'
import Refresh from '@/components/ui/icons/Refresh.vue'
import ExternalLink from '@/components/ui/icons/ExternalLink.vue'
import Download from '@/components/ui/icons/Download.vue'
import ChevronDown from '@/components/ui/icons/ChevronDown.vue'
import Check from '@/components/ui/icons/Check.vue'
import BookOpen from '@/components/ui/icons/BookOpen.vue'
import ArrowRight from '@/components/ui/icons/ArrowRight.vue'
import { Head, Link } from '@inertiajs/vue3'
import { inject, ref, watch, onUnmounted } from 'vue'
import { useEventSource } from '@/composables/sse'
import AppLayout from '@/layouts/AppLayout.vue'
import Spinner from '@/components/SlipwaySpinner.vue'

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
          <SidebarOpen class="h-5 w-5" stroke-width="1" />
        </button>
        <!-- Desktop sidebar toggle -->
        <button
          @click="toggleSidebar"
          class="hidden text-gray-400 dark:text-gray-500 md:block"
        >
          <SidebarOpen
            v-if="sidebarCollapsed"
            class="h-5 w-5"
            stroke-width="1"
          />
          <SidebarClose v-else class="h-5 w-5" stroke-width="1" />
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
          <ExternalLink class="h-3.5 w-3.5" stroke-width="2" />
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
              <Check
                class="h-7 w-7 text-gray-900 dark:text-white"
                stroke-width="2"
              />
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
                <Refresh v-else class="h-3.5 w-3.5" stroke-width="2" />
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
                <ExternalLink class="h-3 w-3" stroke-width="2" />
              </a>
              <a
                href="https://docs.sailscasts.com/slipway"
                target="_blank"
                class="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
              >
                <BookOpen class="h-4 w-4" stroke-width="2" />
                Documentation
                <ExternalLink class="h-3 w-3" stroke-width="2" />
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
                <Refresh
                  class="h-5.5 w-5.5 text-brand-600 dark:text-brand-400"
                  stroke-width="2"
                />
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
              <ArrowRight
                class="h-5 w-5 text-gray-300 dark:text-gray-600"
                stroke-width="2"
              />
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
              />
              <div
                v-else
                class="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/40"
              >
                <Check
                  class="h-5 w-5 text-green-600 dark:text-green-400"
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
            <div v-else-if="updateError" class="space-y-4">
              <div
                class="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800/50 dark:bg-red-950/30"
              >
                <div class="flex items-start space-x-3">
                  <WarningTriangle
                    class="mt-0.5 h-5 w-5 shrink-0 text-red-600 dark:text-red-400"
                    stroke-width="2"
                  />
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
                <Download class="h-4 w-4" stroke-width="2" />
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
                <ChevronDown
                  class="h-4 w-4 transition-transform group-open:rotate-180"
                  stroke-width="2"
                />
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
                <ExternalLink class="h-3 w-3" stroke-width="2" />
              </a>
              <a
                href="https://docs.sailscasts.com/slipway/updates"
                target="_blank"
                class="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
              >
                <BookOpen class="h-4 w-4" stroke-width="2" />
                Update docs
                <ExternalLink class="h-3 w-3" stroke-width="2" />
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
