<script setup>
import { Link, Head, router, useForm } from '@inertiajs/vue3'
import { inject, ref, computed, watch } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import ToastContainer from '@/components/ToastContainer.vue'
import { createToast } from '@/composables/toast'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  project: Object,
  environment: Object,
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
  error: String
})

const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')
const { toasts, toast, dismiss } = createToast()

// Local state for UI
const page = ref(props.currentPage)
const sortValue = ref(props.sort)
const searchInput = ref(props.search)
const selectedIds = ref(new Set())
const selectAll = ref(false)
const deleteModal = ref({ show: false, recordId: null })
const bulkDeleteModal = ref({ show: false })

// Forms for delete actions
const deleteForm = useForm({})
const bulkDeleteForm = useForm({ ids: [] })

// Debounced search
let searchTimeout = null
watch(searchInput, (val) => {
  clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => {
    navigateWithParams({ search: val, page: 1 })
  }, 300)
})

// Navigate with updated params
function navigateWithParams(updates) {
  const params = {
    page: updates.page ?? page.value,
    sort: updates.sort ?? sortValue.value,
    search: updates.search ?? searchInput.value
  }

  // Clean up defaults
  if (params.page === 1) delete params.page
  if (params.sort === 'createdAt DESC') delete params.sort
  if (!params.search) delete params.search

  const query = new URLSearchParams(params).toString()
  const basePath = `/projects/${props.project.slug}/environments/${props.environment.slug}/bridge/${props.modelIdentity}`

  router.visit(query ? `${basePath}?${query}` : basePath, {
    preserveState: true,
    preserveScroll: true
  })
}

// Visible columns
const visibleColumns = computed(() => {
  if (!props.modelMeta) return []
  const attrs = props.modelMeta.attributes
  const pk = props.modelMeta.primaryKey
  const cols = [pk]

  const candidates = Object.entries(attrs).filter(([name, attr]) => {
    if (name === pk) return false
    if (attr.autoCreatedAt || attr.autoUpdatedAt || attr.autoIncrement)
      return false
    if (attr.encrypt) return false
    return true
  })

  candidates.sort((a, b) => {
    const order = { string: 0, number: 1, boolean: 2, json: 3, ref: 4 }
    return (order[a[1].type] ?? 5) - (order[b[1].type] ?? 5)
  })

  for (const [name] of candidates.slice(0, 5)) {
    cols.push(name)
  }

  if (attrs.createdAt && !cols.includes('createdAt')) {
    cols.push('createdAt')
  }

  return cols
})

// Sort handling
const sortAttr = computed(() => sortValue.value.split(' ')[0])
const sortDir = computed(() => sortValue.value.split(' ')[1] || 'ASC')

function toggleSort(attr) {
  let newSort
  if (sortAttr.value === attr) {
    newSort = `${attr} ${sortDir.value === 'ASC' ? 'DESC' : 'ASC'}`
  } else {
    newSort = `${attr} ASC`
  }
  sortValue.value = newSort
  navigateWithParams({ sort: newSort, page: 1 })
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

// Cell rendering
function formatCell(value, attrName) {
  if (value === null || value === undefined) return null
  const attr = props.modelMeta?.attributes[attrName]
  if (!attr) return String(value)

  if (attr.autoCreatedAt || attr.autoUpdatedAt) {
    return formatDate(value)
  }
  if (attr.type === 'boolean') return value
  if (attr.type === 'json' || typeof value === 'object')
    return JSON.stringify(value)
  if (typeof value === 'string' && value.length > 60)
    return value.slice(0, 60) + '...'
  return String(value)
}

function formatDate(value) {
  if (!value) return ''
  try {
    const d = new Date(value)
    return d.toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    })
  } catch {
    return String(value)
  }
}

function isBooleanAttr(attrName) {
  return props.modelMeta?.attributes[attrName]?.type === 'boolean'
}

function isTimestamp(attrName) {
  const attr = props.modelMeta?.attributes[attrName]
  return attr?.autoCreatedAt || attr?.autoUpdatedAt
}

