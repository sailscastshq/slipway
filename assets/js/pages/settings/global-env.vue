<script setup>
import { Link, Head, router } from '@inertiajs/vue3'
import { inject, ref, reactive, computed, watch, onMounted } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'
import Tooltip from '@/components/Tooltip.vue'
import { useToast } from '@/composables/toast'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  globalEnvVars: Object,
  backupConfigured: Boolean
})

const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')
const toast = useToast()

const localVars = reactive({ ...props.globalEnvVars })
const newKey = ref('')
const newValue = ref('')
const saving = ref(false)
const bulkMode = ref(new URLSearchParams(window.location.search).has('bulk'))
const bulkText = ref('')
const revealedKeys = ref(new Set())

const sortedVarKeys = computed(() => Object.keys(localVars).sort())

function isSensitive() {
  return true
}

function toggleReveal(key) {
  if (revealedKeys.value.has(key)) {
    revealedKeys.value.delete(key)
  } else {
    revealedKeys.value.add(key)
  }
}

function shouldShowGenerate(key) {
  const upper = key.toUpperCase()
  return upper.includes('SECRET') || upper.includes('KEY')
}

function generateSecret() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  newValue.value = Array.from(bytes, (b) =>
    b.toString(16).padStart(2, '0')
  ).join('')
}

async function saveVars(vars) {
  saving.value = true
  try {
    const res = await fetch('/settings/global-env', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ envVars: vars })
    })
    if (!res.ok) throw new Error('Failed to save')
    router.reload({ only: ['globalEnvVars', 'backupConfigured'] })
    toast({ message: 'Environment variables saved', type: 'success' })
  } catch (err) {
    toast({ message: err?.message || 'Failed to save environment variables', type: 'error' })
  } finally {
    saving.value = false
  }
}

function addVar() {
  if (!newKey.value.trim()) return
  localVars[newKey.value.trim()] = newValue.value
  saveVars(localVars)
  newKey.value = ''
  newValue.value = ''
}

function removeVar(key) {
  delete localVars[key]
  saveVars(localVars)
}

const bulkHighlighted = computed(() => {
  const text = bulkText.value || ''
  return (
    text
      .split('\n')
      .map((line) => {
        const escaped = line
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
        if (escaped.trimStart().startsWith('#')) {
          return `<span class="text-gray-500 dark:text-gray-600">${escaped}</span>`
        }
        const eqIdx = escaped.indexOf('=')
        if (eqIdx === -1) return escaped
        const key = escaped.slice(0, eqIdx)
        const value = escaped.slice(eqIdx + 1)
        return `<span class="text-amber-600 dark:text-amber-400">${key}</span><span class="text-gray-400 dark:text-gray-600">=</span><span class="text-gray-800 dark:text-gray-300">${value}</span>`
      })
      .join('\n') + '\n'
  )
})

function enterBulkMode() {
  bulkText.value = sortedVarKeys.value
    .map((k) => `${k}=${localVars[k]}`)
    .join('\n')
  bulkMode.value = true
}

function exitBulkMode() {
  bulkMode.value = false
}

function saveBulk() {
  const vars = {}
  for (const line of bulkText.value.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const value = trimmed.slice(eqIdx + 1).trim()
    if (key) vars[key] = value
  }
  Object.keys(localVars).forEach((k) => delete localVars[k])
  Object.assign(localVars, vars)
  saveVars(localVars)
  bulkMode.value = false
}

watch(bulkMode, (open) => {
  const url = new URL(window.location)
  if (open) {
    url.searchParams.set('bulk', '1')
  } else {
    url.searchParams.delete('bulk')
  }
  window.history.replaceState({}, '', url)
})

