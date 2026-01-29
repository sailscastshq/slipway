<script setup>
import { Link, Head, router } from '@inertiajs/vue3'
import { inject, ref } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  project: Object,
  environments: Array
})

const toggleMobileMenu = inject('toggleMobileMenu')
const deploying = ref(null)

function statusBadge(env) {
  if (!env.app) return { label: 'Not deployed', color: 'gray' }
  const map = {
    running: { label: 'Running', color: 'green' },
    building: { label: 'Building', color: 'blue' },
    deploying: { label: 'Deploying', color: 'blue' },
    starting: { label: 'Starting', color: 'yellow' },
    stopped: { label: 'Stopped', color: 'gray' },
    failed: { label: 'Failed', color: 'red' }
  }
  return map[env.app.status] || { label: env.app.status, color: 'gray' }
}

function badgeClasses(color) {
  const map = {
    green: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    yellow: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    red: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    gray: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
  }
  return map[color] || map.gray
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

async function triggerDeploy(env) {
  if (deploying.value) return
  deploying.value = env.id

  try {
    const res = await fetch(`/api/v1/projects/${props.project.slug}/environments/${env.slug}/deploy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    })
    const data = await res.json()
    if (data.deployment) {
      router.visit(`/projects/${props.project.slug}/deployments/${data.deployment.id}`)
    }
  } catch {
    deploying.value = null
  }
}
</script>
<template>
  <Head :title="`${project.name} | Slipway`"></Head>
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
            projects
          </Link>
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <span class="font-medium text-gray-900 dark:text-white">{{ project.name.toLowerCase() }}</span>
        </nav>
      </div>
      <div class="flex items-center space-x-3">
        <Link
          :href="`/projects/${project.slug}/settings`"
          class="text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
        >
          Settings
        </Link>
        <a
          href="https://docs.sailscasts.com/slipway"
          target="_blank"
          class="text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
        >
          Docs
        </a>
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 px-4 py-6 sm:px-8 sm:py-8">
      <div class="mx-auto max-w-6xl">
        <!-- Project Info -->
        <div class="mb-8">
          <h1 class="text-xl font-semibold text-gray-900 dark:text-white">{{ project.name }}</h1>
          <p v-if="project.description" class="mt-1 text-sm text-gray-500 dark:text-gray-400">{{ project.description }}</p>
          <div v-if="project.repositoryUrl" class="mt-2">
            <a
              :href="project.repositoryUrl"
              target="_blank"
              class="inline-flex items-center space-x-1 text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
            >
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              <span>Repository</span>
            </a>
          </div>
        </div>

        <!-- Environments -->
        <div class="mb-6 flex items-center justify-between">
          <h2 class="text-sm font-medium text-gray-900 dark:text-white">Environments</h2>
        </div>

        <div v-if="environments.length > 0" class="rounded-lg border border-gray-200 dark:border-gray-800">
          <!-- Table Header -->
          <div class="grid grid-cols-12 gap-4 rounded-t-lg border-b border-gray-200 bg-gray-50/50 px-6 py-2 text-xs font-medium text-gray-500 dark:border-gray-800 dark:bg-gray-900/50">
            <div class="col-span-3">Environment</div>
            <div class="col-span-2">Status</div>
            <div class="col-span-3">Domain</div>
            <div class="col-span-2">Last deployed</div>
            <div class="col-span-2 text-right">Actions</div>
          </div>

          <!-- Table Body -->
          <div class="divide-y divide-gray-200 rounded-b-lg bg-white dark:divide-gray-800 dark:bg-gray-950">
            <div
              v-for="env in environments"
              :key="env.id"
              class="grid grid-cols-12 items-center gap-4 px-6 py-4"
            >
              <div class="col-span-3">
                <Link
                  :href="`/projects/${project.slug}/environments/${env.slug}`"
                  class="font-medium text-gray-900 underline decoration-dashed decoration-gray-300 underline-offset-2 hover:text-gray-700 dark:text-white dark:decoration-gray-600 dark:hover:text-gray-300"
                >
                  {{ env.name }}
                </Link>
                <span
                  v-if="env.isProduction"
                  class="ml-2 inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                >
                  Production
                </span>
              </div>
              <div class="col-span-2">
                <span
                  :class="['inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium', badgeClasses(statusBadge(env).color)]"
                >
                  {{ statusBadge(env).label }}
                </span>
              </div>
              <div class="col-span-3">
                <span class="text-sm text-gray-500 dark:text-gray-400">{{ env.fullDomain }}</span>
                <a
                  v-if="env.app && env.app.hostPort && env.app.status === 'running'"
                  :href="`http://localhost:${env.app.hostPort}`"
                  target="_blank"
                  class="mt-0.5 flex items-center space-x-1 font-mono text-xs text-emerald-600 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300"
                >
                  <span>localhost:{{ env.app.hostPort }}</span>
                  <svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              </div>
              <div class="col-span-2">
                <span class="text-sm text-gray-500 dark:text-gray-400">
                  {{ env.app?.lastDeployedAt ? timeAgo(env.app.lastDeployedAt) : 'Never' }}
                </span>
              </div>
              <div class="col-span-2 flex justify-end">
                <button
                  @click="triggerDeploy(env)"
                  :disabled="deploying === env.id"
                  class="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
                >
                  {{ deploying === env.id ? 'Deploying...' : 'Deploy' }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Empty state -->
        <div v-else class="rounded-lg border border-dashed border-gray-300 px-6 py-12 text-center dark:border-gray-700">
          <p class="text-sm text-gray-500 dark:text-gray-400">No environments yet.</p>
          <p class="mt-1 text-sm text-gray-400 dark:text-gray-500">
            Create one via the CLI: <code class="rounded bg-gray-100 px-1.5 py-0.5 text-xs dark:bg-gray-800">slipway env:create</code>
          </p>
        </div>

        <!-- Recent Deployments -->
        <div v-if="environments.some(e => e.deployments.length > 0)" class="mt-10">
          <h2 class="mb-4 text-sm font-medium text-gray-900 dark:text-white">Recent deployments</h2>
          <div class="rounded-lg border border-gray-200 dark:border-gray-800">
            <div class="divide-y divide-gray-200 bg-white dark:divide-gray-800 dark:bg-gray-950 rounded-lg">
              <template v-for="env in environments" :key="'deploys-' + env.id">
                <Link
                  v-for="dep in env.deployments.slice(0, 3)"
                  :key="dep.id"
                  :href="`/projects/${project.slug}/deployments/${dep.id}`"
                  class="flex items-center justify-between px-6 py-3 hover:bg-gray-50 dark:hover:bg-gray-900/50"
                >
                  <div class="flex items-center space-x-3">
                    <span
                      :class="[
                        'h-2 w-2 rounded-full',
                        dep.status === 'running' ? 'bg-green-500' :
                        dep.status === 'failed' ? 'bg-red-500' :
                        dep.status === 'building' || dep.status === 'deploying' ? 'bg-blue-500' :
                        'bg-gray-400'
                      ]"
                    ></span>
                    <span class="text-sm text-gray-900 dark:text-white">{{ env.name }}</span>
                    <span v-if="dep.gitBranch" class="text-xs text-gray-500 dark:text-gray-400">
                      {{ dep.gitBranch }}
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
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
