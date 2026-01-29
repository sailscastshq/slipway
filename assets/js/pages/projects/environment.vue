<script setup>
import { Link, Head, router } from '@inertiajs/vue3'
import { inject, ref, reactive } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'
import SlideToDeploy from '@/components/SlideToDeploy.vue'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  project: Object,
  environment: Object,
  app: Object,
  envVars: Object,
  deployments: Array
})

const toggleMobileMenu = inject('toggleMobileMenu')

// Env vars management
const localVars = reactive({ ...props.envVars })
const revealedKeys = ref(new Set())
const newKey = ref('')
const newValue = ref('')
const saving = ref(false)
const deploying = ref(false)
const slideRef = ref(null)

const sensitivePatterns = ['PASSWORD', 'SECRET', 'KEY', 'TOKEN', 'PRIVATE', 'CREDENTIAL', 'AUTH', 'API_KEY', 'APIKEY']

function isSensitive(key) {
  const upper = key.toUpperCase()
  return sensitivePatterns.some(p => upper.includes(p))
}

function toggleReveal(key) {
  if (revealedKeys.value.has(key)) {
    revealedKeys.value.delete(key)
  } else {
    revealedKeys.value.add(key)
  }
}

async function saveEnvVars(vars) {
  saving.value = true
  try {
    await fetch(`/api/v1/projects/${props.project.slug}/environments/${props.environment.slug}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ envVars: vars })
    })
    router.reload({ only: ['envVars', 'environment'] })
  } finally {
    saving.value = false
  }
}

function addVar() {
  if (!newKey.value.trim()) return
  localVars[newKey.value.trim()] = newValue.value
  saveEnvVars(localVars)
  newKey.value = ''
  newValue.value = ''
}

function removeVar(key) {
  delete localVars[key]
  saveEnvVars(localVars)
}

function statusBadge(status) {
  const map = {
    running: { label: 'Running', classes: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
    building: { label: 'Building', classes: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
    deploying: { label: 'Deploying', classes: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
    pending: { label: 'Pending', classes: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' },
    failed: { label: 'Failed', classes: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
    cancelled: { label: 'Cancelled', classes: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' }
  }
  return map[status] || { label: status, classes: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' }
}

function timeAgo(date) {
  if (!date) return 'Never'
  const seconds = Math.floor((new Date() - new Date(date)) / 1000)
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
    if (count >= 1) return `${count} ${interval.label}${count > 1 ? 's' : ''} ago`
  }
  return 'just now'
}

async function triggerDeploy() {
  if (deploying.value) return
  deploying.value = true
  try {
    const res = await fetch(`/api/v1/projects/${props.project.slug}/environments/${props.environment.slug}/deploy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    })
    const data = await res.json()
    if (data.deployment) {
      router.visit(`/projects/${props.project.slug}/deployments/${data.deployment.id}`)
    } else {
      slideRef.value?.reset()
      deploying.value = false
    }
  } catch {
    slideRef.value?.reset()
    deploying.value = false
  }
}

