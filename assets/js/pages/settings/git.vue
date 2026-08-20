<script setup>
import { Link, Head, router, useForm } from '@inertiajs/vue3'
import { inject, ref, computed } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import Select from '@/components/ui/select/Select.vue'
import { useToast } from '@/composables/toast'
import { usePrecognitionValidation } from '@/composables/precognition'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  githubConfigured: Boolean,
  githubConnected: Boolean,
  githubUser: String,
  connectedRepos: Array,
  deployTokens: Array,
  projects: Array
})

const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')
const toast = useToast()

// ---- GitHub OAuth Configuration ----
const oauthForm = useForm({
  clientId: '',
  clientSecret: ''
})
  .withPrecognition('patch', '/settings/git')
  .setValidationTimeout(350)
const {
  revalidateWhenInvalid: revalidateOauthWhenInvalid,
  validateOnBlur: validateOauthOnBlur
} = usePrecognitionValidation(oauthForm)

function saveOAuthConfig() {
  if (!oauthForm.clientId.trim() || !oauthForm.clientSecret.trim()) return
  oauthForm.patch('/settings/git', {
    preserveScroll: true,
    onError: () =>
      toast({ message: 'Failed to save configuration', type: 'error' })
  })
}

// ---- GitHub Connection ----
function connectGithub() {
  window.location.href = '/auth/github'
}

// ---- Deploy Tokens ----
const showCreateToken = ref(false)
const newToken = useForm({
  name: '',
  projectId: '',
  scopes: ['deploy']
})
  .withPrecognition('post', '/api/v1/deploy-tokens')
  .setValidationTimeout(350)
const {
  applyResponseProblems: applyTokenProblems,
  revalidateWhenInvalid: revalidateTokenWhenInvalid,
  validateOnBlur: validateTokenOnBlur
} = usePrecognitionValidation(newToken)
const createdToken = ref(null)
const creatingToken = ref(false)

async function createToken() {
  if (!newToken.name.trim() || creatingToken.value) return
  creatingToken.value = true
  newToken.clearErrors()

  try {
    const res = await fetch('/api/v1/deploy-tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newToken.name.trim(),
        projectId: newToken.projectId || undefined,
        scopes: newToken.scopes
      })
    })

    const data = await res.json()
    if (res.ok) {
      createdToken.value = data.token
      newToken.reset()
      toast({ message: 'Deploy token created', type: 'success' })
    } else {
      if (!applyTokenProblems(data.problems)) {
        toast({ message: 'Failed to create token', type: 'error' })
      }
    }
  } catch (err) {
    toast({ message: 'Failed to create token', type: 'error' })
  } finally {
    creatingToken.value = false
  }
}

function closeTokenModal() {
  showCreateToken.value = false
  createdToken.value = null
  router.reload({ only: ['deployTokens'] })
}

function copyToken() {
  navigator.clipboard.writeText(createdToken.value)
}

// Revoke token
const revokingTokenId = ref(null)

function confirmRevokeToken(token) {
  revokingTokenId.value = token.id
}

async function executeRevokeToken() {
  try {
    await fetch(`/api/v1/deploy-tokens/${revokingTokenId.value}`, {
      method: 'DELETE'
    })
    revokingTokenId.value = null
    router.reload({ only: ['deployTokens'] })
    toast({ message: 'Deploy token revoked', type: 'success' })
  } catch (err) {
    toast({ message: 'Failed to revoke token', type: 'error' })
  }
}

// ---- Computed ----
const serverUrl = computed(() =>
  typeof window !== 'undefined' ? window.location.origin : ''
)

// ---- Helpers ----
function timeAgo(date) {
  if (!date) return 'Never'
  const seconds = Math.floor((Date.now() - date) / 1000)
  const intervals = [
    { label: 'year', seconds: 31536000 },
    { label: 'month', seconds: 2592000 },
    { label: 'week', seconds: 604800 },
    { label: 'day', seconds: 86400 },
    { label: 'hour', seconds: 3600 },
    { label: 'minute', seconds: 60 }
  ]
  for (const interval of intervals) {
    const count = Math.floor(seconds / interval.seconds)
    if (count >= 1)
      return `${count} ${interval.label}${count > 1 ? 's' : ''} ago`
  }
  return 'just now'
}
</script>

