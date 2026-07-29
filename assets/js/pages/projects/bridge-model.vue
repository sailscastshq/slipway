<script setup>
import { Link, Head, router, useForm } from '@inertiajs/vue3'
import { inject, ref, computed, watch } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import ToastContainer from '@/components/ToastContainer.vue'
import { createToast } from '@/composables/toast'
import BridgeFieldValue from '@/components/bridge/BridgeFieldValue.vue'
import ActionMenu from '@/components/ActionMenu.vue'
import BridgeActionDialog from '@/components/bridge/BridgeActionDialog.vue'
import BridgeDashboard from '@/components/bridge/BridgeDashboard.vue'
import BridgeFilterMenu from '@/components/bridge/BridgeFilterMenu.vue'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  project: Object,
  environment: Object,
  app: Object,
  appScoped: Boolean,
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
const { toasts, toast, dismiss } = createToast()
const bridgeBasePath = computed(() =>
  props.appScoped && props.app?.slug
    ? `/projects/${props.project.slug}/environments/${props.environment.slug}/apps/${props.app.slug}/bridge`
    : `/projects/${props.project.slug}/environments/${props.environment.slug}/bridge`
)
const relationshipBaseUrl = computed(() => {
  const appPath =
    props.appScoped && props.app?.slug ? `/apps/${props.app.slug}` : ''
  return `/api/v1/projects/${props.project.slug}/environments/${props.environment.slug}${appPath}/bridge/${props.modelIdentity}/relationships`
})
const defaultLens = computed(() =>
  (props.lenses || []).find((definition) => definition.default)
)
const allRecordsLensValue = computed(() => (defaultLens.value ? '__all' : ''))

// Local state for UI
const page = ref(props.currentPage)
const sortValue = ref(props.sort)
const searchInput = ref(props.search)
const filtersValue = ref(props.filterState || {})
const lensValue = ref(props.activeLens?.id || allRecordsLensValue.value)
const selectedIds = ref(new Set())
const selectAll = ref(false)
const deleteModal = ref({ show: false, recordId: null })
const bulkDeleteModal = ref({ show: false })
const openActionMenu = ref(null)
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

function toggleActionMenu(record) {
  const key = recordKey(record)
  openActionMenu.value = openActionMenu.value === key ? null : key
}

function closeActionMenu() {
  openActionMenu.value = null
}

function handleActionMenuKeydown(event) {
  const items = Array.from(
    event.currentTarget.querySelectorAll('[role="menuitem"]')
  )
  const currentIndex = items.indexOf(document.activeElement)

  if (event.key === 'Escape') {
    event.preventDefault()
    closeActionMenu()
    event.currentTarget.previousElementSibling?.focus()
    return
  }

  let nextIndex
  if (event.key === 'ArrowDown') {
    nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length
  } else if (event.key === 'ArrowUp') {
    nextIndex =
      currentIndex < 0
        ? items.length - 1
        : (currentIndex - 1 + items.length) % items.length
  } else if (event.key === 'Home') {
    nextIndex = 0
  } else if (event.key === 'End') {
    nextIndex = items.length - 1
  } else {
    return
  }

  event.preventDefault()
  items[nextIndex]?.focus()
}

// Forms for delete actions
const deleteForm = useForm({})
const bulkDeleteForm = useForm({ ids: [] })
const quickActionForm = useForm({})

function openDeleteModal(record) {
  closeActionMenu()
  deleteModal.value = {
    show: true,
    recordId: record[props.modelMeta.primaryKey],
    loading: false
  }
}

// Debounced search
let searchTimeout = null
watch(searchInput, (val) => {
  clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => {
    navigateWithParams({ search: val, page: 1 })
  }, 300)
})
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
watch(
  () => props.sort,
  (value) => {
    sortValue.value = value
  }
)
watch(
  () => props.currentPage,
  (value) => {
    page.value = value
  }
)

// Navigate with updated params
function navigateWithParams(updates) {
  const params = {
    page: updates.page ?? page.value,
    sort: updates.sort ?? sortValue.value,
    search: updates.search ?? searchInput.value,
    filters: JSON.stringify(updates.filters ?? filtersValue.value),
    lens: updates.lens ?? lensValue.value,
    dashboard:
      updates.dashboard ??
      (props.dashboards?.length > 1 ? props.activeDashboard?.id : '')
  }

  // Clean up defaults
  if (params.page === 1) delete params.page
  const defaultSort = props.modelMeta
    ? `${props.modelMeta.sort.field} ${props.modelMeta.sort.direction}`
    : ''
  if (!params.sort || params.sort === defaultSort) delete params.sort
  if (!params.search) delete params.search
  if (params.filters === '{}') delete params.filters
  if (
    !params.lens ||
    params.lens === defaultLens.value?.id ||
    (params.lens === '__all' && !defaultLens.value)
  ) {
    delete params.lens
  }
  if (!params.dashboard) delete params.dashboard

  const query = new URLSearchParams(params).toString()
  const basePath = `${bridgeBasePath.value}/${props.modelIdentity}`

  router.visit(query ? `${basePath}?${query}` : basePath, {
    preserveState: true,
    preserveScroll: true
  })
}

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
  page.value = 1
  navigateWithParams({ filters, page: 1 })
}

