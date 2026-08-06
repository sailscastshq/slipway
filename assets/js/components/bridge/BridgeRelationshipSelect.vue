<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import BridgeSearchInput from '@/components/bridge/BridgeSearchInput.vue'

const props = defineProps({
  id: {
    type: String,
    required: true
  },
  label: {
    type: String,
    required: true
  },
  modelValue: {
    default: null
  },
  options: {
    type: Array,
    default: () => []
  },
  searchUrl: {
    type: String,
    default: ''
  },
  searchable: {
    type: Boolean,
    default: true
  },
  placeholder: {
    type: String,
    default: ''
  },
  searchPlaceholder: {
    type: String,
    default: ''
  },
  emptyText: {
    type: String,
    default: ''
  },
  required: Boolean,
  disabled: Boolean,
  invalid: Boolean,
  describedBy: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['update:modelValue', 'blur'])

const root = ref(null)
const searchInput = ref(null)
const open = ref(false)
const query = ref('')
const results = ref([])
const loading = ref(false)
const loadError = ref('')
const page = ref(1)
const hasMore = ref(false)
const openAbove = ref(false)
let debounceTimer
let requestController
const optionCache = new Map()

const allOptions = computed(() => {
  const merged = new Map()
  for (const option of [...props.options, ...results.value]) {
    merged.set(String(option.id), option)
  }
  return Array.from(merged.values())
})
const selected = computed(() =>
  allOptions.value.find(
    (option) => String(option.id) === String(props.modelValue)
  )
)
const listboxId = computed(() => `${props.id}-options`)

watch(
  () => props.options,
  (options) => {
    results.value = [...options]
  },
  { immediate: true }
)

watch(query, () => {
  if (!open.value || !props.searchUrl) return
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => loadOptions(1), 180)
})

watch(
  () => props.searchUrl,
  (searchUrl, previousUrl) => {
    if (searchUrl === previousUrl) return
    clearTimeout(debounceTimer)
    requestController?.abort()
    query.value = ''
    results.value = []
    page.value = 1
    hasMore.value = false
    loadError.value = ''
    if (searchUrl) void loadOptions(1)
  }
)

async function showOptions() {
  if (props.disabled) return
  const bounds = root.value?.getBoundingClientRect()
  openAbove.value =
    Boolean(bounds) &&
    bounds.bottom + 300 > window.innerHeight &&
    bounds.top > 300
  open.value = true
  loadError.value = ''
  if (props.searchUrl) await loadOptions(1)
  if (props.searchable) {
    await nextTick()
    searchInput.value?.focus()
  }
}

function hideOptions({ blur = true } = {}) {
  open.value = false
  query.value = ''
  if (blur) emit('blur')
}

async function loadOptions(nextPage, { append = false } = {}) {
  if (!props.searchUrl) return
  requestController?.abort()
  const controller = new AbortController()
  requestController = controller
  loading.value = true
  loadError.value = ''

  try {
    const url = new URL(props.searchUrl, window.location.origin)
    url.searchParams.set('q', query.value)
    url.searchParams.set('page', String(nextPage))
    const cacheKey = url.toString()
    if (optionCache.has(cacheKey)) {
      applyOptions(optionCache.get(cacheKey), nextPage, append)
      loading.value = false
      return
    }
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(data.error || 'Relationships could not be loaded.')
    }
    if (requestController !== controller) return
    cacheOptions(cacheKey, data)
    applyOptions(data, nextPage, append)
  } catch (error) {
    if (error.name !== 'AbortError') {
      loadError.value = error.message || 'Relationships could not be loaded.'
    }
  } finally {
    if (requestController === controller) loading.value = false
  }
}

function applyOptions(data, nextPage, append) {
  results.value = append
    ? [...results.value, ...(data.options || [])]
    : data.options || []
  page.value = data.page || nextPage
  hasMore.value = data.hasMore === true
}

function cacheOptions(key, data) {
  optionCache.set(key, data)
  if (optionCache.size <= 100) return
  optionCache.delete(optionCache.keys().next().value)
}

function choose(option) {
  if (option?.outOfScope) return
  emit('update:modelValue', option ? option.id : '')
  hideOptions()
}

function handleDocumentPointerDown(event) {
  if (open.value && root.value && !root.value.contains(event.target)) {
    hideOptions()
  }
}

onMounted(() => {
  document.addEventListener('pointerdown', handleDocumentPointerDown)
})

onBeforeUnmount(() => {
  clearTimeout(debounceTimer)
  requestController?.abort()
  document.removeEventListener('pointerdown', handleDocumentPointerDown)
})
</script>

