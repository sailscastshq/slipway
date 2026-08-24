<script setup>
import Input from '@/components/ui/input/Input.vue'
import Checkbox from '@/components/ui/checkbox/Checkbox.vue'
import { Link, Head, useForm } from '@inertiajs/vue3'
import { inject, ref, computed, watch } from 'vue'
import BridgePageLayout from '@/layouts/BridgePageLayout.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import { useToast } from '@/composables/toast'
import BridgeFieldValue from '@/components/bridge/BridgeFieldValue.vue'
import ActionMenu from '@/components/ActionMenu.vue'
import BridgeActionDialog from '@/components/bridge/BridgeActionDialog.vue'
import BridgeDashboard from '@/components/bridge/BridgeDashboard.vue'
import BridgeFilterMenu from '@/components/bridge/BridgeFilterMenu.vue'
import BridgePageHeader from '@/components/bridge/BridgePageHeader.vue'
import Pagination from '@/components/ui/pagination/Pagination.vue'
import Select from '@/components/ui/select/Select.vue'
import DataTable from '@/components/ui/data-table/DataTable.vue'
import RowActions from '@/components/ui/row-actions/RowActions.vue'
import BulkActions from '@/components/ui/bulk-actions/BulkActions.vue'
import EmptyState from '@/components/ui/empty-state/EmptyState.vue'
import LoadingState from '@/components/ui/loading-state/LoadingState.vue'
import ErrorState from '@/components/ui/error-state/ErrorState.vue'
import Spinner from '@/components/SlipwaySpinner.vue'
import { useDataTableQuery } from '@/composables/useDataTableQuery'

defineOptions({
  layout: BridgePageLayout
})

const props = defineProps({
  project: Object,
  environment: Object,
  app: Object,
  appScoped: Boolean,
  bridgeRequestBasePath: String,
  bridgeRequestApiBasePath: String,
  hostBridgeOrigin: Boolean,
  bridgeWorkspace: Object,
  modelIdentity: String,
  appRunning: Boolean,
  modelMeta: Object,
  records: Array,
  total: Number,
  totalPages: Number,
  currentPage: Number,
  perPage: Number,
  sort: String,
  search: String,
  filterState: Object,
  filterDefinitions: Object,
  columns: Array,
  lenses: Array,
  activeLens: Object,
  error: String,
  dashboards: Array,
  dashboardResources: Object,
  activeDashboard: Object
})

const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')
const toast = useToast()
const bridgeBasePath = computed(
  () =>
    props.bridgeRequestBasePath ||
    (props.appScoped && props.app?.slug
      ? `/projects/${props.project.slug}/environments/${props.environment.slug}/apps/${props.app.slug}/bridge`
      : `/projects/${props.project.slug}/environments/${props.environment.slug}/bridge`)
)
const relationshipBaseUrl = computed(() => {
  if (props.bridgeRequestApiBasePath) {
    return `${props.bridgeRequestApiBasePath}/${props.modelIdentity}/relationships`
  }
  const appPath =
    props.appScoped && props.app?.slug ? `/apps/${props.app.slug}` : ''
  return `/api/v1/projects/${props.project.slug}/environments/${props.environment.slug}${appPath}/bridge/${props.modelIdentity}/relationships`
})
const defaultLens = computed(() =>
  (props.lenses || []).find((definition) => definition.default)
)
const allRecordsLensValue = computed(() => (defaultLens.value ? '__all' : ''))
const tableReloadProps = [
  'records',
  'total',
  'totalPages',
  'currentPage',
  'perPage',
  'sort',
  'search',
  'filterState',
  'filterDefinitions',
  'columns',
  'lenses',
  'activeLens',
  'error'
]

// Local state for app-owned filters, lenses, and actions.
const filtersValue = ref(props.filterState || {})
const lensValue = ref(props.activeLens?.id || allRecordsLensValue.value)
const selectedIds = ref([])
const deleteModal = ref({ show: false, recordId: null })
const bulkDeleteModal = ref({ show: false })
const actionDialog = ref({ show: false, action: null, recordIds: [] })