<template>
  <Head title="Git | Slipway" />

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
            >settings</Link
          >
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <span class="font-medium text-gray-900 dark:text-white">git</span>
        </nav>
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
      <div class="mx-auto max-w-4xl space-y-8">
        <!-- GitHub OAuth Configuration (shown when not configured) -->
        <section v-if="!githubConfigured">
          <h2 class="text-lg font-medium text-gray-900 dark:text-white">
            GitHub OAuth Setup
          </h2>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Configure GitHub OAuth to enable push-to-deploy.
            <a
              href="https://github.com/settings/developers"
              target="_blank"
              class="text-brand hover:underline"
              >Create an OAuth App</a
            >
            first.
          </p>

          <div class="mt-4">
            <div
              class="mb-4 rounded-md border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-900/20"
            >
              <p class="text-xs text-blue-800 dark:text-blue-300">
                <strong>Callback URL:</strong>
                <code
                  class="ml-1 rounded bg-blue-100 px-1.5 py-0.5 font-mono dark:bg-blue-800/50"
                  >{{ serverUrl }}/auth/github/callback</code
                >
              </p>
            </div>

            <form @submit.prevent="saveOAuthConfig" class="space-y-4">
              <div>
                <label
                  class="block text-sm font-medium text-gray-700 dark:text-gray-300"
                  >Client ID</label
                >
                <input
                  v-model="oauthForm.clientId"
                  type="text"
                  placeholder="Ov23li..."
                  :aria-invalid="oauthForm.invalid('clientId')"
                  :aria-describedby="
                    oauthForm.errors.clientId ? 'github-client-id-error' : null
                  "
                  class="focus:border-brand mt-1 w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
                  required
                  @blur="validateOauthOnBlur('clientId', $event)"
                  @input="revalidateOauthWhenInvalid('clientId')"
                />
                <p
                  v-if="oauthForm.errors.clientId"
                  id="github-client-id-error"
                  class="mt-1 text-sm text-red-600 dark:text-red-400"
                >
                  {{ oauthForm.errors.clientId }}
                </p>
              </div>

              <div>
                <label
                  class="block text-sm font-medium text-gray-700 dark:text-gray-300"
                  >Client Secret</label
                >
                <input
                  v-model="oauthForm.clientSecret"
                  type="password"
                  placeholder="••••••••••••••••"
                  :aria-invalid="oauthForm.invalid('clientSecret')"
                  :aria-describedby="
                    oauthForm.errors.clientSecret
                      ? 'github-client-secret-error'
                      : null
                  "
                  class="focus:border-brand mt-1 w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
                  required
                  @blur="validateOauthOnBlur('clientSecret', $event)"
                  @input="revalidateOauthWhenInvalid('clientSecret')"
                />
                <p
                  v-if="oauthForm.errors.clientSecret"
                  id="github-client-secret-error"
                  class="mt-1 text-sm text-red-600 dark:text-red-400"
                >
                  {{ oauthForm.errors.clientSecret }}
                </p>
              </div>

              <div class="pt-2">
                <button
                  type="submit"
                  :disabled="
                    !oauthForm.clientId.trim() ||
                    !oauthForm.clientSecret.trim() ||
                    oauthForm.hasErrors ||
                    oauthForm.processing
                  "
                  class="rounded-md bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
                >
                  {{
                    oauthForm.processing ? 'Saving...' : 'Save Configuration'
                  }}
                </button>
              </div>
            </form>
          </div>
        </section>

        <!-- GitHub Connection (shown when configured) -->
        <section v-else>
          <h2 class="text-lg font-medium text-gray-900 dark:text-white">
            GitHub
          </h2>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Connect your GitHub account to enable push-to-deploy.
          </p>

          <div class="mt-4">
            <div
              v-if="githubConnected"
              class="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-900"
            >
              <div class="flex items-center space-x-3">
                <svg
                  class="h-6 w-6 text-gray-900 dark:text-white"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path
                    d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
                  />
                </svg>
                <div>
                  <p class="text-sm font-medium text-gray-900 dark:text-white">
                    Connected as {{ githubUser }}
                  </p>
                  <p class="text-xs text-gray-500 dark:text-gray-400">
                    Push to deploy is enabled
                  </p>
                </div>
              </div>
              <span
                class="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400"
              >
                Connected
              </span>
            </div>
            <button
              v-else
              @click="connectGithub"
              class="flex items-center space-x-2 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-900 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:hover:bg-gray-800"
            >
              <svg class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                <path
                  d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
                />
              </svg>
              <span>Connect GitHub</span>
            </button>
          </div>
        </section>

        <!-- Connected Repositories -->
        <section v-if="githubConfigured && githubConnected">
          <div class="flex items-center justify-between">
            <div>
              <h2 class="text-lg font-medium text-gray-900 dark:text-white">
                Connected Repositories
              </h2>
              <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Repositories linked for push-to-deploy.
              </p>
            </div>
          </div>

          <div class="mt-4">
            <div v-if="connectedRepos.length > 0" class="space-y-2">
              <div
                v-for="repo in connectedRepos"
                :key="repo.id"
                class="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-900"
              >
                <div class="flex items-center space-x-3">
                  <svg
                    v-if="repo.isPrivate"
                    class="h-4 w-4 text-gray-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
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
                      d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                    />
                  </svg>
                  <div>
                    <p
                      class="text-sm font-medium text-gray-900 dark:text-white"
                    >
                      {{ repo.fullName }}
                    </p>
                    <p class="text-xs text-gray-500 dark:text-gray-400">
                      {{ repo.defaultBranch }} →
                      {{ repo.environment?.slug || 'unlinked' }}
                    </p>
                  </div>
                </div>
                <div class="flex items-center space-x-2">
                  <span
                    v-if="repo.webhookActive"
                    class="text-xs text-green-600 dark:text-green-400"
                    >Auto-deploy</span
                  >
                  <span v-else class="text-xs text-gray-400">Manual</span>
                </div>
              </div>
            </div>
            <div
              v-else
              class="rounded-lg border border-dashed border-gray-300 px-6 py-8 text-center dark:border-gray-700"
            >
              <p class="text-sm text-gray-500 dark:text-gray-400">
                No repositories connected yet.
              </p>
              <p class="mt-1 text-xs text-gray-400 dark:text-gray-500">
                Connect a repository from your project's settings.
              </p>
            </div>
          </div>
        </section>

        <!-- Deploy Tokens -->
        <section>
          <div class="flex items-center justify-between">
            <div>
              <h2 class="text-lg font-medium text-gray-900 dark:text-white">
                Deploy Tokens
              </h2>
              <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                API tokens for CI/CD deployments.
              </p>
            </div>
            <button
              @click="showCreateToken = true"
              class="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
            >
              Create token
            </button>
          </div>

          <div class="mt-4">
            <div
              v-if="deployTokens.length > 0"
              class="rounded-lg border border-gray-200 dark:border-gray-700"
            >
              <div class="divide-y divide-gray-200 dark:divide-gray-700">
                <div
                  v-for="token in deployTokens"
                  :key="token.id"
                  class="flex items-center justify-between bg-white px-4 py-3 first:rounded-t-lg last:rounded-b-lg dark:bg-gray-900"
                >
                  <div class="flex items-center space-x-3">
                    <svg
                      class="h-4 w-4 text-amber-500"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
                      />
                    </svg>
                    <div>
                      <p
                        class="text-sm font-medium text-gray-900 dark:text-white"
                      >
                        {{ token.name }}
                      </p>
                      <p class="text-xs text-gray-500 dark:text-gray-400">
                        <code>{{ token.tokenPrefix }}••••••••</code>
                        <span v-if="token.project" class="ml-2"
                          >• {{ token.project.name }}</span
                        >
                        <span class="ml-2"
                          >• Used {{ token.usageCount }} times</span
                        >
                      </p>
                    </div>
                  </div>
                  <div class="flex items-center space-x-3">
                    <span class="text-xs text-gray-400">{{
                      timeAgo(token.lastUsedAt)
                    }}</span>
                    <button
                      @click="confirmRevokeToken(token)"
                      class="text-xs text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                    >
                      Revoke
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div
              v-else
              class="rounded-lg border border-dashed border-gray-300 px-6 py-8 text-center dark:border-gray-700"
            >
              <svg
                class="mx-auto h-8 w-8 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.5"
                  d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
                />
              </svg>
              <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
                No deploy tokens yet.
              </p>
              <p class="mt-1 text-xs text-gray-400 dark:text-gray-500">
                Create a token to use in your CI/CD pipeline.
              </p>
            </div>
          </div>
        </section>

        <!-- Usage Example -->
        <section>
          <h3 class="text-sm font-medium text-gray-900 dark:text-white">
            GitHub Actions Example
          </h3>
          <pre
            class="mt-3 overflow-x-auto rounded-lg bg-gray-100 p-4 font-mono text-xs text-gray-700 dark:bg-gray-900 dark:text-gray-300"
          ><code># .github/workflows/deploy.yml