function switchLens(event) {
  const lens = event.target.value
  lensValue.value = lens
  filtersValue.value = {}
  sortValue.value = ''
  page.value = 1
  navigateWithParams({ lens, filters: {}, sort: '', page: 1 })
}

// Sort handling
const sortAttr = computed(() => sortValue.value.split(' ')[0])
const sortDir = computed(() => sortValue.value.split(' ')[1] || 'ASC')

function toggleSort(attr) {
  if (props.modelMeta?.attributes[attr]?.field?.sortable === false) return
  let newSort
  if (sortAttr.value === attr) {
    newSort = `${attr} ${sortDir.value === 'ASC' ? 'DESC' : 'ASC'}`
  } else {
    newSort = `${attr} ASC`
  }
  sortValue.value = newSort
  navigateWithParams({ sort: newSort, page: 1 })
}

function fieldLabel(name) {
  return props.modelMeta?.attributes[name]?.label || name
}

// Selection
function toggleSelectAll() {
  if (selectAll.value) {
    selectedIds.value = new Set()
    selectAll.value = false
  } else {
    selectedIds.value = new Set(
      props.records.map((r) => r[props.modelMeta.primaryKey])
    )
    selectAll.value = true
  }
}

function toggleSelect(id) {
  const s = new Set(selectedIds.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  selectedIds.value = s
  selectAll.value = s.size === props.records.length
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
        selectedIds.value = new Set()
        selectAll.value = false
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
  bulkDeleteForm.ids = Array.from(selectedIds.value)
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
        selectedIds.value = new Set()
        selectAll.value = false
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
    recordIds: Array.from(selectedIds.value)
  })
}

function clearSelection() {
  selectedIds.value = new Set()
  selectAll.value = false
}

function completeCustomAction() {
  if (actionDialog.value.action?.scope === 'bulk') clearSelection()
  actionDialog.value = { show: false, action: null, recordIds: [] }
}

// Pagination
function goToPage(newPage) {
  page.value = newPage
  navigateWithParams({ page: newPage })
}