const hasRecordActions = computed(() => {
  const actions = props.modelMeta?.actions || {}
  return (
    actions.view !== false ||
    actions.update !== false ||
    actions.delete !== false
  )
})
const customActions = computed(() =>
  Object.values(props.modelMeta?.actionDefinitions || {}).filter(
    (action) => props.modelMeta?.actions?.[action.name] === true
  )
)
const resourceActions = computed(() =>
  customActions.value.filter((action) => action.scope === 'resource')
)
const bulkActions = computed(() =>
  customActions.value.filter((action) => action.scope === 'bulk')
)
const hasBulkActions = computed(
  () =>
    Boolean(props.modelMeta) &&
    (props.modelMeta.actions?.bulkDelete !== false ||
      bulkActions.value.length > 0)
)
const resourceMenuItems = computed(() =>
  resourceActions.value.map(actionMenuItem)
)
const bulkMenuItems = computed(() => [
  ...bulkActions.value.map(actionMenuItem),
  ...(props.modelMeta?.actions?.bulkDelete !== false
    ? [
        {
          key: 'bulkDelete',
          label: 'Delete selected',
          destructive: true,
          builtIn: true
        }
      ]
    : [])
])

function encodePathSegment(value) {
  return encodeURIComponent(String(value))
}

function recordKey(record) {
  return String(record[props.modelMeta.primaryKey])
}

function displayIdentifier(value) {
  const identifier = String(value ?? '')
  if (identifier.length <= 24) return identifier
  return `${identifier.slice(0, 10)}…${identifier.slice(-6)}`
}

function actionLabel(record) {
  const titleField = props.modelMeta?.title
  const title = titleField ? record[titleField] : null
  return String(title || displayIdentifier(record[props.modelMeta.primaryKey]))
}

// Forms for delete actions
const deleteForm = useForm({})
const bulkDeleteForm = useForm({ ids: [] })
const quickActionForm = useForm({})

function openDeleteModal(record) {
  deleteModal.value = {
    show: true,
    recordId: record[props.modelMeta.primaryKey],
    loading: false
  }
}

watch(
  () => props.filterState,
  (value) => {
    filtersValue.value = value || {}
  },
  { deep: true }
)
watch(
  () => props.activeLens,
  (value) => {
    lensValue.value = value?.id || allRecordsLensValue.value
  }
)
const tableQuery = computed(() => ({
  page: props.currentPage,
  sort: props.sort || '',
  search: props.search || '',
  filters: filtersValue.value,
  lens: lensValue.value,
  dashboard: props.dashboards?.length > 1 ? props.activeDashboard?.id || '' : ''
}))
const tableDefaults = computed(() => ({
  page: 1,
  sort: props.modelMeta
    ? `${props.modelMeta.sort.field} ${props.modelMeta.sort.direction}`
    : '',
  search: '',
  filters: {},
  lens: defaultLens.value?.id || '',
  dashboard: ''
}))
const {
  search: searchInput,
  busy: tableBusy,
  visit: navigateWithParams,
  ariaSort,
  sortButton
} = useDataTableQuery({
  url: computed(() => `${bridgeBasePath.value}/${props.modelIdentity}`),
  query: tableQuery,
  defaults: tableDefaults,
  only: tableReloadProps
})

// Visible columns
const visibleColumns = computed(() => {
  if (!props.modelMeta) return []
  return props.columns || props.modelMeta.list || []
})
const hasScopedQuery = computed(
  () =>
    Boolean(props.search) ||
    Object.keys(props.filterState || {}).length > 0 ||
    Boolean(props.activeLens)
)

function applyFilters(filters) {
  filtersValue.value = filters
  navigateWithParams({ filters, page: 1 })
}

function switchLens(lens) {
  lensValue.value = lens
  filtersValue.value = {}
  navigateWithParams({ lens, filters: {}, sort: '', page: 1 })
}

