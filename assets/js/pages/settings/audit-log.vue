<script setup>
import { Link, Head, router } from '@inertiajs/vue3'
import { inject, computed } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  logs: Array,
  pagination: Object
})

const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')

const actionLabels = {
  'deployment.triggered': 'Triggered deployment',
  'backup.created': 'Created backup',
  'service.created': 'Created service',
  'service.destroyed': 'Destroyed service',
  'environment.updated': 'Updated environment',
  'project.destroyed': 'Destroyed project',
  'settings.updated': 'Updated settings'
}

function actionLabel(action) {
  return actionLabels[action] || action
}

function actionColor(action) {
  if (action.includes('destroy')) return 'text-red-600 dark:text-red-400'
  if (action.includes('created') || action.includes('triggered')) return 'text-green-600 dark:text-green-400'
  return 'text-blue-600 dark:text-blue-400'
}

function formatTime(date) {
  return new Date(date).toLocaleString()
}

function goToPage(page) {
  router.get('/settings/audit-log', { page }, { preserveState: true })
}
</script>
<template>
  <Head title="Audit Log | Slipway"></Head>
  <div class="flex h-full flex-col">
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-gray-200 py-4 pl-4 pr-4 dark:border-gray-800 sm:pl-4 sm:pr-8">
      <div class="flex items-center space-x-3">
        <button
          @click="toggleMobileMenu"
          class="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white md:hidden"
        >
          <svg class="h-5 w-5" viewBox="-0.5 -0.5 16 16" fill="none" stroke="currentColor">
            <path d="M12.777 14.285H2.223c-.833 0-1.508-.675-1.508-1.508V2.223c0-.833.675-1.508 1.508-1.508h10.554c.833 0 1.508.675 1.508 1.508v10.554c0 .833-.675 1.508-1.508 1.508Z" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" />
            <path d="M5.615 14.285V.715" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" />
            <path d="M2.6 5.992 3.919 7.5 2.6 9.008" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" />
          </svg>
        </button>
        <button
          @click="toggleSidebar"
          class="hidden text-gray-400 dark:text-gray-500 md:block"
        >
          <svg v-if="sidebarCollapsed" class="h-5 w-5" viewBox="-0.5 -0.5 16 16" fill="none" stroke="currentColor">
            <path d="M12.777 14.285H2.223c-.833 0-1.508-.675-1.508-1.508V2.223c0-.833.675-1.508 1.508-1.508h10.554c.833 0 1.508.675 1.508 1.508v10.554c0 .833-.675 1.508-1.508 1.508Z" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" />
            <path d="M5.615 14.285V.715" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" />
            <path d="M2.6 5.992 3.919 7.5 2.6 9.008" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" />
          </svg>
          <svg v-else class="h-5 w-5" viewBox="-0.5 -0.5 16 16" fill="none" stroke="currentColor">
            <path d="M12.777 14.285H2.223c-.833 0-1.508-.675-1.508-1.508V2.223c0-.833.675-1.508 1.508-1.508h10.554c.833 0 1.508.675 1.508 1.508v10.554c0 .833-.675 1.508-1.508 1.508Z" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" />
            <path d="M5.615 14.285V.715" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" />
            <path d="M3.919 5.992 2.6 7.5l1.319 1.508" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" />
          </svg>
        </button>
        <nav class="flex items-center space-x-2 text-sm">
          <Link href="/settings" class="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">
            settings
          </Link>
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <span class="font-medium text-gray-900 dark:text-white">audit log</span>
        </nav>
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
      <div class="mx-auto max-w-6xl">
        <div class="mb-6">
          <h1 class="text-xl font-semibold text-gray-900 dark:text-white">Audit Log</h1>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            A chronological record of important actions performed in your team.
          </p>
        </div>

        <!-- Empty state -->
        <div v-if="logs.length === 0" class="rounded-lg border border-gray-200 px-4 py-12 text-center dark:border-gray-800">
          <p class="text-sm text-gray-500 dark:text-gray-400">No audit events recorded yet.</p>
        </div>

        <!-- Log table -->
        <div v-else class="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
          <table class="w-full text-left text-sm">
            <thead class="border-b border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900/50">
              <tr>
                <th class="px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">Action</th>
                <th class="px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">Resource</th>
                <th class="px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">User</th>
                <th class="px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">IP</th>
                <th class="px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">Time</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200 dark:divide-gray-800">
              <tr v-for="log in logs" :key="log.id" class="hover:bg-gray-50 dark:hover:bg-gray-900/30">
                <td class="px-4 py-2.5">
                  <span :class="actionColor(log.action)" class="font-medium">
                    {{ actionLabel(log.action) }}
                  </span>
                </td>
                <td class="px-4 py-2.5 text-gray-600 dark:text-gray-300">
                  <span class="font-mono text-xs">{{ log.resourceType }}</span>
                  <span v-if="log.details && log.details.name" class="ml-1 text-gray-400">
                    ({{ log.details.name }})
                  </span>
                </td>
                <td class="px-4 py-2.5 text-gray-600 dark:text-gray-300">{{ log.userName }}</td>
                <td class="px-4 py-2.5 font-mono text-xs text-gray-400 dark:text-gray-500">{{ log.ipAddress || '-' }}</td>
                <td class="px-4 py-2.5 text-gray-400 dark:text-gray-500">{{ formatTime(log.createdAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Pagination -->
        <div v-if="pagination.totalPages > 1" class="mt-4 flex items-center justify-between">
          <p class="text-sm text-gray-500 dark:text-gray-400">
            Showing {{ (pagination.page - 1) * pagination.perPage + 1 }}–{{ Math.min(pagination.page * pagination.perPage, pagination.totalCount) }} of {{ pagination.totalCount }}
          </p>
          <div class="flex space-x-2">
            <button
              @click="goToPage(pagination.page - 1)"
              :disabled="pagination.page <= 1"
              class="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              Previous
            </button>
            <button
              @click="goToPage(pagination.page + 1)"
              :disabled="pagination.page >= pagination.totalPages"
              class="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
