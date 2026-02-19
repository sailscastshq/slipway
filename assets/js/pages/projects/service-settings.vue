<script setup>
import { Link, Head, router, usePage } from '@inertiajs/vue3'
import { ref, computed, inject } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'
import Breadcrumb from '@/components/Breadcrumb.vue'
import Tooltip from '@/components/Tooltip.vue'
import { useToast } from '@/composables/toast'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  project: Object,
  environment: Object,
  service: Object
})

const page = usePage()
const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')
const toast = useToast()

// Recommended defaults per service type
const typeDefaults = {
  postgresql: { cpus: '1', memory: '512m' },
  mysql: { cpus: '1', memory: '512m' },
  mongodb: { cpus: '1', memory: '512m' },
  redis: { cpus: '0.25', memory: '128m' }
}
const defaults = typeDefaults[props.service.type] || { cpus: '0.5', memory: '256m' }

// Form state
const cpus = ref(props.service.resourceLimits?.cpus || defaults.cpus)
const memory = ref(props.service.resourceLimits?.memory || defaults.memory)
const saving = ref(false)
const savingAndRestarting = ref(false)

const isDirty = computed(() =>
  cpus.value !== (props.service.resourceLimits?.cpus || defaults.cpus) ||
  memory.value !== (props.service.resourceLimits?.memory || defaults.memory)
)

async function saveSettings({ restart = false } = {}) {
  if (restart) {
    savingAndRestarting.value = true
  } else {
    saving.value = true
  }

  try {
    const res = await fetch(`/api/v1/services/${props.service.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': page.props._csrf || '' },
      body: JSON.stringify({
        resourceLimits: { cpus: cpus.value, memory: memory.value }
      })
    })

    if (res.ok) {
      if (restart) {
        await fetch(`/api/v1/services/${props.service.id}/restart`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-csrf-token': page.props._csrf || '' }
        })
        toast({ message: 'Settings saved and service restarted', type: 'success' })
      } else {
        toast({ message: 'Settings saved', type: 'success' })
      }
      router.reload()
    } else {
      const data = await res.json()
      toast({ message: data.message || 'Failed to save settings', type: 'error' })
    }
  } catch (err) {
    toast({ message: 'Failed to save settings', type: 'error' })
  } finally {
    saving.value = false
    savingAndRestarting.value = false
  }
}

const serviceTypeLabel = {
  postgresql: 'PostgreSQL',
  mysql: 'MySQL',
  redis: 'Redis',
  mongodb: 'MongoDB'
}
</script>

<template>
  <Head :title="`${service.name} Settings - ${environment.name} | Slipway`"></Head>
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
        <Breadcrumb :items="[
          { label: 'projects', href: '/' },
          { label: project.name.toLowerCase(), href: `/projects/${project.slug}` },
          { label: environment.name.toLowerCase(), href: `/projects/${project.slug}/environments/${environment.slug}` },
          { label: service.name, href: `/projects/${project.slug}/environments/${environment.slug}/services/${service.id}` },
          { label: 'settings' }
        ]" />
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
      <div class="mx-auto max-w-2xl">
        <div class="mb-8">
          <h1 class="text-xl font-semibold text-gray-900 dark:text-white">{{ service.name }} settings</h1>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Configure resource limits for this {{ serviceTypeLabel[service.type] || service.type }} service.
          </p>
        </div>

        <form @submit.prevent="saveSettings()" class="space-y-6">
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label for="cpuLimit" class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                CPU limit
              </label>
              <input
                id="cpuLimit"
                v-model="cpus"
                type="text"
                :placeholder="defaults.cpus"
                class="w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
              />
              <p class="mt-1 text-xs text-gray-400 dark:text-gray-500">Number of CPU cores, e.g. <code class="text-gray-500 dark:text-gray-400">0.5</code> or <code class="text-gray-500 dark:text-gray-400">2</code></p>
            </div>
            <div>
              <label for="memoryLimit" class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Memory limit
              </label>
              <input
                id="memoryLimit"
                v-model="memory"
                type="text"
                :placeholder="defaults.memory"
                class="w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
              />
              <p class="mt-1 text-xs text-gray-400 dark:text-gray-500">e.g. <code class="text-gray-500 dark:text-gray-400">256m</code>, <code class="text-gray-500 dark:text-gray-400">512m</code>, <code class="text-gray-500 dark:text-gray-400">1g</code></p>
            </div>
          </div>

          <!-- Compound button -->
          <div class="flex justify-end">
            <div class="inline-flex rounded-md shadow-sm">
              <button
                type="submit"
                :disabled="!isDirty || saving || savingAndRestarting"
                class="rounded-l-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
              >
                {{ saving ? 'Saving...' : 'Save changes' }}
              </button>
              <Tooltip text="Save and restart service">
                <button
                  type="button"
                  @click="saveSettings({ restart: true })"
                  :disabled="!isDirty || saving || savingAndRestarting"
                  class="rounded-r-md border-l border-gray-700 bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:border-gray-200 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
                >
                  <template v-if="savingAndRestarting">
                    <svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                    </svg>
                  </template>
                  <template v-else>
                    <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </template>
                </button>
              </Tooltip>
            </div>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