function switchDashboard(event) {
  navigateWithParams({ dashboard: event.target.value, page: 1 })
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
  <ToastContainer :toasts="toasts" @dismiss="dismiss" />

  <div
    class="flex h-full flex-col"
    @click="closeActionMenu"
    @keydown.esc="closeActionMenu"
  >
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
          <Link :href="bridgeUrl()" class="text-gray-500 dark:text-gray-400"
            >bridge</Link
          >
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <span class="font-medium text-gray-900 dark:text-white">{{
            modelMeta?.label || modelIdentity
          }}</span>
        </nav>
        <nav class="hidden items-center space-x-2 text-sm sm:flex">
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
      <div class="mx-auto flex max-w-6xl items-center justify-between">
        <div class="flex items-center space-x-3">
          <input
            v-if="(modelMeta?.search || []).length > 0"
            v-model="searchInput"
            type="text"
            aria-label="Search records"
            placeholder="Search records..."
            class="w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500 dark:focus:border-gray-600 sm:w-64"
          />
          <select
            v-if="lenses?.length > 0"
            :value="lensValue"
            aria-label="Saved view"
            class="rounded-md border-0 bg-transparent py-1 pl-2 pr-7 text-sm text-gray-600 focus:ring-1 focus:ring-gray-300 dark:bg-gray-950 dark:text-gray-300 dark:focus:ring-gray-700"
            data-test="bridge-lens-select"
            @change="switchLens"
          >
            <option :value="allRecordsLensValue">All records</option>
            <option v-for="lens in lenses" :key="lens.id" :value="lens.id">
              {{ lens.label }}
            </option>
          </select>
          <BridgeFilterMenu
            v-if="Object.keys(filterDefinitions || {}).length > 0"
            :definitions="filterDefinitions"
            :model-value="filtersValue"
            :relationship-base-url="relationshipBaseUrl"
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
            <div
              v-if="selectedIds.size > 0 && hasBulkActions"
              class="flex items-center space-x-2"
            >
              <span class="text-xs text-gray-500 dark:text-gray-400"
                >{{ selectedIds.size }} selected</span
              >
              <ActionMenu
                :items="bulkMenuItems"
                :disabled="quickActionForm.processing"
                label="Actions for selected records"
                test-id="bridge-bulk-action-menu"
                @select="handleBulkAction"
              />
            </div>
          </Transition>
        </div>
        <div class="flex items-center space-x-4">
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
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-auto px-4 py-4 sm:px-8">
      <div class="mx-auto max-w-6xl">
        <BridgeDashboard
          v-if="activeDashboard"
          :dashboard="activeDashboard"
          :resources="dashboardResources"
          :project="project"
          :environment="environment"
          :app="app"
          :app-scoped="appScoped"
          class="mb-10"
        />

        <!-- Error -->
        <div v-if="error" class="flex h-full items-center justify-center">
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
            <p class="mt-4 text-sm text-red-600 dark:text-red-400">
              {{ error }}
            </p>
          </div>
        </div>

        <!-- Table -->
        <div
          v-else-if="modelMeta"
          class="rounded-lg border border-gray-200 dark:border-gray-800"
        >
          <table class="w-full text-left text-sm">
            <thead
              class="border-b border-gray-200 bg-gray-50/50 dark:border-gray-800 dark:bg-gray-900/50"
            >
              <tr>
                <th v-if="hasBulkActions" class="w-10 px-4 py-2">
                  <input
                    type="checkbox"
                    :checked="selectAll"
                    @change="toggleSelectAll"
                    class="h-3.5 w-3.5 rounded border-gray-300 text-gray-900 focus:ring-gray-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                  />
                </th>
                <th
                  v-for="col in visibleColumns"
                  :key="col"
                  @click="toggleSort(col)"
                  :class="[
                    'select-none whitespace-nowrap px-4 py-2 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400',
                    modelMeta.attributes[col]?.field?.sortable === false
                      ? ''
                      : 'cursor-pointer hover:text-gray-900 dark:hover:text-white'
                  ]"
                >
                  <span class="flex items-center space-x-1">
                    <span>{{ fieldLabel(col) }}</span>
                    <svg
                      v-if="sortAttr === col"
                      class="h-3.5 w-3.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
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
                  </span>
                </th>
                <th v-if="hasRecordActions" class="w-12 px-4 py-2">
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
                  {{
                    hasScopedQuery ? 'No matching records.' : 'No records yet.'
                  }}
                </td>
              </tr>
            </tbody>
            <tbody
              v-else
              class="divide-y divide-gray-200 bg-white dark:divide-gray-800 dark:bg-gray-950"
            >
              <tr
                v-for="(record, recordIndex) in records"
                :key="record[modelMeta.primaryKey]"
                class="group hover:bg-gray-50 dark:hover:bg-gray-900/30"
              >
                <td v-if="hasBulkActions" class="px-4 py-2">
                  <input
                    type="checkbox"
                    :checked="selectedIds.has(record[modelMeta.primaryKey])"
                    @change="toggleSelect(record[modelMeta.primaryKey])"
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
                  <div class="relative flex justify-end" @click.stop>
                    <button
                      type="button"
                      class="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-200 dark:focus-visible:ring-gray-700"
                      :aria-label="`Actions for ${actionLabel(record)}`"
                      aria-haspopup="menu"
                      :aria-expanded="openActionMenu === recordKey(record)"
                      @click="toggleActionMenu(record)"
                    >
                      <svg
                        class="h-4 w-4"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                        aria-hidden="true"
                      >
                        <path
                          d="M6 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm6 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm6 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z"
                        />
                      </svg>
                    </button>

                    <div
                      v-if="openActionMenu === recordKey(record)"
                      role="menu"
                      :class="[
                        'absolute right-0 z-20 w-36 rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900',
                        recordIndex >= records.length - 2
                          ? 'bottom-full mb-1'
                          : 'top-full mt-1'
                      ]"
                      @keydown="handleActionMenuKeydown"
                    >
                      <Link
                        v-if="modelMeta.actions?.view !== false"
                        :href="recordUrl(record[modelMeta.primaryKey])"
                        prefetch
                        role="menuitem"
                        class="flex w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none dark:text-gray-300 dark:hover:bg-gray-800 dark:focus:bg-gray-800"
                        @click="closeActionMenu"
                      >
                        View record
                      </Link>
                      <Link
                        v-if="modelMeta.actions?.update !== false"
                        :href="editUrl(record[modelMeta.primaryKey])"
                        prefetch
                        role="menuitem"
                        class="flex w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none dark:text-gray-300 dark:hover:bg-gray-800 dark:focus:bg-gray-800"
                        @click="closeActionMenu"
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
                    </div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Pagination -->
    <div
      v-if="totalPages > 1"
      class="border-t border-gray-200 px-4 py-3 dark:border-gray-800 sm:px-8"
    >
      <div class="mx-auto flex max-w-6xl items-center justify-between">
        <div class="text-xs text-gray-500 dark:text-gray-400">
          Page {{ currentPage }} of {{ totalPages }}
        </div>
        <div class="flex items-center space-x-2">
          <button
            @click="goToPage(Math.max(1, currentPage - 1))"
            :disabled="currentPage <= 1"
            class="rounded-md border border-gray-200 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Previous
          </button>
          <button
            @click="goToPage(Math.min(totalPages, currentPage + 1))"
            :disabled="currentPage >= totalPages"
            class="rounded-md border border-gray-200 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Next
          </button>
        </div>
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
    :message="`Are you sure you want to delete ${selectedIds.size} record(s)? This action cannot be undone.`"
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
