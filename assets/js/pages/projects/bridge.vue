<script setup>
import { Link, Head, router } from '@inertiajs/vue3'
import { inject, computed, ref } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  project: Object,
  environment: Object,
  appRunning: Boolean,
  models: Object,
  modelsError: String
})

const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')

// Search
const searchQuery = ref('')

// Settings modal
const settingsModalOpen = ref(false)
const selectedModel = ref(null)

function openSettings(model, e) {
  e.preventDefault()
  e.stopPropagation()
  selectedModel.value = model
  settingsModalOpen.value = true
}

function closeSettings() {
  settingsModalOpen.value = false
  selectedModel.value = null
}

// Sorted model list
const modelList = computed(() => {
  return Object.values(props.models || {}).sort((a, b) => a.identity.localeCompare(b.identity))
})

// Filtered model list
const filteredModels = computed(() => {
  if (!searchQuery.value) return modelList.value
  const query = searchQuery.value.toLowerCase()
  return modelList.value.filter(model =>
    model.identity.toLowerCase().includes(query) ||
    (model.globalId && model.globalId.toLowerCase().includes(query)) ||
    (model.tableName && model.tableName.toLowerCase().includes(query))
  )
})

// Stats
const totalModels = computed(() => modelList.value.length)
const totalRecords = computed(() => {
  return modelList.value.reduce((sum, m) => sum + (m.count || 0), 0)
})
const totalAttributes = computed(() => {
  return modelList.value.reduce((sum, m) => sum + Object.keys(m.attributes || {}).length, 0)
})

function attrCount(model) {
  return Object.keys(model.attributes || {}).length
}

function assocCount(model) {
  return (model.associations || []).length
}

function bridgeModelUrl(identity) {
  return `/projects/${props.project.slug}/environments/${props.environment.slug}/bridge/${identity}`
}

function refresh() {
  router.reload({ only: ['models', 'modelsError'] })
}

