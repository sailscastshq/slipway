<script setup>
import { Head, Link } from '@inertiajs/vue3'
import { inject, ref } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'

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
const checking = ref(false)
const localUpdateInfo = ref(props.updateInfo)

async function checkAgain() {
  checking.value = true
  try {
    const response = await fetch('/api/v1/system/check-update')
    if (response.ok) {
      localUpdateInfo.value = await response.json()
    }
  } catch (err) {
    console.error('Failed to check for updates:', err)
  } finally {
    checking.value = false
  }
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
  <Head :title="localUpdateInfo.updateAvailable ? 'Update Available | Slipway' : 'Updates | Slipway'"></Head>
  <div class="flex h-full flex-col">
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-gray-200 px-4 py-4 dark:border-gray-800 sm:px-8">
      <div class="flex items-center space-x-3">
        <button
          @click="toggleMobileMenu"
          class="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white md:hidden"
        >
          <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <nav class="flex items-center text-sm">
          <Link href="/settings" class="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
            settings
          </Link>
          <span class="mx-2 text-gray-300 dark:text-gray-600">/</span>
          <span class="font-medium text-gray-900 dark:text-white">update</span>
        </nav>
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
      <div class="mx-auto max-w-2xl">
        <!-- Up to Date Card -->
        <div v-if="!localUpdateInfo.updateAvailable" class="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
          <div class="flex flex-col items-center py-8 text-center">
            <div class="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/50">
              <svg
                class="h-8 w-8 text-emerald-600 dark:text-emerald-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 class="text-xl font-semibold text-gray-900 dark:text-white">You're up to date!</h1>
            <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
              Slipway {{ localUpdateInfo.currentVersion }} is the latest version.
            </p>
            <button
              @click="checkAgain"
              :disabled="checking"
              class="mt-6 inline-flex items-center space-x-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              <svg
                :class="['h-4 w-4', checking ? 'animate-spin' : '']"
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
              <span>{{ checking ? 'Checking...' : 'Check again' }}</span>
            </button>
          </div>
        </div>

        <!-- Update Available Card -->
        <div v-else class="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
          <!-- Header -->
          <div class="mb-6 flex items-start space-x-4">
            <div class="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/50">
              <svg
                class="h-6 w-6 text-emerald-600 dark:text-emerald-400"
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
                Slipway {{ localUpdateInfo.latestVersion }} Available
              </h1>
              <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                You're currently running version {{ localUpdateInfo.currentVersion }}
              </p>
              <p v-if="localUpdateInfo.publishedAt" class="mt-1 text-xs text-gray-400 dark:text-gray-500">
                Released {{ formatDate(localUpdateInfo.publishedAt) }}
              </p>
            </div>
          </div>

          <!-- Version Comparison -->
          <div class="mb-6 flex items-center justify-center space-x-4 rounded-md bg-gray-50 p-4 dark:bg-gray-800/50">
            <div class="text-center">
              <p class="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Current</p>
              <p class="mt-1 font-mono text-lg text-gray-700 dark:text-gray-300">{{ localUpdateInfo.currentVersion }}</p>
            </div>
            <svg class="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
            <div class="text-center">
              <p class="text-xs uppercase tracking-wide text-emerald-600 dark:text-emerald-400">Latest</p>
              <p class="mt-1 font-mono text-lg font-semibold text-emerald-600 dark:text-emerald-400">
                {{ localUpdateInfo.latestVersion }}
              </p>
            </div>
          </div>

          <!-- Update Instructions -->
          <div class="space-y-4">
            <h2 class="font-medium text-gray-900 dark:text-white">How to Update</h2>

            <p class="text-sm text-gray-600 dark:text-gray-400">
              Since Slipway runs in Docker, updating requires pulling the new image and recreating the container.
              Your data is stored in volumes and will be preserved.
            </p>

            <!-- Step 1 -->
            <div class="rounded-md border border-gray-200 dark:border-gray-700">
              <div class="flex items-center space-x-3 border-b border-gray-200 bg-gray-50 px-4 py-2 dark:border-gray-700 dark:bg-gray-800/50">
                <span class="flex h-6 w-6 items-center justify-center rounded-full bg-gray-200 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                  1
                </span>
                <span class="text-sm font-medium text-gray-700 dark:text-gray-300">Pull the latest image</span>
              </div>
              <div class="p-4">
                <pre class="overflow-x-auto rounded bg-gray-900 p-3 text-sm text-gray-100 dark:bg-gray-950"><code>docker pull sailscastshq/slipway:{{ localUpdateInfo.latestVersion }}</code></pre>
              </div>
            </div>

            <!-- Step 2 -->
            <div class="rounded-md border border-gray-200 dark:border-gray-700">
              <div class="flex items-center space-x-3 border-b border-gray-200 bg-gray-50 px-4 py-2 dark:border-gray-700 dark:bg-gray-800/50">
                <span class="flex h-6 w-6 items-center justify-center rounded-full bg-gray-200 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                  2
                </span>
                <span class="text-sm font-medium text-gray-700 dark:text-gray-300">Stop the current container</span>
              </div>
              <div class="p-4">
                <pre class="overflow-x-auto rounded bg-gray-900 p-3 text-sm text-gray-100 dark:bg-gray-950"><code>docker stop slipway</code></pre>
              </div>
            </div>

            <!-- Step 3 -->
            <div class="rounded-md border border-gray-200 dark:border-gray-700">
              <div class="flex items-center space-x-3 border-b border-gray-200 bg-gray-50 px-4 py-2 dark:border-gray-700 dark:bg-gray-800/50">
                <span class="flex h-6 w-6 items-center justify-center rounded-full bg-gray-200 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                  3
                </span>
                <span class="text-sm font-medium text-gray-700 dark:text-gray-300">Remove the old container</span>
              </div>
              <div class="p-4">
                <pre class="overflow-x-auto rounded bg-gray-900 p-3 text-sm text-gray-100 dark:bg-gray-950"><code>docker rm slipway</code></pre>
              </div>
            </div>

            <!-- Step 4 -->
            <div class="rounded-md border border-gray-200 dark:border-gray-700">
              <div class="flex items-center space-x-3 border-b border-gray-200 bg-gray-50 px-4 py-2 dark:border-gray-700 dark:bg-gray-800/50">
                <span class="flex h-6 w-6 items-center justify-center rounded-full bg-gray-200 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                  4
                </span>
                <span class="text-sm font-medium text-gray-700 dark:text-gray-300">Start with new image</span>
              </div>
              <div class="p-4">
                <pre class="overflow-x-auto rounded bg-gray-900 p-3 text-sm text-gray-100 dark:bg-gray-950"><code>docker run -d --name slipway \
  -p 80:1337 \
  -v slipway-data:/app/data \
  -v /var/run/docker.sock:/var/run/docker.sock \
  sailscastshq/slipway:{{ localUpdateInfo.latestVersion }}</code></pre>
              </div>
            </div>

            <!-- Docker Compose alternative -->
            <div class="mt-4 rounded-md border border-blue-200 bg-blue-50 p-4 dark:border-blue-800/50 dark:bg-blue-950/30">
              <div class="flex items-start space-x-3">
                <svg class="mt-0.5 h-5 w-5 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <p class="text-sm font-medium text-blue-900 dark:text-blue-100">Using Docker Compose?</p>
                  <p class="mt-1 text-sm text-blue-700 dark:text-blue-300">
                    Update the image tag in your <code class="rounded bg-blue-100 px-1 py-0.5 dark:bg-blue-900">docker-compose.yml</code>
                    to <code class="rounded bg-blue-100 px-1 py-0.5 dark:bg-blue-900">sailscastshq/slipway:{{ localUpdateInfo.latestVersion }}</code>,
                    then run <code class="rounded bg-blue-100 px-1 py-0.5 dark:bg-blue-900">docker compose up -d</code>.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <!-- Release Notes Link -->
          <div class="mt-6 border-t border-gray-200 pt-6 dark:border-gray-700">
            <a
              v-if="localUpdateInfo.releaseUrl"
              :href="localUpdateInfo.releaseUrl"
              target="_blank"
              class="inline-flex items-center space-x-2 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
            >
              <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
              <span>View release notes on GitHub</span>
              <svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
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