const sortAttr = computed(() => String(props.sort || '').split(' ')[0])
const sortDir = computed(() => String(props.sort || '').split(' ')[1] || 'ASC')

function fieldLabel(name) {
  return props.modelMeta?.attributes[name]?.label || name
}

// Delete single record
function confirmDelete() {
  deleteForm.post(
    `${bridgeBasePath.value}/${props.modelIdentity}/${encodePathSegment(
      deleteModal.value.recordId
    )}/delete`,
    {
      preserveScroll: true,
      onSuccess: () => {
        toast({ message: 'Record deleted.', type: 'success' })
        deleteModal.value = { show: false, recordId: null }
        selectedIds.value = []
      },
      onError: (errors) => {
        toast({
          message: errors.error || 'Failed to delete record',
          type: 'error'
        })
      }
    }
  )
}

// Bulk delete
function confirmBulkDelete() {
  bulkDeleteForm.ids = [...selectedIds.value]
  bulkDeleteForm.post(
    `${bridgeBasePath.value}/${props.modelIdentity}/bulk-delete`,
    {
      preserveScroll: true,
      onSuccess: () => {
        toast({
          message: `${bulkDeleteForm.ids.length} record(s) deleted.`,
          type: 'success'
        })
        bulkDeleteModal.value = { show: false }
        selectedIds.value = []
      },
      onError: (errors) => {
        toast({
          message: errors.error || 'Failed to delete records',
          type: 'error'
        })
      }
    }
  )
}

function actionMenuItem(action) {
  return {
    key: action.name,
    label: action.label,
    destructive: action.destructive === true,
    action
  }
}

function customActionUrl(action) {
  return `${bridgeBasePath.value}/${
    props.modelIdentity
  }/actions/${encodePathSegment(action.name)}`
}

function actionNeedsDialog(action) {
  return (
    action.destructive === true ||
    Boolean(action.confirm) ||
    Object.keys(action.fields || {}).length > 0
  )
}

function runCustomAction(action, { recordIds = [] } = {}) {
  if (actionNeedsDialog(action)) {
    actionDialog.value = {
      show: true,
      action,
      recordIds
    }
    return
  }

  quickActionForm
    .transform(() => ({
      values: {},
      ...(action.scope === 'bulk' ? { recordIds } : {})
    }))
    .post(customActionUrl(action), {
      preserveScroll: true,
      onSuccess: () => {
        if (action.scope === 'bulk') clearSelection()
      },
      onError: (errors) => {
        toast({
          message: errors.error || `${action.label} failed.`,
          type: 'error'
        })
      }
    })
}

function handleResourceAction(item) {
  runCustomAction(item.action)
}

function handleBulkAction(item) {
  if (item.builtIn) {
    bulkDeleteModal.value = { show: true }
    return
  }
  runCustomAction(item.action, {
    recordIds: [...selectedIds.value]
  })
}

function clearSelection() {
  selectedIds.value = []
}

function completeCustomAction() {
  if (actionDialog.value.action?.scope === 'bulk') clearSelection()
  actionDialog.value = { show: false, action: null, recordIds: [] }
}

function switchDashboard(dashboard) {
  navigateWithParams(
    { dashboard, page: 1 },
    { only: ['activeDashboard', 'error'], replace: true }
  )
}

// URL builders
function bridgeUrl() {
  return bridgeBasePath.value
}
function recordUrl(id) {
  return `${bridgeBasePath.value}/${props.modelIdentity}/${encodePathSegment(
    id
  )}`
}
function editUrl(id) {
  return `${bridgeBasePath.value}/${props.modelIdentity}/${encodePathSegment(
    id
  )}/edit`
}
function createUrl() {
  return `${bridgeBasePath.value}/${props.modelIdentity}/new`
}
</script>