onMounted(() => {
  if (bulkMode.value) {
    bulkText.value = sortedVarKeys.value
      .map((k) => `${k}=${localVars[k]}`)
      .join('\n')
  }
})
</script>
<template>
  <Head title="Global Environment | Slipway"></Head>
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
        <nav class="flex items-center space-x-2 text-sm">
          <Link
            href="/settings"
            class="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >
            settings
          </Link>
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <span class="font-medium text-gray-900 dark:text-white"
            >global environment</span
          >
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
      <div class="mx-auto max-w-6xl">
        <!-- Description -->
        <div class="mb-6">
          <h1 class="text-xl font-semibold text-gray-900 dark:text-white">
            Global Environment Variables
          </h1>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Instance-wide variables automatically injected into all deployed
            applications. Per-environment variables override these.
          </p>
        </div>

        <!-- Backup storage status -->
        <div class="mb-6">
          <div
            :class="[
              'flex items-center gap-2 rounded-lg border px-4 py-3',
              backupConfigured
                ? 'border-green-200 bg-green-50/50 dark:border-green-900/50 dark:bg-green-950/20'
                : 'border-gray-200 bg-gray-50/50 dark:border-gray-800 dark:bg-gray-900/50'
            ]"
          >
            <svg
              v-if="backupConfigured"
              class="h-4 w-4 text-green-500"
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
            <svg
              v-else
              class="h-4 w-4 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span
              :class="[
                'text-sm',
                backupConfigured
                  ? 'text-green-700 dark:text-green-400'
                  : 'text-gray-500 dark:text-gray-400'
              ]"
            >
              {{
                backupConfigured
                  ? 'Backup storage configured'
                  : 'Set R2_ACCESS_KEY, R2_SECRET_KEY, R2_BUCKET, and R2_ENDPOINT to enable database backups'
              }}
            </span>
          </div>
        </div>

        <!-- Variables -->
        <div class="rounded-lg border border-gray-200 dark:border-gray-800">
          <!-- Header with bulk toggle -->
          <div class="flex items-center justify-between px-4 py-3">
            <h2 class="text-sm font-medium text-gray-900 dark:text-white">
              Variables
            </h2>
            <div class="flex items-center gap-2">
              <span
                class="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400"
              >
                {{ sortedVarKeys.length }}
              </span>
              <Tooltip :text="bulkMode ? 'Single edit' : 'Bulk edit'">
                <button
                  @click="bulkMode ? exitBulkMode() : enterBulkMode()"
                  class="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                >
                  <svg
                    v-if="bulkMode"
                    class="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M4 6h16M4 12h16M4 18h16"
                    />
                  </svg>
                  <svg
                    v-else
                    class="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
                    />
                  </svg>
                </button>
              </Tooltip>
            </div>
          </div>

          <!-- Bulk edit mode -->
          <template v-if="bulkMode">
            <div class="border-t border-gray-200 dark:border-gray-800">
              <div class="relative">
                <pre
                  class="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-all bg-gray-50 px-4 py-3 font-mono text-sm leading-relaxed dark:bg-gray-900"
                  aria-hidden="true"
                  v-html="bulkHighlighted"
                ></pre>
                <textarea
                  v-model="bulkText"
                  rows="3"
                  placeholder="KEY=value&#10;R2_ACCESS_KEY=abc123&#10;# Comments are ignored"
                  class="relative block w-full resize-none bg-transparent px-4 py-3 font-mono text-sm text-transparent placeholder-gray-400 caret-gray-900 focus:outline-none dark:placeholder-gray-500 dark:caret-white"
                  style="field-sizing: content"
                  spellcheck="false"
                />
              </div>
              <div
                class="flex items-center justify-between border-t border-gray-200 px-4 py-3 dark:border-gray-800"
              >
                <p class="text-xs text-gray-400 dark:text-gray-500">
                  One KEY=value per line. Lines starting with # are ignored.
                </p>
                <button
                  @click="saveBulk"
                  :disabled="saving"
                  class="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
                >
                  Save
                </button>
              </div>
            </div>
          </template>

          <!-- Single mode -->
          <template v-else>
            <div
              v-if="sortedVarKeys.length > 0"
              class="divide-y divide-gray-200 border-t border-gray-200 dark:divide-gray-800 dark:border-gray-800"
            >
              <div v-for="key in sortedVarKeys" :key="key" class="px-4 py-3">
                <div class="flex items-center justify-between">
                  <span
                    class="font-mono text-sm font-medium text-gray-900 dark:text-white"
                    >{{ key }}</span
                  >
                  <div class="flex items-center space-x-1">
                    <button
                      v-if="isSensitive(key)"
                      @click="toggleReveal(key)"
                      class="rounded p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    >
                      <svg
                        v-if="revealedKeys.has(key)"
                        class="h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L6.5 6.5m7.378 7.378L17.5 17.5M3 3l18 18"
                        />
                      </svg>
                      <svg
                        v-else
                        class="h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                        />
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                        />
                      </svg>
                    </button>
                    <button
                      @click="removeVar(key)"
                      class="rounded p-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400"
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
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
                <p
                  class="mt-1 truncate font-mono text-sm text-gray-500 dark:text-gray-400"
                >
                  {{
                    isSensitive(key) && !revealedKeys.has(key)
                      ? '••••••••'
                      : localVars[key]
                  }}
                </p>
              </div>
            </div>

            <div
              v-else
              class="border-t border-gray-200 px-4 py-6 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400"
            >
              No global environment variables set.
            </div>

            <!-- Add new var -->
            <div
              class="border-t border-gray-200 px-4 py-3 dark:border-gray-800"
            >
              <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  v-model="newKey"
                  type="text"
                  placeholder="KEY"
                  class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 font-mono text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500 sm:flex-1"
                  @keydown.enter="addVar"
                />
                <input
                  v-model="newValue"
                  type="text"
                  placeholder="value"
                  class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 font-mono text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500 sm:flex-1"
                  @keydown.enter="addVar"
                />
                <button
                  v-if="shouldShowGenerate(newKey)"
                  @click="generateSecret"
                  type="button"
                  class="w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800 sm:w-auto"
                >
                  Generate
                </button>
                <button
                  @click="addVar"
                  :disabled="!newKey.trim() || saving"
                  class="w-full rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100 sm:w-auto"
                >
                  Add
                </button>
              </div>
            </div>
          </template>
        </div>

        <!-- Common variables reference -->
        <div
          class="mt-8 rounded-lg border border-gray-200 dark:border-gray-800"
        >
          <div class="px-4 py-3">
            <h2 class="text-sm font-medium text-gray-900 dark:text-white">
              Common variables
            </h2>
          </div>
          <div
            class="divide-y divide-gray-200 border-t border-gray-200 dark:divide-gray-800 dark:border-gray-800"
          >
            <div class="px-4 py-3">
              <p class="text-sm font-medium text-gray-700 dark:text-gray-300">
                Cloudflare R2 / S3-Compatible Storage
              </p>
              <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                Used for file uploads and database backups
              </p>
              <div
                class="mt-2 rounded bg-gray-50 px-3 py-2 font-mono text-xs text-gray-600 dark:bg-gray-900 dark:text-gray-400"
              >
                R2_ACCESS_KEY, R2_SECRET_KEY, R2_BUCKET, R2_ENDPOINT
              </div>
            </div>
            <div class="px-4 py-3">
              <p class="text-sm font-medium text-gray-700 dark:text-gray-300">
                Email
              </p>
              <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                For transactional email via Sails Mail SMTP transport
              </p>
              <div
                class="mt-2 rounded bg-gray-50 px-3 py-2 font-mono text-xs text-gray-600 dark:bg-gray-900 dark:text-gray-400"
              >
                MAIL_HOST, MAIL_PORT, MAIL_USERNAME, MAIL_PASSWORD
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