<template>
  <div ref="root" class="relative">
    <button
      :id="id"
      type="button"
      role="combobox"
      :aria-label="label"
      :aria-expanded="open"
      :aria-controls="listboxId"
      aria-autocomplete="list"
      :aria-invalid="invalid ? 'true' : undefined"
      :aria-describedby="describedBy || undefined"
      :disabled="disabled"
      :data-test="`${id}-input`"
      class="focus:border-brand flex h-11 w-full items-center justify-between border-b border-dashed border-gray-200 bg-transparent px-1 text-left text-sm text-gray-900 focus:outline-none disabled:cursor-not-allowed disabled:text-gray-400 dark:border-gray-700 dark:text-white"
      @click="open ? hideOptions() : showOptions()"
      @keydown.down.prevent="showOptions"
      @keydown.esc.prevent="hideOptions"
    >
      <span
        :class="
          selected ? 'truncate' : 'truncate text-gray-400 dark:text-gray-500'
        "
      >
        {{ selected?.label || placeholder || (required ? 'Select…' : 'None') }}
      </span>
      <svg
        class="ml-3 h-4 w-4 shrink-0 text-gray-400 transition"
        :class="{ 'rotate-180': open }"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path
          fill-rule="evenodd"
          d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.168l3.71-3.938a.75.75 0 1 1 1.08 1.04l-4.25 4.51a.75.75 0 0 1-1.08 0l-4.25-4.51a.75.75 0 0 1 .02-1.06Z"
          clip-rule="evenodd"
        />
      </svg>
    </button>

    <div
      v-if="open"
      :class="[
        'absolute z-40 w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl shadow-gray-900/10 dark:border-gray-700 dark:bg-gray-900 dark:shadow-black/30',
        openAbove ? 'bottom-full mb-2' : 'mt-2'
      ]"
    >
      <div v-if="searchable && searchUrl" class="px-3 py-2">
        <label :for="`${id}-search`" class="sr-only"
          >Search {{ label.toLowerCase() }}</label
        >
        <BridgeSearchInput
          :id="`${id}-search`"
          ref="searchInput"
          v-model="query"
          :label="`Search ${label.toLowerCase()}`"
          :placeholder="searchPlaceholder || `Search ${label.toLowerCase()}…`"
          @keydown.esc.prevent="hideOptions"
        />
      </div>

      <div
        :id="listboxId"
        role="listbox"
        :aria-label="`${label} options`"
        class="max-h-64 overflow-y-auto py-1"
      >
        <button
          v-if="!required"
          type="button"
          role="option"
          :aria-selected="
            modelValue === '' || modelValue === null || modelValue === undefined
          "
          class="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-gray-500 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800"
          @click="choose(null)"
        >
          None
        </button>
        <button
          v-for="option in results"
          :key="String(option.id)"
          type="button"
          role="option"
          :aria-selected="String(option.id) === String(modelValue)"
          :disabled="option.outOfScope"
          class="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm text-gray-900 hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-amber-700 dark:text-white dark:hover:bg-gray-800 dark:disabled:text-amber-300"
          @click="choose(option)"
        >
          <span class="truncate">{{ option.label }}</span>
          <svg
            v-if="String(option.id) === String(modelValue)"
            class="text-brand h-4 w-4 shrink-0"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fill-rule="evenodd"
              d="M16.704 5.29a1 1 0 0 1 .006 1.414l-7.2 7.26a1 1 0 0 1-1.42.002l-3.8-3.82a1 1 0 1 1 1.42-1.412l3.09 3.107 6.49-6.545a1 1 0 0 1 1.414-.006Z"
              clip-rule="evenodd"
            />
          </svg>
        </button>

        <p
          v-if="!loading && !loadError && results.length === 0"
          class="px-3 py-6 text-center text-sm text-gray-400 dark:text-gray-500"
        >
          {{
            query
              ? `No matching ${label.toLowerCase()}`
              : emptyText || `No ${label.toLowerCase()} available`
          }}
        </p>
        <p
          v-if="loadError"
          class="px-3 py-4 text-sm text-red-600 dark:text-red-400"
          role="alert"
        >
          {{ loadError }}
        </p>
        <p
          v-if="loading"
          class="px-3 py-4 text-sm text-gray-400 dark:text-gray-500"
          role="status"
        >
          Loading…
        </p>
        <button
          v-if="hasMore && !loading"
          type="button"
          class="w-full px-3 py-2 text-left text-xs font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
          @click="loadOptions(page + 1, { append: true })"
        >
          Load more
        </button>
      </div>
    </div>
  </div>
</template>