// Delete single record
function confirmDelete() {
  deleteForm.post(
    `/projects/${props.project.slug}/environments/${props.environment.slug}/bridge/${props.modelIdentity}/${deleteModal.value.recordId}/delete`,
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
    `/projects/${props.project.slug}/environments/${props.environment.slug}/bridge/${props.modelIdentity}/bulk-delete`,
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

// Pagination
function goToPage(newPage) {
  page.value = newPage
  navigateWithParams({ page: newPage })
}

// URL builders
function bridgeUrl() {
  return `/projects/${props.project.slug}/environments/${props.environment.slug}/bridge`
}
function recordUrl(id) {
  return `/projects/${props.project.slug}/environments/${props.environment.slug}/bridge/${props.modelIdentity}/${id}`
}
function editUrl(id) {
  return `/projects/${props.project.slug}/environments/${props.environment.slug}/bridge/${props.modelIdentity}/${id}/edit`
}
function createUrl() {
  return `/projects/${props.project.slug}/environments/${props.environment.slug}/bridge/${props.modelIdentity}/new`
}
</script>

<template>
  <Head :title="`${modelIdentity} - Bridge | Slipway`"></Head>
  <ToastContainer :toasts="toasts" @dismiss="dismiss" />

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
          <Link :href="bridgeUrl()" class="text-gray-500 dark:text-gray-400"
            >bridge</Link
          >
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <span class="font-medium text-gray-900 dark:text-white">{{
            modelIdentity
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
            modelIdentity
          }}</span>
        </nav>
      </div>
    </div>

    <!-- Toolbar -->
    <div class="px-4 py-4 sm:px-8">
      <div class="mx-auto flex max-w-6xl items-center justify-between">
        <div class="flex items-center space-x-3">
          <input
            v-model="searchInput"
            type="text"
            placeholder="Search records..."
            class="w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500 dark:focus:border-gray-600 sm:w-64"
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
              v-if="selectedIds.size > 0"
              class="flex items-center space-x-2"
            >
              <span class="text-xs text-gray-500 dark:text-gray-400"
                >{{ selectedIds.size }} selected</span
              >
              <button
                @click="bulkDeleteModal.show = true"
                class="inline-flex items-center rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30"
              >
                <svg
                  class="mr-1 h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
                Delete
              </button>
            </div>
          </Transition>
        </div>
        <div class="flex items-center space-x-4">
          <span
            v-if="total > 0"
            class="text-xs text-gray-500 dark:text-gray-400"
            >{{ total.toLocaleString() }} records</span
          >
          <Link
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
          class="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800"
        >
          <table class="w-full text-left text-sm">
            <thead
              class="border-b border-gray-200 bg-gray-50/50 dark:border-gray-800 dark:bg-gray-900/50"
            >
              <tr>
                <th class="w-10 px-4 py-2">
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
                  class="cursor-pointer select-none whitespace-nowrap px-4 py-2 text-xs font-medium uppercase tracking-wider text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                >
                  <span class="flex items-center space-x-1">
                    <span>{{ col }}</span>
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
                <th class="w-20 px-4 py-2"></th>
              </tr>
            </thead>
            <tbody
              v-if="records.length === 0"
              class="bg-white dark:bg-gray-950"
            >
              <tr>
                <td
                  :colspan="visibleColumns.length + 2"
                  class="px-4 py-12 text-center text-sm text-gray-500 dark:text-gray-400"
                >
                  {{ search ? 'No matching records.' : 'No records yet.' }}
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
                class="hover:bg-gray-50 dark:hover:bg-gray-900/30"
              >
                <td class="px-4 py-2">
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
                  <span v-if="isBooleanAttr(col)" class="flex items-center">
                    <span
                      :class="[
                        'inline-block h-2 w-2 rounded-full',
                        record[col]
                          ? 'bg-green-500'
                          : 'bg-gray-300 dark:bg-gray-600'
                      ]"
                    ></span>
                  </span>
                  <span
                    v-else-if="isTimestamp(col)"
                    class="text-gray-500 dark:text-gray-400"
                  >
                    {{ formatDate(record[col]) }}
                  </span>
                  <span
                    v-else-if="
                      record[col] === null || record[col] === undefined
                    "
                    class="text-gray-300 dark:text-gray-600"
                  >
                    null
                  </span>
                  <Link
                    v-else-if="col === modelMeta.primaryKey"
                    :href="recordUrl(record[col])"
                    class="font-medium text-gray-900 hover:underline dark:text-white"
                  >
                    {{ record[col] }}
                  </Link>
                  <span v-else class="text-gray-700 dark:text-gray-300">
                    {{ formatCell(record[col], col) }}
                  </span>
                </td>
                <td class="px-4 py-2">
                  <div class="flex items-center justify-end space-x-1">
                    <Link
                      :href="recordUrl(record[modelMeta.primaryKey])"
                      prefetch
                      class="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-white"
                      title="View"
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
                          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                        />
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                        />
                      </svg>
                    </Link>
                    <Link
                      :href="editUrl(record[modelMeta.primaryKey])"
                      prefetch
                      class="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-white"
                      title="Edit"
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
                          d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                        />
                      </svg>
                    </Link>
                    <button
                      @click="
                        deleteModal = {
                          show: true,
                          recordId: record[modelMeta.primaryKey],
                          loading: false
                        }
                      "
                      class="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                      title="Delete"
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
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                    </button>
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
</template>
