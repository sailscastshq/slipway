<script setup>
import WarningTriangle from '@/components/ui/icons/WarningTriangle.vue'
import Refresh from '@/components/ui/icons/Refresh.vue'
import Database from '@/components/ui/icons/Database.vue'
import Cube from '@/components/ui/icons/Cube.vue'
import ChevronRight from '@/components/ui/icons/ChevronRight.vue'
import Input from '@/components/ui/input/Input.vue'
import { Link, Head, router } from '@inertiajs/vue3'
import { computed, ref } from 'vue'
import BridgePageLayout from '@/layouts/BridgePageLayout.vue'
import BridgeDashboard from '@/components/bridge/BridgeDashboard.vue'
import BridgePageHeader from '@/components/bridge/BridgePageHeader.vue'
import BareSelect from '@/components/BareSelect.vue'
import Tooltip from '@/components/ui/tooltip/Tooltip.vue'
import ErrorState from '@/components/ui/error-state/ErrorState.vue'

defineOptions({
  layout: BridgePageLayout
})

const props = defineProps({
  project: Object,
  environment: Object,
  app: Object,
  appScoped: Boolean,
  bridgeRequestBasePath: String,
  hostBridgeOrigin: Boolean,
  bridgeWorkspace: Object,
  appRunning: Boolean,
  models: Object,
  modelsError: String,
  dashboards: Array,
  activeDashboard: Object
})

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
    (a, b) =>
      a.label.localeCompare(b.label) || a.identity.localeCompare(b.identity)
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

function switchDashboard(id) {
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
    <BridgePageHeader
      :project="project"
      :environment="environment"
      :app="app"
      :host-bridge-origin="hostBridgeOrigin"
      :breadcrumbs="[{ label: 'bridge' }]"
    >
      <template #actions>
        <BareSelect
          v-if="dashboards?.length > 1"
          :model-value="activeDashboard?.id"
          :options="
            dashboards.map((dashboard) => ({
              value: dashboard.id,
              label: dashboard.label
            }))
          "
          @change="switchDashboard"
          aria-label="Bridge dashboard"
          class="py-1 pl-2 pr-2 text-sm text-gray-600 dark:text-gray-300"
        />
        <Tooltip
          v-if="appRunning && (modelList.length > 0 || activeDashboard)"
          text="Refresh Bridge"
        >
          <button
            type="button"
            aria-label="Refresh Bridge"
            class="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
            @click="refresh"
          >
            <Refresh class="h-4 w-4" stroke-width="2" />
          </button>
        </Tooltip>
      </template>
    </BridgePageHeader>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto">
      <!-- App not running -->
      <div v-if="!appRunning" class="flex h-full items-center justify-center">
        <div class="text-center">
          <div
            class="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100 dark:bg-gray-900"
          >
            <Cube class="h-8 w-8 text-gray-400 dark:text-gray-600" />
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
      <ErrorState
        v-else-if="modelsError"
        as="section"
        aria-labelledby="bridge-models-error-title"
        data-test="bridge-models-error"
        class="h-full gap-0 p-0"
      >
        <div
          class="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50 dark:bg-red-950/30"
        >
          <WarningTriangle class="h-8 w-8 text-red-500 dark:text-red-400" />
        </div>
        <h2
          id="bridge-models-error-title"
          class="mt-4 text-sm font-medium text-gray-900 dark:text-white"
        >
          Failed to load models
        </h2>
        <p class="mt-1 max-w-sm text-sm text-gray-500 dark:text-gray-400">
          {{ modelsError }}
        </p>
        <button
          type="button"
          class="mt-4 inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
          @click="refresh"
        >
          <Refresh class="h-4 w-4" stroke-width="2" />
          Retry
        </button>
      </ErrorState>

      <!-- No models -->
      <div
        v-else-if="modelList.length === 0 && !activeDashboard"
        class="flex h-full items-center justify-center"
      >
        <div class="text-center">
          <div
            class="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100 dark:bg-gray-900"
          >
            <Cube class="h-8 w-8 text-gray-400 dark:text-gray-600" />
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
          :bridge-base-path="bridgeBasePath"
        />

        <!-- Toolbar -->
        <div
          v-if="modelList.length > 0"
          :class="[
            'mb-4 flex items-center justify-between',
            activeDashboard ? 'mt-12' : ''
          ]"
        >
          <Input
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
              :data-test="`bridge-resource-row-${model.identity}`"
              class="group grid grid-cols-12 items-center gap-4 px-6 py-4 transition-colors hover:bg-gray-50 dark:hover:bg-gray-900/40"
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
                    <Database class="h-4 w-4" />
                  </div>
                  <span
                    data-test="bridge-resource-label"
                    class="min-w-0 truncate font-medium text-gray-900 transition-colors group-hover:text-gray-700 dark:text-white dark:group-hover:text-gray-300"
                  >
                    {{ model.label }}
                  </span>
                </Link>
              </div>
              <div class="col-span-2 text-right">
                <span
                  data-test="bridge-resource-record-count"
                  class="font-medium tabular-nums text-gray-900 dark:text-white"
                  >{{ (model.count || 0).toLocaleString() }}</span
                >
              </div>
              <div class="col-span-2 text-right">
                <span
                  data-test="bridge-resource-attribute-count"
                  class="text-sm tabular-nums text-gray-500 dark:text-gray-400"
                  >{{ attrCount(model) }}</span
                >
              </div>
              <div class="col-span-2 text-right">
                <span
                  v-if="assocCount(model) > 0"
                  data-test="bridge-resource-association-count"
                  class="text-sm tabular-nums text-gray-500 dark:text-gray-400"
                  >{{ assocCount(model) }}</span
                >
                <span
                  v-else
                  data-test="bridge-resource-association-count"
                  class="text-gray-300 dark:text-gray-700"
                  >—</span
                >
              </div>
              <div class="col-span-1 flex items-center justify-end">
                <Link
                  :href="bridgeModelUrl(model.identity)"
                  class="rounded p-1 text-gray-400 opacity-0 transition-opacity group-hover:opacity-100 dark:text-gray-500"
                  :aria-label="`Open ${model.label}`"
                >
                  <ChevronRight class="h-4 w-4" stroke-width="2" />
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
