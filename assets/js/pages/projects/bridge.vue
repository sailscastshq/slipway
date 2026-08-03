<script setup>
import { Link, Head, router } from '@inertiajs/vue3'
import { inject, computed, ref } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'
import BridgeDashboard from '@/components/bridge/BridgeDashboard.vue'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  project: Object,
  environment: Object,
  app: Object,
  appScoped: Boolean,
  bridgeRequestBasePath: String,
  hostBridgeOrigin: Boolean,
  appRunning: Boolean,
  models: Object,
  modelsError: String,
  dashboards: Array,
  activeDashboard: Object
})

const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')
const bridgeBasePath = computed(
  () =>
    props.bridgeRequestBasePath ||
    (props.appScoped && props.app?.slug
      ? `/projects/${props.project.slug}/environments/${props.environment.slug}/apps/${props.app.slug}/bridge`
      : `/projects/${props.project.slug}/environments/${props.environment.slug}/bridge`)
)

// Search
const searchQuery = ref('')

// Sorted model list
const modelList = computed(() => {
  return Object.values(props.models || {}).sort(
    (a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label)
  )
})

// Filtered model list
const filteredModels = computed(() => {
  if (!searchQuery.value) return modelList.value
  const query = searchQuery.value.toLowerCase()
  return modelList.value.filter(
    (model) =>
      model.label.toLowerCase().includes(query) ||
      model.singularLabel.toLowerCase().includes(query) ||
      model.group.toLowerCase().includes(query) ||
      model.identity.toLowerCase().includes(query) ||
      (model.globalId && model.globalId.toLowerCase().includes(query)) ||
      (model.tableName && model.tableName.toLowerCase().includes(query))
  )
})

// Resource count
const totalModels = computed(() => modelList.value.length)

function attrCount(model) {
  return Object.keys(model.attributes || {}).length
}

function assocCount(model) {
  return (model.associations || []).length
}

function bridgeModelUrl(identity) {
  return `${bridgeBasePath.value}/${identity}`
}

function refresh() {
  router.reload({ only: ['models', 'modelsError', 'activeDashboard'] })
}

function switchDashboard(event) {
  const id = event.target.value
  router.get(bridgeBasePath.value, id ? { dashboard: id } : {}, {
    preserveState: true,
    preserveScroll: true,
    replace: true
  })
}
</script>

