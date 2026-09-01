<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import Combobox from '@/components/ui/combobox/Combobox.vue'

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
const query = ref('')
const results = ref([])
const loading = ref(false)
const loadError = ref('')
const page = ref(1)
const hasMore = ref(false)
let requestController
const optionCache = new Map()

const allOptions = computed(() => {
  const merged = new Map()
  for (const option of [...props.options, ...results.value]) {
    merged.set(String(option.id ?? option.value), option)
  }
  return [...merged.values()]
})

const comboboxOptions = computed(() => {
  const options = allOptions.value.map((option) => ({
    value: option.id ?? option.value,
    label: option.label,
    description:
      option.description ||
      (option.outOfScope ? 'Unavailable for the current selection.' : ''),
    disabled: option.disabled || option.outOfScope,
    group: option.group,
    keywords: [
      ...(props.searchUrl && query.value ? [query.value] : []),
      ...(option.keywords || [])
    ]
  }))

  if (!props.required) {
    options.unshift({
      value: '',
      label: 'None',
      keywords: props.searchUrl && query.value ? [query.value] : []
    })
  }

  return options
})

const resolvedPlaceholder = computed(
  () =>
    props.placeholder ||
    props.searchPlaceholder ||
    (props.required ? `Search ${props.label.toLowerCase()}…` : 'None')
)

const resolvedEmptyText = computed(
  () => props.emptyText || `No ${props.label.toLowerCase()} available.`
)

watch(
  () => props.searchUrl,
  (searchUrl, previousUrl) => {
    if (searchUrl === previousUrl) return
    requestController?.abort()
    optionCache.clear()
    query.value = ''
    results.value = []
    page.value = 1
    hasMore.value = false
    loadError.value = ''
  }
)

function handleQuery(nextQuery) {
  if (nextQuery !== query.value) requestController?.abort()
  query.value = nextQuery
}

function handleSearch(nextQuery) {
  if (!props.searchUrl) return
  void loadOptions(1, { requestedQuery: nextQuery })
}

async function handleOpen(nextOpen) {
  if (!nextOpen || !props.searchUrl || results.value.length) return
  await loadOptions(1)
  await fillVisibleOptions()
}

async function loadOptions(
  nextPage,
  { append = false, requestedQuery = query.value } = {}
) {
  if (!props.searchUrl || loading.value) return

  requestController?.abort()
  const controller = new AbortController()
  requestController = controller
  loading.value = true
  loadError.value = ''

  try {
    const url = new URL(props.searchUrl, window.location.origin)
    url.searchParams.set('q', requestedQuery)
    url.searchParams.set('page', String(nextPage))
    const cacheKey = url.toString()
    let data = optionCache.get(cacheKey)

    if (!data) {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: controller.signal
      })
      data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error || 'Relationships could not be loaded.')
      }
      cacheOptions(cacheKey, data)
    }

    if (requestController !== controller || requestedQuery !== query.value) {
      return
    }

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
  const resolvedPage = Number(data.page || nextPage)
  if (append && resolvedPage <= page.value) {
    hasMore.value = false
    return
  }

  results.value = append
    ? [...results.value, ...(data.options || [])]
    : data.options || []
  page.value = resolvedPage
  hasMore.value = data.hasMore === true
}

function cacheOptions(key, data) {
  optionCache.set(key, data)
  if (optionCache.size <= 100) return
  optionCache.delete(optionCache.keys().next().value)
}

async function fillVisibleOptions(attempt = 0) {
  if (!hasMore.value || loading.value || attempt >= 4) return
  await nextTick()
  const listbox = root.value?.querySelector?.('[data-slot="combobox-listbox"]')
  if (!listbox || listbox.scrollHeight > listbox.clientHeight + 1) return

  await loadOptions(page.value + 1, { append: true })
  await fillVisibleOptions(attempt + 1)
}

function handleScroll(event) {
  const listbox = event.target?.closest?.('[data-slot="combobox-listbox"]')
  if (!listbox || !hasMore.value || loading.value) return
  const remaining =
    listbox.scrollHeight - listbox.scrollTop - listbox.clientHeight
  if (remaining <= 48) {
    void loadOptions(page.value + 1, { append: true })
  }
}

onBeforeUnmount(() => requestController?.abort())
</script>

<template>
  <div
    ref="root"
    data-slot="bridge-relationship-combobox"
    class="relative [&_[data-slot=combobox-content]]:rounded-lg [&_[data-slot=combobox-option]]:rounded-none"
    @scroll.capture="handleScroll"
  >
    <Combobox
      :id="id"
      :model-value="modelValue"
      :query="query"
      :options="comboboxOptions"
      :placeholder="resolvedPlaceholder"
      :empty-text="resolvedEmptyText"
      :loading="loading"
      :error="loadError"
      :search-delay="180"
      :required="required"
      :disabled="disabled"
      :readonly="!searchable"
      :aria-label="label"
      :aria-invalid="invalid ? 'true' : undefined"
      :aria-describedby="describedBy || undefined"
      :data-test="`${id}-input`"
      class="focus-visible:text-brand dark:focus-visible:text-brand-400 min-h-11 h-11 rounded-none border-0 bg-transparent px-1 py-1.5 pr-8 text-left text-sm shadow-none focus-visible:outline-none"
      style="
        border: 0;
        border-radius: 0;
        box-shadow: none;
        background: transparent;
      "
      @update:model-value="emit('update:modelValue', $event)"
      @update:query="handleQuery"
      @update:open="handleOpen"
      @search="handleSearch"
      @blur="emit('blur')"
    />
  </div>
</template>
