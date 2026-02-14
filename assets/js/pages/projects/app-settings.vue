<script setup>
import { Link, Head, router } from '@inertiajs/vue3'
import { ref, inject } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import { useToast } from '@/composables/toast'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  project: Object,
  environment: Object,
  app: Object
})

const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')
const toast = useToast()

// --- Form state ---
const name = ref(props.app.name)
const dockerfilePath = ref(props.app.dockerfilePath || 'Dockerfile')
const routePath = ref(props.app.routePath === null ? 'none' : (props.app.routePath || '/'))
const cpus = ref(props.app.resourceLimits?.cpus || '1')
const memory = ref(props.app.resourceLimits?.memory || '512m')
const saving = ref(false)

async function saveSettings() {
  saving.value = true
  try {
    await fetch(`/api/v1/projects/${props.project.slug}/environments/${props.environment.slug}/apps/${props.app.slug}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.value,
        dockerfilePath: dockerfilePath.value,
        routePath: routePath.value === 'none' ? null : routePath.value,
        resourceLimits: { cpus: cpus.value, memory: memory.value }
      })
    })
    toast({ message: 'App settings saved', type: 'success' })
    router.reload()
  } finally {
    saving.value = false
  }
}

// --- Delete ---
const deleteConfirm = ref(false)
const deleting = ref(false)

async function deleteApp() {
  deleting.value = true
  try {
    const res = await fetch(`/api/v1/projects/${props.project.slug}/environments/${props.environment.slug}/apps/${props.app.slug}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' }
    })
    if (res.ok) {
      router.visit(`/projects/${props.project.slug}/environments/${props.environment.slug}`)
    } else {
      const data = await res.json()
      toast({ message: data.problems?.[0]?.app || 'Failed to delete app', type: 'error' })
    }
  } finally {
    deleting.value = false
    deleteConfirm.value = false
  }
}
</script>

<template>
  <Head :title="`${app.name} Settings - ${environment.name} | Slipway`"></Head>
  <div class="flex h-full flex-col">
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-gray-200 py-4 pl-4 pr-4 dark:border-gray-800 sm:pl-4 sm:pr-8">
      <div class="flex items-center space-x-3">
        <button @click="toggleMobileMenu" class="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white md:hidden">
          <svg class="h-5 w-5" viewBox="-0.5 -0.5 16 16" fill="none" stroke="currentColor">
            <path d="M12.777 14.285H2.223c-.833 0-1.508-.675-1.508-1.508V2.223c0-.833.675-1.508 1.508-1.508h10.554c.833 0 1.508.675 1.508 1.508v10.554c0 .833-.675 1.508-1.508 1.508Z" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" />
            <path d="M5.615 14.285V.715" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" />
          </svg>
        </button>
        <button @click="toggleSidebar" class="hidden text-gray-400 dark:text-gray-500 md:block">
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
          <Link href="/" class="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">projects</Link>
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <Link :href="`/projects/${project.slug}`" class="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">{{ project.name.toLowerCase() }}</Link>
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <Link :href="`/projects/${project.slug}/environments/${environment.slug}`" class="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">{{ environment.name.toLowerCase() }}</Link>
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <span class="font-medium text-gray-900 dark:text-white">{{ app.name }} settings</span>
        </nav>
      </div>
      <div class="flex items-center space-x-4">
        <a
          href="https://docs.sailscasts.com/slipway"
          target="_blank"
          class="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
        >
          Docs
          <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
      <div class="mx-auto max-w-2xl">
        <div class="mb-8">
          <h1 class="text-xl font-semibold text-gray-900 dark:text-white">{{ app.name }} settings</h1>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Configure this app's Dockerfile, routing, and resource limits.
          </p>
        </div>

        <!-- General Settings -->
        <form @submit.prevent="saveSettings" class="space-y-6">
          <div>
            <label for="appName" class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Name
            </label>
            <input
              id="appName"
              v-model="name"
              type="text"
              class="w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
            />
          </div>

          <div>
            <label for="dockerfilePath" class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Dockerfile path
            </label>
            <input
              id="dockerfilePath"
              v-model="dockerfilePath"
              type="text"
              placeholder="Dockerfile"
              class="w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
            />
            <p class="mt-1 text-xs text-gray-400 dark:text-gray-500">Relative to your project root, e.g. <code class="text-gray-500 dark:text-gray-400">Dockerfile.worker</code></p>
          </div>

          <div>
            <label for="routePath" class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Route path
            </label>
            <select
              id="routePath"
              v-model="routePath"
              class="w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 focus:border-brand focus:outline-none dark:border-gray-700 dark:text-white"
            >
              <option value="/">/ (root)</option>
              <option value="/api">/api</option>
              <option value="/admin">/admin</option>
              <option value="none">None (worker)</option>
            </select>
            <p class="mt-1 text-xs text-gray-400 dark:text-gray-500">URL prefix this app handles. Choose "None" for background workers.</p>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label for="cpuLimit" class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                CPU limit
              </label>
              <input
                id="cpuLimit"
                v-model="cpus"
                type="text"
                placeholder="1"
                class="w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
              />
            </div>
            <div>
              <label for="memoryLimit" class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Memory limit
              </label>
              <input
                id="memoryLimit"
                v-model="memory"
                type="text"
                placeholder="512m"
                class="w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
              />
            </div>
          </div>

          <div class="flex justify-end">
            <button
              type="submit"
              :disabled="saving"
              class="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
            >
              {{ saving ? 'Saving...' : 'Save changes' }}
            </button>
          </div>
        </form>

        <!-- Danger Zone -->
        <div v-if="!app.isDefault" class="mt-12 rounded-lg border border-red-200 p-6 dark:border-red-900/50">
          <h3 class="text-sm font-medium text-red-600 dark:text-red-400">Danger zone</h3>
          <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Permanently delete this app. This will stop its container and remove all associated deployments.
          </p>
          <div class="mt-4">
            <button
              @click="deleteConfirm = true"
              class="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
            >
              Delete app
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Delete Confirm Modal -->
    <ConfirmModal
      v-if="deleteConfirm"
      title="Delete app"
      :message="`Are you sure you want to delete '${app.name}'? This will stop the container and cannot be undone.`"
      confirm-text="Delete"
      :loading="deleting"
      @confirm="deleteApp"
      @cancel="deleteConfirm = false"
    />
  </div>
</template>