name: Deploy to Slipway

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Deploy to Slipway
        run: npx slipway slide
        env:
          SLIPWAY_TOKEN: $&#123;&#123; secrets.SLIPWAY_TOKEN &#125;&#125;
          SLIPWAY_SERVER: {{ serverUrl }}</code></pre>
        </section>
      </div>
    </div>

    <!-- Create Token Modal -->
    <Teleport to="body">
      <Transition
        enter-active-class="duration-200 ease-out"
        enter-from-class="opacity-0"
        enter-to-class="opacity-100"
        leave-active-class="duration-150 ease-in"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
      >
        <div
          v-if="showCreateToken"
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          @click.self="closeTokenModal"
        >
          <div
            class="w-full max-w-md rounded-lg border border-gray-200 bg-white p-6 shadow-xl dark:border-gray-700 dark:bg-gray-900"
          >
            <h3 class="text-lg font-medium text-gray-900 dark:text-white">
              {{ createdToken ? 'Token Created' : 'Create Deploy Token' }}
            </h3>

            <div v-if="createdToken" class="mt-4">
              <p class="text-sm text-gray-500 dark:text-gray-400">
                Copy this token now. You won't be able to see it again.
              </p>
              <div class="mt-3 flex items-center space-x-2">
                <code
                  class="flex-1 overflow-x-auto rounded-md border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                >
                  {{ createdToken }}
                </code>
                <button
                  @click="copyToken"
                  class="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
                >
                  Copy
                </button>
              </div>
              <button
                @click="closeTokenModal"
                class="mt-4 w-full text-sm font-medium text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
              >
                Done
              </button>
            </div>

            <form v-else @submit.prevent="createToken" class="mt-4 space-y-4">
              <div>
                <label
                  class="block text-sm font-medium text-gray-700 dark:text-gray-300"
                  >Name</label
                >
                <input
                  v-model="newToken.name"
                  type="text"
                  placeholder="e.g., GitHub Actions"
                  :aria-invalid="newToken.invalid('name')"
                  :aria-describedby="
                    newToken.errors.name ? 'deploy-token-name-error' : null
                  "
                  class="focus:border-brand mt-1 w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
                  required
                  @blur="validateTokenOnBlur('name', $event)"
                  @input="revalidateTokenWhenInvalid('name')"
                />
                <p
                  v-if="newToken.errors.name"
                  id="deploy-token-name-error"
                  class="mt-1 text-sm text-red-600 dark:text-red-400"
                >
                  {{ newToken.errors.name }}
                </p>
              </div>

              <div>
                <label
                  class="block text-sm font-medium text-gray-700 dark:text-gray-300"
                  >Scope (optional)</label
                >
                <Select
                  v-model="newToken.projectId"
                  :options="[
                    { value: '', label: 'All projects' },
                    ...projects.map((project) => ({
                      value: project.id,
                      label: project.name
                    }))
                  ]"
                  class="focus:border-brand mt-1 w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 focus:outline-none dark:border-gray-700 dark:bg-transparent dark:text-white"
                />
              </div>

              <div class="flex justify-end space-x-3 pt-2">
                <button
                  type="button"
                  @click="closeTokenModal"
                  class="px-3 py-1.5 text-sm font-medium text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  :disabled="
                    !newToken.name.trim() || newToken.hasErrors || creatingToken
                  "
                  class="rounded-md bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
                >
                  {{ creatingToken ? 'Creating...' : 'Create' }}
                </button>
              </div>
            </form>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Revoke Token Confirmation -->
    <ConfirmModal
      v-if="revokingTokenId"
      title="Revoke deploy token"
      message="This will permanently revoke this token. Any CI/CD pipelines using it will fail."
      confirm-label="Revoke token"
      :destructive="true"
      @confirm="executeRevokeToken"
      @cancel="revokingTokenId = null"
    />
  </div>
</template>
