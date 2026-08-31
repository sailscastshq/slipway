<script setup>
import SidebarOpen from '@/components/ui/icons/SidebarOpen.vue'
import SidebarClose from '@/components/ui/icons/SidebarClose.vue'
import ExternalLink from '@/components/ui/icons/ExternalLink.vue'
import ChevronRight from '@/components/ui/icons/ChevronRight.vue'
import { Link, Head } from '@inertiajs/vue3'
import { inject } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'
import DeploymentHistory from '@/components/DeploymentHistory.vue'
import Badge from '@/components/ui/badge/Badge.vue'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  project: Object,
  environments: Array,
  deploymentHistory: Object
})

const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')

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
    green:
      'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    yellow:
      'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
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
    if (count >= 1)
      return `${count} ${interval.label}${count > 1 ? 's' : ''} ago`
  }
  return 'just now'
}
</script>
<template>
  <Head :title="`${project.name} | Slipway`"></Head>
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
        <nav class="flex items-center space-x-2 text-sm">
          <Link
            href="/"
            class="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >
            projects
          </Link>
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <span class="font-medium text-gray-900 dark:text-white">{{
            project.name.toLowerCase()
          }}</span>
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
    <div class="flex-1 px-4 py-6 sm:px-8 sm:py-8">
      <div class="mx-auto max-w-6xl">
        <!-- Project Info -->
        <div class="mb-8">
          <h1 class="text-xl font-semibold text-gray-900 dark:text-white">
            {{ project.name }}
          </h1>
          <p
            v-if="project.description"
            class="mt-1 text-sm text-gray-500 dark:text-gray-400"
          >
            {{ project.description }}
          </p>
          <div v-if="project.repositoryUrl" class="mt-2">
            <a
              :href="project.repositoryUrl"
              target="_blank"
              class="inline-flex items-center space-x-1 text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
            >
              <ExternalLink class="h-4 w-4" stroke-width="2" />
              <span>Repository</span>
            </a>
          </div>
        </div>

        <!-- Environments -->
        <div class="mb-6 flex items-center justify-between">
          <h2 class="text-sm font-medium text-gray-900 dark:text-white">
            Environments
          </h2>
          <Link
            :href="`/projects/${project.slug}/environments/new`"
            class="flex items-center space-x-1 rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
          >
            Create environment
          </Link>
        </div>

        <div
          v-if="environments.length > 0"
          class="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-950"
        >
          <Link
            v-for="env in environments"
            :key="env.id"
            :href="`/projects/${project.slug}/environments/${env.slug}`"
            class="flex items-center justify-between px-6 py-4 hover:bg-gray-50 dark:hover:bg-gray-900/50"
          >
            <div class="flex items-center space-x-3">
              <span class="font-medium text-gray-900 dark:text-white">{{
                env.name
              }}</span>
              <Badge
                v-if="env.isProduction"
                class="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
              >
                Production
              </Badge>
              <Badge
                :class="[
                  'rounded-md px-2 py-0.5 text-xs',
                  badgeClasses(statusBadge(env).color)
                ]"
              >
                {{ statusBadge(env).label }}
              </Badge>
            </div>
            <div class="flex items-center space-x-4">
              <span class="text-sm text-gray-500 dark:text-gray-400">
                {{
                  env.app?.lastDeployedAt
                    ? timeAgo(env.app.lastDeployedAt)
                    : 'Never deployed'
                }}
              </span>
              <ChevronRight class="h-4 w-4 text-gray-400" stroke-width="2" />
            </div>
          </Link>
        </div>

        <!-- Empty state -->
        <div
          v-else
          class="rounded-lg border border-dashed border-gray-300 px-6 py-12 text-center dark:border-gray-700"
        >
          <p class="text-sm text-gray-500 dark:text-gray-400">
            No environments yet.
          </p>
          <p class="mt-1 text-sm text-gray-400 dark:text-gray-500">
            Create one from the dashboard or run
            <code
              class="rounded bg-gray-100 px-1.5 py-0.5 text-xs dark:bg-gray-800"
              >slipway env:create</code
            >
          </p>
        </div>

        <DeploymentHistory
          class="mt-10"
          :history="deploymentHistory"
          title="Recent deployments"
          show-environment
          :show-status="false"
          hide-when-empty
        />
      </div>
    </div>
  </div>
</template>