<template>
  <Head
    :title="`${modelMeta?.label || modelIdentity} - Bridge | Slipway`"
  ></Head>
  <div class="flex h-full flex-col">
    <BridgePageHeader
      v-if="hostBridgeOrigin"
      :project="project"
      :environment="environment"
      :app="app"
      :host-bridge-origin="true"
      :breadcrumbs="[
        { label: 'bridge', href: bridgeUrl() },
        { label: modelMeta?.label || modelIdentity }
      ]"
    />

    <!-- Operator header -->
    <div
      v-else
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
          <Link :href="bridgeUrl()" class="text-gray-500 dark:text-gray-400"
            >bridge</Link
          >
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <span class="font-medium text-gray-900 dark:text-white">{{
            modelMeta?.label || modelIdentity
          }}</span>
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
            <span class="text-gray-400 dark:text-gray-600">/</span>
          </template>
          <Link
            :href="bridgeUrl()"
            class="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
            >bridge</Link
          >
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <span class="font-medium text-gray-900 dark:text-white">{{
            modelMeta?.label || modelIdentity
          }}</span>
        </nav>
      </div>
    </div>

    <!-- Toolbar -->
    <div class="px-4 py-4 sm:px-8">
      <div class="relative mx-auto flex max-w-6xl items-center justify-between">
        <div class="flex items-center space-x-3">
          <Input
            v-if="(modelMeta?.search || []).length > 0"
            v-model="searchInput"
            type="text"
            aria-label="Search records"
            placeholder="Search records..."
            class="w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500 dark:focus:border-gray-600 sm:w-64"
          />
          <Select
            v-if="lenses?.length > 0"
            :model-value="lensValue"
            :options="[
              { value: allRecordsLensValue, label: 'All records' },
              ...lenses.map((lens) => ({
                value: lens.id,
                label: lens.label
              }))
            ]"
            aria-label="Saved view"
            class="rounded-md border-0 bg-transparent py-1 pl-2 pr-7 text-sm text-gray-600 focus:ring-1 focus:ring-gray-300 dark:bg-gray-950 dark:text-gray-300 dark:focus:ring-gray-700"
            data-test="bridge-lens-select"
            @change="switchLens"
          />
          <BridgeFilterMenu
            v-if="Object.keys(filterDefinitions || {}).length > 0"
            :definitions="filterDefinitions"
            :model-value="filtersValue"
            :relationship-base-url="relationshipBaseUrl"
            :busy="tableBusy"
            @apply="applyFilters"
          />
          <Transition
            enter-active-class="transition ease-out duration-150"
            enter-from-class="opacity-0 -translate-x-2"
            enter-to-class="opacity-100 translate-x-0"
            leave-active-class="transition ease-in duration-100"
            leave-from-class="opacity-100"
            leave-to-class="opacity-0"
          >
            <BulkActions
              :count="hasBulkActions ? selectedIds.length : 0"
              :busy="quickActionForm.processing || bulkDeleteForm.processing"
              label="Actions for selected records"
              class="[&_[data-slot=bulk-actions-clear]]:min-h-7 min-h-0 w-auto gap-2 rounded-none border-0 bg-transparent p-0 text-gray-500 shadow-none dark:bg-transparent dark:text-gray-400 [&_[data-slot=bulk-actions-clear]]:whitespace-nowrap [&_[data-slot=bulk-actions-clear]]:px-2 [&_[data-slot=bulk-actions-clear]]:text-xs [&_[data-slot=bulk-actions-summary]]:text-xs [&_[data-slot=bulk-actions-summary]]:font-normal"
              @clear="clearSelection"
            >
              <ActionMenu
                :items="bulkMenuItems"
                :disabled="quickActionForm.processing"
                label="Actions for selected records"
                test-id="bridge-bulk-action-menu"
                @select="handleBulkAction"
              />
            </BulkActions>
          </Transition>
        </div>
        <div class="flex items-center space-x-4">
          <Select
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
            class="rounded-md border-0 bg-transparent py-1 pl-2 pr-7 text-sm text-gray-600 focus:ring-1 focus:ring-gray-300 dark:bg-gray-950 dark:text-gray-300 dark:focus:ring-gray-700"
          />
          <span
            v-if="total > 0"
            class="text-xs text-gray-500 dark:text-gray-400"
            >{{ total.toLocaleString() }} records</span
          >
          <ActionMenu
            :items="resourceMenuItems"
            :disabled="quickActionForm.processing"
            :label="`Actions for ${modelMeta?.label || modelIdentity}`"
            test-id="bridge-resource-action-menu"
            @select="handleResourceAction"
          />
          <Link
            v-if="modelMeta?.actions?.create !== false"
            :href="createUrl()"
            prefetch
            class="inline-flex items-center rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
          >
            <span class="mr-1">+</span>
            New
          </Link>
        </div>
        <LoadingState
          v-if="tableBusy && !error && modelMeta"
          id="bridge-records-loading"
          data-test="bridge-loading"
          class="pointer-events-none absolute -bottom-4 right-0 min-h-0 w-auto flex-row justify-end gap-2 p-0 text-right text-xs text-gray-500 dark:text-gray-400"
        >
          <Spinner class="size-3.5" />
          <span>Refreshing records…</span>
        </LoadingState>
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-auto px-4 py-4 sm:px-8">
      <div class="mx-auto max-w-6xl">
        <BridgeDashboard
          v-if="activeDashboard"
          :dashboard="activeDashboard"
          :resources="dashboardResources"
          :bridge-base-path="bridgeBasePath"
          class="mb-10"
        />

        <!-- Error -->
        <ErrorState
          v-if="error"
          as="section"
          aria-labelledby="bridge-records-error-title"
          class="h-full gap-0 p-0"
        >
          <div
            class="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50 dark:bg-red-950/30"
          >
            <svg
              class="h-8 w-8 text-red-500 dark:text-red-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.5"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <h2 id="bridge-records-error-title" class="sr-only">
            Records could not load
          </h2>
          <p class="mt-4 text-sm text-red-600 dark:text-red-400">
            {{ error }}
          </p>
        </ErrorState>

        <!-- Table -->
        <DataTable
          v-else-if="modelMeta"
          v-model:selected="selectedIds"
          :rows="records"
          :row-key="(record) => record[modelMeta.primaryKey]"
          :selectable="() => hasBulkActions"
          :busy="tableBusy"
          :aria-describedby="tableBusy ? 'bridge-records-loading' : undefined"
          class="rounded-lg border border-gray-200 dark:border-gray-800"
          table-class="w-full text-left text-sm"
        >
          <template #default="{ pageSelection, rowSelection }">
            <caption class="sr-only">
              {{
                modelMeta.label || modelIdentity
              }}
              records
            </caption>
            <thead
              class="border-b border-gray-200 bg-gray-50/50 dark:border-gray-800 dark:bg-gray-900/50"
            >
              <tr>
                <th v-if="hasBulkActions" scope="col" class="w-10 px-4 py-2">
                  <Checkbox
                    v-bind="pageSelection('Select all records on this page')"
                    data-bulk-actions-focus
                    class="h-3.5 w-3.5 rounded border-gray-300 text-gray-900 focus:ring-gray-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                  />
                </th>
                <th
                  v-for="col in visibleColumns"
                  :key="col"
                  scope="col"
                  :aria-sort="
                    modelMeta.attributes[col]?.field?.sortable === false
                      ? undefined
                      : ariaSort(col)
                  "
                  class="select-none whitespace-nowrap px-4 py-2 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400"
                >
                  <button
                    v-if="modelMeta.attributes[col]?.field?.sortable !== false"
                    v-bind="sortButton(col, fieldLabel(col))"
                    class="flex cursor-pointer items-center space-x-1 hover:text-gray-900 disabled:cursor-wait dark:hover:text-white"
                  >
                    <span>{{ fieldLabel(col) }}</span>
                    <svg
                      v-if="sortAttr === col"
                      class="h-3.5 w-3.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        v-if="sortDir === 'ASC'"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M5 15l7-7 7 7"
                      />
                      <path
                        v-else
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  </button>
                  <span v-else>{{ fieldLabel(col) }}</span>
                </th>
                <th v-if="hasRecordActions" scope="col" class="w-12 px-4 py-2">
                  <span class="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody
              v-if="records.length === 0"
              class="bg-white dark:bg-gray-950"
            >
              <tr>
                <td
                  :colspan="
                    visibleColumns.length +
                    (hasBulkActions ? 1 : 0) +
                    (hasRecordActions ? 1 : 0)
                  "
                  class="px-4 py-12 text-center text-sm text-gray-500 dark:text-gray-400"
                >
                  <EmptyState
                    data-test="bridge-empty"
                    class="min-h-0 gap-0 p-0 text-sm text-gray-500 dark:text-gray-400"
                  >
                    <p>
                      {{
                        hasScopedQuery
                          ? 'No matching records.'
                          : 'No records yet.'
                      }}
                    </p>
                  </EmptyState>
                </td>
              </tr>
            </tbody>
            <tbody
              v-else
              class="divide-y divide-gray-200 bg-white dark:divide-gray-800 dark:bg-gray-950"
            >
              <tr
                v-for="record in records"
                :key="record[modelMeta.primaryKey]"
                class="group hover:bg-gray-50 dark:hover:bg-gray-900/30"
              >
                <td v-if="hasBulkActions" class="px-4 py-2">
                  <Checkbox
                    v-bind="
                      rowSelection(record, `Select ${actionLabel(record)}`)
                    "
                    class="h-3.5 w-3.5 rounded border-gray-300 text-gray-900 focus:ring-gray-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                  />
                </td>
                <td
                  v-for="col in visibleColumns"
                  :key="col"
                  class="whitespace-nowrap px-4 py-2"
                >
                  <Link
                    v-if="
                      col === modelMeta.primaryKey &&
                      modelMeta.actions?.view !== false
                    "
                    :href="recordUrl(record[col])"
                    :title="String(record[col])"
                    class="font-medium text-gray-900 hover:underline dark:text-white"
                  >
                    {{ displayIdentifier(record[col]) }}
                  </Link>
                  <BridgeFieldValue
                    v-else
                    :name="col"
                    :attribute="modelMeta.attributes[col]"
                    :value="record[col]"
                    context="list"
                    class="text-gray-700 dark:text-gray-300"
                  />
                </td>
                <td v-if="hasRecordActions" class="px-4 py-2">
                  <div class="flex justify-end">
                    <RowActions
                      :id="`bridge-record-actions-${recordKey(record)}`"
                      :label="`Actions for ${actionLabel(record)}`"
                      :data-test="`bridge-row-actions-${recordKey(record)}`"
                      class="[&_[data-slot=row-actions-trigger]]:size-7 text-gray-400 dark:text-gray-500 [&_[data-row-actions-menu]]:w-36 [&_[data-row-actions-menu]]:min-w-0 [&_[data-row-actions-menu]]:rounded-md [&_[data-row-actions-menu]]:border-gray-200 [&_[data-row-actions-menu]]:bg-white [&_[data-row-actions-menu]]:px-0 [&_[data-row-actions-menu]]:py-1 [&_[data-row-actions-menu]]:shadow-lg dark:[&_[data-row-actions-menu]]:border-gray-700 dark:[&_[data-row-actions-menu]]:bg-gray-900 [&_[data-slot=row-actions-trigger]]:transition-colors [&_[data-slot=row-actions-trigger]]:hover:bg-gray-100 [&_[data-slot=row-actions-trigger]]:hover:text-gray-700 [&_[data-slot=row-actions-trigger]]:focus-visible:outline-none [&_[data-slot=row-actions-trigger]]:focus-visible:ring-2 [&_[data-slot=row-actions-trigger]]:focus-visible:ring-gray-300 dark:[&_[data-slot=row-actions-trigger]]:hover:bg-gray-800 dark:[&_[data-slot=row-actions-trigger]]:hover:text-gray-200 dark:[&_[data-slot=row-actions-trigger]]:focus-visible:ring-gray-700"
                    >
                      <template #menu>
                        <Link
                          v-if="modelMeta.actions?.view !== false"
                          :href="recordUrl(record[modelMeta.primaryKey])"
                          prefetch
                          role="menuitem"
                          class="flex w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none dark:text-gray-300 dark:hover:bg-gray-800 dark:focus:bg-gray-800"
                        >
                          View record
                        </Link>
                        <Link
                          v-if="modelMeta.actions?.update !== false"
                          :href="editUrl(record[modelMeta.primaryKey])"
                          prefetch
                          role="menuitem"
                          class="flex w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none dark:text-gray-300 dark:hover:bg-gray-800 dark:focus:bg-gray-800"
                        >
                          Edit record
                        </Link>
                        <button
                          v-if="modelMeta.actions?.delete !== false"
                          @click="openDeleteModal(record)"
                          role="menuitem"
                          class="flex w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 focus:bg-red-50 focus:outline-none dark:text-red-400 dark:hover:bg-red-900/20 dark:focus:bg-red-900/20"
                        >
                          Delete record
                        </button>
                      </template>
                    </RowActions>
                  </div>
                </td>
              </tr>
            </tbody>
          </template>
        </DataTable>
      </div>
    </div>

    <div
      v-if="totalPages > 1"
      class="border-t border-gray-200 px-4 py-3 dark:border-gray-800 sm:px-8"
    >
      <div class="mx-auto flex max-w-6xl items-center justify-between">
        <div class="text-xs text-gray-500 dark:text-gray-400">
          Page {{ currentPage }} of {{ totalPages }}
        </div>
        <Pagination
          :page="currentPage"
          :pages="totalPages"
          :only="tableReloadProps"
          data-test="bridge-pagination"
          class="[&_[data-slot=ellipsis]]:min-h-8 [&_[data-slot=ellipsis]]:min-w-6 [&_[data-slot=next]]:min-h-8 [&_[data-slot=next]]:min-w-8 [&_[data-slot=page]]:min-h-8 [&_[data-slot=page]]:min-w-8 [&_[data-slot=previous]]:min-h-8 [&_[data-slot=previous]]:min-w-8 w-auto [&>ul]:justify-end [&_[data-slot=next]]:px-2.5 [&_[data-slot=next]]:text-xs [&_[data-slot=page]]:px-2 [&_[data-slot=page]]:text-xs [&_[data-slot=previous]]:px-2.5 [&_[data-slot=previous]]:text-xs"
        />
      </div>
    </div>
  </div>

  <ConfirmModal
    :show="deleteModal.show"
    title="Delete record"
    message="Are you sure? This action cannot be undone."
    confirm-label="Delete"
    :destructive="true"
    :loading="deleteForm.processing"
    @confirm="confirmDelete"
    @cancel="deleteModal = { show: false, recordId: null }"
  />

  <ConfirmModal
    :show="bulkDeleteModal.show"
    title="Delete selected records"
    :message="`Are you sure you want to delete ${selectedIds.length} record(s)? This action cannot be undone.`"
    confirm-label="Delete all"
    :destructive="true"
    :loading="bulkDeleteForm.processing"
    @confirm="confirmBulkDelete"
    @cancel="bulkDeleteModal = { show: false }"
  />

  <BridgeActionDialog
    :show="actionDialog.show"
    :action="actionDialog.action"
    :submit-url="
      actionDialog.action ? customActionUrl(actionDialog.action) : ''
    "
    :model-identity="modelIdentity"
    :record-ids="actionDialog.recordIds"
    @cancel="actionDialog = { show: false, action: null, recordIds: [] }"
    @complete="completeCustomAction"
  />
</template>
