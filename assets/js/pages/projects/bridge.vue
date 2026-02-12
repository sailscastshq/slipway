<script setup>
import { Link, Head } from '@inertiajs/vue3'
import { inject, ref, onMounted } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'
import { useBridge } from '@/composables/bridge'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  project: Object,
  environment: Object,
  appRunning: Boolean
})

const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')

const { fetchModels } = useBridge()

const models = ref({})
const loading = ref(true)
const error = ref(null)

onMounted(async () => {
  if (!props.appRunning) {
    loading.value = false
    return
  }
  try {
    const data = await fetchModels()
    models.value = data.models || {}
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
})

function modelList() {
  return Object.values(models.value).sort((a, b) => a.identity.localeCompare(b.identity))
}

function attrCount(model) {
  return Object.keys(model.attributes || {}).length
}

function assocCount(model) {
  return (model.associations || []).length
}

function bridgeModelUrl(identity) {
  return `/projects/${props.project.slug}/environments/${props.environment.slug}/bridge/${identity}`
}
</script>

<template>
  <Head :title="`Bridge - ${project.name} | Slipway`"></Head>
  <div class="flex h-full flex-col">
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800 sm:px-6">
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
        <nav class="flex items-center space-x-2 text-sm sm:hidden">
          <Link :href="`/projects/${project.slug}/environments/${environment.slug}`" class="text-gray-500 dark:text-gray-400">
            {{ project.name.toLowerCase() }}
          </Link>
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <span class="font-medium text-gray-900 dark:text-white">bridge</span>
        </nav>
        <nav class="hidden items-center space-x-2 text-sm sm:flex">
          <Link href="/" class="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">projects</Link>
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <Link :href="`/projects/${project.slug}`" class="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">
            {{ project.name.toLowerCase() }}
          </Link>
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <Link :href="`/projects/${project.slug}/environments/${environment.slug}`" class="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">
            {{ environment.slug }}
          </Link>
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <span class="font-medium text-gray-900 dark:text-white">bridge</span>
        </nav>
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto">
      <!-- App not running -->
      <div v-if="!appRunning" class="flex h-full items-center justify-center">
        <div class="text-center">
          <svg class="mx-auto h-12 w-12 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
          <h3 class="mt-3 text-sm font-medium text-gray-900 dark:text-white">App not running</h3>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">Deploy your app to start using Bridge.</p>
          <Link
            :href="`/projects/${project.slug}/environments/${environment.slug}`"
            class="mt-4 inline-flex items-center rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
          >
            Go to environment
          </Link>
        </div>
      </div>

      <!-- Loading -->
      <div v-else-if="loading" class="flex h-full items-center justify-center">
        <svg class="h-6 w-6 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>

      <!-- Error -->
      <div v-else-if="error" class="flex h-full items-center justify-center">
        <div class="text-center">
          <p class="text-sm text-red-600 dark:text-red-400">{{ error }}</p>
          <button
            @click="loading = true; error = null; fetchModels().then(d => { models = d.models || {} }).catch(e => { error = e.message }).finally(() => { loading = false })"
            class="mt-3 text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >
            Retry
          </button>
        </div>
      </div>

      <!-- No models -->
      <div v-else-if="modelList().length === 0" class="flex h-full items-center justify-center">
        <div class="text-center">
          <svg class="mx-auto h-12 w-12 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
          <h3 class="mt-3 text-sm font-medium text-gray-900 dark:text-white">No models found</h3>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">Your app doesn't have any Waterline models.</p>
        </div>
      </div>

      <!-- Model grid -->
      <div v-else class="p-4 sm:p-6">
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Link
            v-for="model in modelList()"
            :key="model.identity"
            :href="bridgeModelUrl(model.identity)"
            class="group rounded-lg border border-gray-200 p-4 transition-colors hover:border-gray-300 hover:bg-gray-50 dark:border-gray-800 dark:hover:border-gray-700 dark:hover:bg-gray-900/50"
          >
            <div class="flex items-start justify-between">
              <div>
                <h3 class="text-sm font-semibold text-gray-900 dark:text-white">{{ model.globalId || model.identity }}</h3>
                <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{{ model.identity }}</p>
              </div>
              <svg class="h-4 w-4 text-gray-300 transition-colors group-hover:text-gray-500 dark:text-gray-600 dark:group-hover:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
              </svg>
            </div>
            <div class="mt-3 flex items-center space-x-4 text-xs text-gray-500 dark:text-gray-400">
              <span v-if="model.count !== undefined" class="flex items-center space-x-1">
                <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                </svg>
                <span>{{ model.count.toLocaleString() }} records</span>
              </span>
              <span class="flex items-center space-x-1">
                <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                <span>{{ attrCount(model) }} attrs</span>
              </span>
              <span v-if="assocCount(model) > 0" class="flex items-center space-x-1">
                <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
                <span>{{ assocCount(model) }} assoc</span>
              </span>
            </div>
          </Link>
        </div>
      </div>
    </div>
  </div>
</template>