// Format large numbers
function formatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M'
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K'
  return num.toLocaleString()
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
      <!-- Refresh button -->
      <button
        v-if="appRunning && modelList.length > 0"
        @click="refresh"
        class="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
        title="Refresh models"
      >
        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      </button>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto">
      <!-- App not running -->
      <div v-if="!appRunning" class="flex h-full items-center justify-center">
        <div class="text-center">
          <div class="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100 dark:bg-gray-900">
            <svg class="h-8 w-8 text-gray-400 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          </div>
          <h3 class="mt-4 text-sm font-medium text-gray-900 dark:text-white">App not running</h3>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">Deploy your app to start using Bridge.</p>
          <Link
            :href="`/projects/${project.slug}/environments/${environment.slug}`"
            class="mt-4 inline-flex items-center rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
          >
            Go to environment
          </Link>
        </div>
      </div>

      <!-- Error -->
      <div v-else-if="modelsError" class="flex h-full items-center justify-center">
        <div class="text-center">
          <div class="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50 dark:bg-red-950/30">
            <svg class="h-8 w-8 text-red-500 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h3 class="mt-4 text-sm font-medium text-gray-900 dark:text-white">Failed to load models</h3>
          <p class="mt-1 max-w-sm text-sm text-gray-500 dark:text-gray-400">{{ modelsError }}</p>
          <button
            @click="refresh"
            class="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Retry
          </button>
        </div>
      </div>

      <!-- No models -->
      <div v-else-if="modelList.length === 0" class="flex h-full items-center justify-center">
        <div class="text-center">
          <div class="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100 dark:bg-gray-900">
            <svg class="h-8 w-8 text-gray-400 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          </div>
          <h3 class="mt-4 text-sm font-medium text-gray-900 dark:text-white">No models found</h3>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">Your app doesn't have any Waterline models.</p>
        </div>
      </div>

      <!-- Models dashboard -->
      <div v-else class="mx-auto max-w-6xl px-4 py-6 sm:px-8">
        <!-- Toolbar: Search + Stats -->
        <div class="mb-4 flex items-center justify-between">
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Search models..."
            class="w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500 dark:focus:border-gray-600 sm:w-64"
          />
          <div class="hidden items-center gap-6 text-sm sm:flex">
            <div class="flex items-center gap-2">
              <span class="text-gray-500 dark:text-gray-400">Models</span>
              <span class="font-medium tabular-nums text-gray-900 dark:text-white">{{ totalModels }}</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-gray-500 dark:text-gray-400">Records</span>
              <span class="font-medium tabular-nums text-gray-900 dark:text-white">{{ formatNumber(totalRecords) }}</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-gray-500 dark:text-gray-400">Attributes</span>
              <span class="font-medium tabular-nums text-gray-900 dark:text-white">{{ totalAttributes }}</span>
            </div>
          </div>
        </div>

        <!-- Models table -->
        <div class="rounded-lg border border-gray-200 dark:border-gray-800">
          <!-- Table Header -->
          <div class="grid grid-cols-12 gap-4 rounded-t-lg border-b border-gray-200 bg-gray-50/50 px-6 py-2 text-xs font-medium text-gray-500 dark:border-gray-800 dark:bg-gray-900/50">
            <div class="col-span-5">Model</div>
            <div class="col-span-2 text-right">Records</div>
            <div class="col-span-2 text-right">Attributes</div>
            <div class="col-span-2 text-right">Associations</div>
            <div class="col-span-1"></div>
          </div>

          <!-- Table Body -->
          <div class="divide-y divide-gray-200 rounded-b-lg bg-white dark:divide-gray-800 dark:bg-gray-950">
            <div
              v-for="model in filteredModels"
              :key="model.identity"
              class="group grid grid-cols-12 items-center gap-4 px-6 py-4"
            >
              <div class="col-span-5">
                <Link :href="bridgeModelUrl(model.identity)" prefetch class="flex items-center space-x-3">
                  <div class="flex h-8 w-8 items-center justify-center rounded-md bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                    <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                    </svg>
                  </div>
                  <div class="min-w-0">
                    <div class="font-medium text-gray-900 underline decoration-dashed decoration-gray-300 underline-offset-2 hover:text-gray-700 dark:text-white dark:decoration-gray-600 dark:hover:text-gray-300">
                      {{ model.globalId || model.identity }}
                    </div>
                    <div class="text-xs text-gray-500 dark:text-gray-500">{{ model.tableName || model.identity }}</div>
                  </div>
                </Link>
              </div>
              <div class="col-span-2 text-right">
                <span class="font-medium tabular-nums text-gray-900 dark:text-white">{{ (model.count || 0).toLocaleString() }}</span>
              </div>
              <div class="col-span-2 text-right">
                <span class="text-sm tabular-nums text-gray-500 dark:text-gray-400">{{ attrCount(model) }}</span>
              </div>
              <div class="col-span-2 text-right">
                <span v-if="assocCount(model) > 0" class="text-sm tabular-nums text-gray-500 dark:text-gray-400">{{ assocCount(model) }}</span>
                <span v-else class="text-gray-300 dark:text-gray-700">—</span>
              </div>
              <div class="col-span-1 flex items-center justify-end">
                <button
                  @click="openSettings(model, $event)"
                  class="rounded p-1 text-gray-400 opacity-0 transition-opacity hover:bg-gray-100 hover:text-gray-600 group-hover:opacity-100 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                  title="Model settings"
                >
                  <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </button>
              </div>
            </div>

            <!-- No results -->
            <div
              v-if="filteredModels.length === 0"
              class="px-6 py-8 text-center text-sm text-gray-500"
            >
              No models found matching "{{ searchQuery }}"
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Settings Modal -->
    <Teleport to="body">
      <Transition
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="opacity-0"
        enter-to-class="opacity-100"
        leave-active-class="transition duration-150 ease-in"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
      >
        <div v-if="settingsModalOpen" class="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div class="fixed inset-0 bg-black/50 backdrop-blur-sm" @click="closeSettings" />
          <Transition
            enter-active-class="transition duration-200 ease-out"
            enter-from-class="scale-95 opacity-0"
            enter-to-class="scale-100 opacity-100"
            leave-active-class="transition duration-150 ease-in"
            leave-from-class="scale-100 opacity-100"
            leave-to-class="scale-95 opacity-0"
          >
            <div
              v-if="settingsModalOpen && selectedModel"
              class="relative flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-900"
            >
              <!-- Modal header -->
              <div class="shrink-0 border-b border-gray-200 px-6 py-4 dark:border-gray-800">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-3">
                    <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-100 dark:bg-gray-800">
                      <svg class="h-5 w-5 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                      </svg>
                    </div>
                    <div>
                      <h3 class="text-lg font-semibold text-gray-900 dark:text-white">
                        {{ selectedModel.globalId || selectedModel.identity }}
                      </h3>
                      <p class="text-sm text-gray-500 dark:text-gray-400">Model Settings</p>
                    </div>
                  </div>
                  <button
                    @click="closeSettings"
                    class="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                  >
                    <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              <!-- Modal body -->
              <div class="flex-1 overflow-y-auto p-6">
                <!-- Model info -->
                <div class="mb-6 grid grid-cols-3 gap-4">
                  <div class="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
                    <p class="text-xs font-medium text-gray-500 dark:text-gray-400">Records</p>
                    <p class="mt-1 text-lg font-semibold tabular-nums text-gray-900 dark:text-white">{{ (selectedModel.count || 0).toLocaleString() }}</p>
                  </div>
                  <div class="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
                    <p class="text-xs font-medium text-gray-500 dark:text-gray-400">Attributes</p>
                    <p class="mt-1 text-lg font-semibold tabular-nums text-gray-900 dark:text-white">{{ attrCount(selectedModel) }}</p>
                  </div>
                  <div class="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
                    <p class="text-xs font-medium text-gray-500 dark:text-gray-400">Associations</p>
                    <p class="mt-1 text-lg font-semibold tabular-nums text-gray-900 dark:text-white">{{ assocCount(selectedModel) }}</p>
                  </div>
                </div>

                <!-- Settings options -->
                <div class="space-y-4">
                  <div>
                    <label class="text-sm font-medium text-gray-900 dark:text-white">Display Columns</label>
                    <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">Select which columns to display in the table view.</p>
                    <div class="mt-3 flex flex-wrap gap-2">
                      <span
                        v-for="attr in Object.keys(selectedModel.attributes || {})"
                        :key="attr"
                        class="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                      >
                        {{ attr }}
                      </span>
                    </div>
                  </div>

                  <div class="border-t border-gray-200 pt-4 dark:border-gray-800">
                    <label class="text-sm font-medium text-gray-900 dark:text-white">Primary Display Field</label>
                    <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">Choose the field to use as the main identifier in lists.</p>
                    <select class="mt-3 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white">
                      <option value="">Auto-detect</option>
                      <option v-for="attr in Object.keys(selectedModel.attributes || {})" :key="attr" :value="attr">{{ attr }}</option>
                    </select>
                  </div>

                  <div class="border-t border-gray-200 pt-4 dark:border-gray-800">
                    <label class="text-sm font-medium text-gray-900 dark:text-white">Default Sort</label>
                    <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">Set the default sorting for this model.</p>
                    <div class="mt-3 flex gap-3">
                      <select class="block flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white">
                        <option value="createdAt">createdAt</option>
                        <option v-for="attr in Object.keys(selectedModel.attributes || {})" :key="attr" :value="attr">{{ attr }}</option>
                      </select>
                      <select class="block w-32 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white">
                        <option value="DESC">Descending</option>
                        <option value="ASC">Ascending</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Modal footer -->
              <div class="flex shrink-0 items-center justify-end gap-3 border-t border-gray-200 bg-gray-50/50 px-6 py-4 dark:border-gray-800 dark:bg-gray-900/50">
                <button
                  @click="closeSettings"
                  class="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  Cancel
                </button>
                <button
                  class="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
                >
                  Save Settings
                </button>
              </div>
            </div>
          </Transition>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