const sortedVarKeys = Object.keys(props.envVars).sort()
</script>
<template>
  <Head :title="`${environment.name} - ${project.name} | Slipway`"></Head>
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
        <nav class="flex items-center space-x-2 text-sm">
          <Link href="/" class="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">
            Projects
          </Link>
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <Link
            :href="`/projects/${project.slug}`"
            class="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >
            {{ project.name }}
          </Link>
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <span class="font-medium text-gray-900 dark:text-white">{{ environment.name }}</span>
        </nav>
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
      <div class="mx-auto max-w-4xl">
        <!-- Environment Info -->
        <div class="mb-8 flex items-start justify-between">
          <div>
            <div class="flex items-center space-x-3">
              <h1 class="text-xl font-semibold text-gray-900 dark:text-white">{{ environment.name }}</h1>
              <span
                v-if="environment.isProduction"
                class="inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
              >
                Production
              </span>
            </div>
            <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">{{ environment.fullDomain }}</p>
            <div v-if="app && app.hostPort && app.status === 'running'" class="mt-2 flex items-center space-x-2">
              <span class="inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-900/20 dark:text-emerald-400 dark:ring-emerald-500/30">
                Local
              </span>
              <a
                :href="`http://localhost:${app.hostPort}`"
                target="_blank"
                class="inline-flex items-center space-x-1 font-mono text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
              >
                <span>http://localhost:{{ app.hostPort }}</span>
                <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            </div>
          </div>
          <div v-if="app">
            <span :class="['inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium', statusBadge(app.status).classes]">
              {{ statusBadge(app.status).label }}
            </span>
          </div>
        </div>

        <!-- Slide to Deploy -->
        <div class="mb-10">
          <SlideToDeploy
            ref="slideRef"
            :is-production="environment.isProduction"
            :disabled="deploying"
            @deploy="triggerDeploy"
          />
        </div>

        <!-- Environment Variables -->
        <div class="mb-10">
          <h2 class="mb-4 text-sm font-medium text-gray-900 dark:text-white">Environment variables</h2>

          <div class="rounded-lg border border-gray-200 dark:border-gray-800">
            <!-- Existing vars -->
            <div v-if="sortedVarKeys.length > 0" class="divide-y divide-gray-200 dark:divide-gray-800">
              <div
                v-for="key in sortedVarKeys"
                :key="key"
                class="flex items-center justify-between px-4 py-3"
              >
                <div class="flex min-w-0 flex-1 items-center space-x-3">
                  <span class="font-mono text-sm font-medium text-gray-900 dark:text-white">{{ key }}</span>
                  <span class="text-gray-400 dark:text-gray-600">=</span>
                  <span class="min-w-0 truncate font-mono text-sm text-gray-500 dark:text-gray-400">
                    {{ isSensitive(key) && !revealedKeys.has(key) ? '••••••••' : envVars[key] }}
                  </span>
                </div>
                <div class="flex items-center space-x-2">
                  <button
                    v-if="isSensitive(key)"
                    @click="toggleReveal(key)"
                    class="rounded p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  >
                    <svg v-if="revealedKeys.has(key)" class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L6.5 6.5m7.378 7.378L17.5 17.5M3 3l18 18" />
                    </svg>
                    <svg v-else class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  </button>
                  <button
                    @click="removeVar(key)"
                    class="rounded p-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400"
                  >
                    <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            <!-- Empty state -->
            <div v-else class="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
              No environment variables set.
            </div>

            <!-- Add new var -->
            <div class="border-t border-gray-200 px-4 py-3 dark:border-gray-800">
              <div class="flex items-center space-x-2">
                <input
                  v-model="newKey"
                  type="text"
                  placeholder="KEY"
                  class="w-40 rounded-md border border-gray-200 bg-white px-3 py-1.5 font-mono text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:placeholder-gray-500"
                  @keydown.enter="addVar"
                />
                <span class="text-gray-400">=</span>
                <input
                  v-model="newValue"
                  type="text"
                  placeholder="value"
                  class="flex-1 rounded-md border border-gray-200 bg-white px-3 py-1.5 font-mono text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:placeholder-gray-500"
                  @keydown.enter="addVar"
                />
                <button
                  @click="addVar"
                  :disabled="!newKey.trim() || saving"
                  class="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
                >
                  Add
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Services -->
        <div v-if="environment.services && environment.services.length > 0" class="mb-10">
          <h2 class="mb-4 text-sm font-medium text-gray-900 dark:text-white">Services</h2>
          <div class="rounded-lg border border-gray-200 dark:border-gray-800">
            <div class="divide-y divide-gray-200 dark:divide-gray-800">
              <div
                v-for="service in environment.services"
                :key="service.id"
                class="flex items-center justify-between px-4 py-3"
              >
                <div class="flex items-center space-x-3">
                  <span class="text-sm font-medium text-gray-900 dark:text-white">{{ service.name }}</span>
                  <span class="text-xs text-gray-500 dark:text-gray-400">{{ service.type }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Deployments -->
        <div>
          <h2 class="mb-4 text-sm font-medium text-gray-900 dark:text-white">Deployments</h2>

          <div v-if="deployments.length > 0" class="rounded-lg border border-gray-200 dark:border-gray-800">
            <div class="divide-y divide-gray-200 bg-white dark:divide-gray-800 dark:bg-gray-950 rounded-lg">
              <Link
                v-for="dep in deployments"
                :key="dep.id"
                :href="`/projects/${project.slug}/deployments/${dep.id}`"
                class="flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-900/50"
              >
                <div class="flex items-center space-x-3">
                  <span
                    :class="[
                      'h-2 w-2 rounded-full',
                      dep.status === 'running' ? 'bg-green-500' :
                      dep.status === 'failed' ? 'bg-red-500' :
                      dep.status === 'building' || dep.status === 'deploying' ? 'bg-blue-500' :
                      dep.status === 'cancelled' ? 'bg-gray-400' :
                      'bg-yellow-500'
                    ]"
                  ></span>
                  <span :class="['inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium', statusBadge(dep.status).classes]">
                    {{ statusBadge(dep.status).label }}
                  </span>
                  <span v-if="dep.gitBranch" class="text-xs text-gray-500 dark:text-gray-400">
                    {{ dep.gitBranch }}
                  </span>
                  <span v-if="dep.gitCommit" class="font-mono text-xs text-gray-400 dark:text-gray-500">
                    {{ dep.gitCommit.slice(0, 7) }}
                  </span>
                </div>
                <div class="flex items-center space-x-4">
                  <span class="text-xs text-gray-500 dark:text-gray-400">
                    {{ dep.triggeredBy?.fullName || 'System' }}
                  </span>
                  <span class="text-xs text-gray-400 dark:text-gray-500">
                    {{ timeAgo(dep.createdAt) }}
                  </span>
                </div>
              </Link>
            </div>
          </div>

          <div v-else class="rounded-lg border border-dashed border-gray-300 px-6 py-8 text-center dark:border-gray-700">
            <p class="text-sm text-gray-500 dark:text-gray-400">No deployments yet.</p>
            <p class="mt-1 text-sm text-gray-400 dark:text-gray-500">
              Slide to deploy your first version.
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