<template>
  <Head :title="`Bridge - ${project.name} | Slipway`"></Head>
  <div class="flex h-full flex-col">
    <!-- Header -->
    <div
      class="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800 sm:px-6"
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
        <nav class="flex items-center space-x-2 text-sm sm:hidden">
          <span
            v-if="hostBridgeOrigin"
            class="text-gray-500 dark:text-gray-400"
          >
            {{ app.name.toLowerCase() }}
          </span>
          <Link
            v-else
            :href="`/projects/${project.slug}/environments/${environment.slug}`"
            class="text-gray-500 dark:text-gray-400"
          >
            {{ project.name.toLowerCase() }}
          </Link>
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <span class="font-medium text-gray-900 dark:text-white">bridge</span>
        </nav>
        <nav class="hidden items-center space-x-2 text-sm sm:flex">
          <template v-if="!hostBridgeOrigin">
            <Link
              href="/"
              class="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
              >projects</Link
            >
            <span class="text-gray-400 dark:text-gray-600">/</span>
            <Link
              :href="`/projects/${project.slug}`"
              class="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
            >
              {{ project.name.toLowerCase() }}
            </Link>
            <span class="text-gray-400 dark:text-gray-600">/</span>
            <Link
              :href="`/projects/${project.slug}/environments/${environment.slug}`"
              class="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
            >
              {{ environment.slug }}
            </Link>
          </template>
          <span v-else class="text-gray-500 dark:text-gray-400">
            {{ app.name.toLowerCase() }}
          </span>
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <span class="font-medium text-gray-900 dark:text-white">bridge</span>
        </nav>
      </div>
      <div class="flex items-center gap-2">
        <select
          v-if="dashboards?.length > 1"
          :value="activeDashboard?.id"
          @change="switchDashboard"
          aria-label="Bridge dashboard"
          class="rounded-md border-0 bg-transparent py-1 pl-2 pr-7 text-sm text-gray-600 focus:ring-1 focus:ring-gray-300 dark:bg-gray-950 dark:text-gray-300 dark:focus:ring-gray-700"
        >
          <option
            v-for="dashboard in dashboards"
            :key="dashboard.id"
            :value="dashboard.id"
          >
            {{ dashboard.label }}
          </option>
        </select>
        <button
          v-if="appRunning && (modelList.length > 0 || activeDashboard)"
          @click="refresh"
          class="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
          title="Refresh Bridge"
          aria-label="Refresh Bridge"
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
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </button>
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto">
      <!-- App not running -->
      <div v-if="!appRunning" class="flex h-full items-center justify-center">
        <div class="text-center">
          <div
            class="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100 dark:bg-gray-900"
          >
            <svg
              class="h-8 w-8 text-gray-400 dark:text-gray-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.5"
                d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
              />
            </svg>
          </div>
          <h3 class="mt-4 text-sm font-medium text-gray-900 dark:text-white">
            App not running
          </h3>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Deploy your app to start using Bridge.
          </p>
          <Link
            v-if="!hostBridgeOrigin"
            :href="`/projects/${project.slug}/environments/${environment.slug}`"
            class="mt-4 inline-flex items-center rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
          >
            Go to environment
          </Link>
        </div>
      </div>

      <!-- Error -->
      <div
        v-else-if="modelsError"
        class="flex h-full items-center justify-center"
      >
        <div class="text-center">
          <div
            class="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50 dark:bg-red-950/30"
          >
            <svg
              class="h-8 w-8 text-red-500 dark:text-red-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.5"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <h3 class="mt-4 text-sm font-medium text-gray-900 dark:text-white">
            Failed to load models
          </h3>
          <p class="mt-1 max-w-sm text-sm text-gray-500 dark:text-gray-400">
            {{ modelsError }}
          </p>
          <button
            @click="refresh"
            class="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
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
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            Retry
          </button>
        </div>
      </div>

      <!-- No models -->
      <div
        v-else-if="modelList.length === 0 && !activeDashboard"
        class="flex h-full items-center justify-center"
      >
        <div class="text-center">
          <div
            class="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100 dark:bg-gray-900"
          >
            <svg
              class="h-8 w-8 text-gray-400 dark:text-gray-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.5"
                d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
              />
            </svg>
          </div>
          <h3 class="mt-4 text-sm font-medium text-gray-900 dark:text-white">
            No resources available
          </h3>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            No Waterline resources are currently exposed to Bridge.
          </p>
        </div>
      </div>

      <!-- Bridge dashboard and resources -->
      <div v-else class="mx-auto max-w-6xl px-4 py-6 sm:px-8">
        <BridgeDashboard
          v-if="activeDashboard"
          :dashboard="activeDashboard"
          :resources="models"
          :project="project"
          :environment="environment"
          :app="app"
          :app-scoped="appScoped"
        />

        <!-- Toolbar -->
        <div
          v-if="modelList.length > 0"
          :class="[
            'mb-4 flex items-center justify-between',
            activeDashboard ? 'mt-12' : ''
          ]"
        >
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Search resources..."
            class="w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500 dark:focus:border-gray-600 sm:w-64"
          />
          <span
            class="hidden text-xs tabular-nums text-gray-500 dark:text-gray-400 sm:block"
          >
            {{ totalModels }}
            {{ totalModels === 1 ? 'resource' : 'resources' }}
          </span>
        </div>

        <!-- Resources table -->
        <div
          v-if="modelList.length > 0"
          class="rounded-lg border border-gray-200 dark:border-gray-800"
        >
          <!-- Table Header -->
          <div
            class="grid grid-cols-12 gap-4 rounded-t-lg border-b border-gray-200 bg-gray-50/50 px-6 py-2 text-xs font-medium text-gray-500 dark:border-gray-800 dark:bg-gray-900/50"
          >
            <div class="col-span-5">Resource</div>
            <div class="col-span-2 text-right">Records</div>
            <div class="col-span-2 text-right">Attributes</div>
            <div class="col-span-2 text-right">Associations</div>
            <div class="col-span-1"></div>
          </div>

          <!-- Table Body -->
          <div
            class="divide-y divide-gray-200 rounded-b-lg bg-white dark:divide-gray-800 dark:bg-gray-950"
          >
            <div
              v-for="model in filteredModels"
              :key="model.identity"
              class="group grid grid-cols-12 items-center gap-4 px-6 py-4"
            >
              <div class="col-span-5">
                <Link
                  :href="bridgeModelUrl(model.identity)"
                  prefetch
                  class="flex items-center space-x-3"
                >
                  <div
                    class="flex h-8 w-8 items-center justify-center rounded-md bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
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
                        stroke-width="1.5"
                        d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"
                      />
                    </svg>
                  </div>
                  <div class="min-w-0">
                    <div
                      class="font-medium text-gray-900 underline decoration-gray-300 decoration-dashed underline-offset-2 hover:text-gray-700 dark:text-white dark:decoration-gray-600 dark:hover:text-gray-300"
                    >
                      {{ model.label }}
                    </div>
                    <div class="text-xs text-gray-500 dark:text-gray-500">
                      {{ model.group }}
                    </div>
                  </div>
                </Link>
              </div>
              <div class="col-span-2 text-right">
                <span
                  class="font-medium tabular-nums text-gray-900 dark:text-white"
                  >{{ (model.count || 0).toLocaleString() }}</span
                >
              </div>
              <div class="col-span-2 text-right">
                <span
                  class="text-sm tabular-nums text-gray-500 dark:text-gray-400"
                  >{{ attrCount(model) }}</span
                >
              </div>
              <div class="col-span-2 text-right">
                <span
                  v-if="assocCount(model) > 0"
                  class="text-sm tabular-nums text-gray-500 dark:text-gray-400"
                  >{{ assocCount(model) }}</span
                >
                <span v-else class="text-gray-300 dark:text-gray-700">—</span>
              </div>
              <div class="col-span-1 flex items-center justify-end">
                <Link
                  :href="bridgeModelUrl(model.identity)"
                  class="rounded p-1 text-gray-400 opacity-0 transition-opacity group-hover:opacity-100 dark:text-gray-500"
                  :aria-label="`Open ${model.label}`"
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
                      d="m9 18 6-6-6-6"
                    />
                  </svg>
                </Link>
              </div>
            </div>

            <!-- No results -->
            <div
              v-if="filteredModels.length === 0"
              class="px-6 py-8 text-center text-sm text-gray-500"
            >
              No resources found matching "{{ searchQuery }}"
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
