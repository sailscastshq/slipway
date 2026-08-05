<script setup>
import { router } from '@inertiajs/vue3'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import BridgeSearchInput from '@/components/bridge/BridgeSearchInput.vue'

const props = defineProps({
  relationship: {
    type: Object,
    required: true
  },
  optionsUrl: {
    type: String,
    required: true
  },
  mutationBaseUrl: {
    type: String,
    required: true
  }
})

const open = ref(false)
const triggerButton = ref(null)
const dialog = ref(null)
const searchInput = ref(null)
const query = ref('')
const options = ref([])
const loading = ref(false)
const error = ref('')
const processingId = ref('')
const page = ref(1)
const hasMore = ref(false)
let debounceTimer
let requestController

const canManage = computed(
  () => props.relationship.canAttach || props.relationship.canDetach
)

watch(query, () => {
  if (!open.value) return
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => loadOptions(1), 180)
})

async function show() {
  open.value = true
  await nextTick()
  searchInput.value?.focus()
  await loadOptions(1)
}

function close() {
  open.value = false
  query.value = ''
  error.value = ''
  nextTick(() => triggerButton.value?.focus())
}

async function loadOptions(nextPage, { append = false } = {}) {
  requestController?.abort()
  const controller = new AbortController()
  requestController = controller
  loading.value = true
  error.value = ''
  try {
    const url = new URL(props.optionsUrl, window.location.origin)
    url.searchParams.set('q', query.value)
    url.searchParams.set('page', String(nextPage))
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(data.error || 'Related records could not be loaded.')
    }
    options.value = append
      ? [...options.value, ...(data.options || [])]
      : data.options || []
    page.value = data.page || nextPage
    hasMore.value = data.hasMore === true
  } catch (loadError) {
    if (loadError.name !== 'AbortError') {
      error.value = loadError.message || 'Related records could not be loaded.'
    }
  } finally {
    if (requestController === controller) loading.value = false
  }
}

function handleDialogKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
    return
  }
  if (event.key !== 'Tab') return

  const focusable = Array.from(
    dialog.value?.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    ) || []
  )
  if (focusable.length === 0) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

function mutate(option) {
  const operation = option.attached ? 'detach' : 'attach'
  if (
    (operation === 'attach' && !props.relationship.canAttach) ||
    (operation === 'detach' && !props.relationship.canDetach)
  ) {
    return
  }

  processingId.value = String(option.id)
  error.value = ''
  router.post(
    `${props.mutationBaseUrl}/${operation}`,
    { relatedId: option.id },
    {
      preserveScroll: true,
      onSuccess: () => {
        option.attached = !option.attached
      },
      onError: (errors) => {
        error.value = errors.error || `The record could not be ${operation}ed.`
      },
      onFinish: () => {
        processingId.value = ''
      }
    }
  )
}

onBeforeUnmount(() => {
  clearTimeout(debounceTimer)
  requestController?.abort()
})
</script>

<template>
  <button
    v-if="canManage"
    ref="triggerButton"
    type="button"
    class="text-xs font-medium text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
    :aria-label="`Manage ${relationship.label.toLowerCase()}`"
    @click="show"
  >
    Manage
  </button>

  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/30 px-4 py-8 backdrop-blur-[1px] dark:bg-black/60"
      @mousedown.self="close"
    >
      <section
        ref="dialog"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="`bridge-${relationship.alias}-manager-title`"
        class="flex max-h-[min(680px,calc(100vh-4rem))] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-gray-900"
        @keydown="handleDialogKeydown"
      >
        <header
          class="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4 dark:border-gray-800"
        >
          <div>
            <h2
              :id="`bridge-${relationship.alias}-manager-title`"
              class="text-base font-semibold text-gray-900 dark:text-white"
            >
              {{ relationship.label }}
            </h2>
            <p class="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
              Search records, then attach or remove them.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close relationship manager"
            class="-mr-1 rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            @click="close"
          >
            <svg
              class="h-5 w-5"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                d="M5.22 5.22a.75.75 0 0 1 1.06 0L10 8.94l3.72-3.72a.75.75 0 1 1 1.06 1.06L11.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06L10 11.06l-3.72 3.72a.75.75 0 0 1-1.06-1.06L8.94 10 5.22 6.28a.75.75 0 0 1 0-1.06Z"
              />
            </svg>
          </button>
        </header>

        <div class="px-5 py-3">
          <label
            :for="`bridge-${relationship.alias}-manager-search`"
            class="sr-only"
            >Search {{ relationship.label.toLowerCase() }}</label
          >
          <BridgeSearchInput
            :id="`bridge-${relationship.alias}-manager-search`"
            ref="searchInput"
            v-model="query"
            :label="`Search ${relationship.label.toLowerCase()}`"
            :placeholder="`Search ${relationship.label.toLowerCase()}…`"
          />
        </div>

        <div class="min-h-40 flex-1 overflow-y-auto py-1">
          <div
            v-for="option in options"
            :key="String(option.id)"
            class="flex items-center justify-between gap-4 px-5 py-3"
          >
            <div class="min-w-0">
              <p
                class="truncate text-sm font-medium text-gray-900 dark:text-white"
              >
                {{ option.label }}
              </p>
              <p
                class="truncate font-mono text-xs text-gray-400 dark:text-gray-500"
                :title="String(option.id)"
              >
                {{ option.id }}
              </p>
            </div>
            <button
              v-if="
                (option.attached && relationship.canDetach) ||
                (!option.attached && relationship.canAttach)
              "
              type="button"
              :disabled="processingId === String(option.id)"
              :class="[
                'shrink-0 rounded-md px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50',
                option.attached
                  ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30'
                  : 'bg-gray-900 text-white hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100'
              ]"
              @click="mutate(option)"
            >
              {{
                processingId === String(option.id)
                  ? 'Saving…'
                  : option.attached
                  ? 'Remove'
                  : 'Attach'
              }}
            </button>
            <span
              v-else-if="option.attached"
              class="text-xs font-medium text-gray-400 dark:text-gray-500"
              >Attached</span
            >
          </div>

          <p
            v-if="!loading && !error && options.length === 0"
            class="px-5 py-10 text-center text-sm text-gray-400 dark:text-gray-500"
          >
            No matching records
          </p>
          <p
            v-if="loading"
            class="px-5 py-6 text-center text-sm text-gray-400 dark:text-gray-500"
            role="status"
          >
            Loading…
          </p>
          <p
            v-if="error"
            class="px-5 py-4 text-sm text-red-600 dark:text-red-400"
            role="alert"
          >
            {{ error }}
          </p>
          <button
            v-if="hasMore && !loading"
            type="button"
            class="w-full px-5 py-3 text-left text-xs font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
            @click="loadOptions(page + 1, { append: true })"
          >
            Load more
          </button>
        </div>
      </section>
    </div>
  </Teleport>
</template>
