<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import Combobox from '@/components/ui/combobox/Combobox.vue'
import Chips from '@/components/ui/chips/Chips.vue'
const props = defineProps({
  id: String,
  modelValue: { type: Array, default: () => [] },
  searchUrl: { type: String, required: true },
  dependencies: { type: Object, default: () => ({}) },
  recordId: [String, Number],
  conditionToken: String,
  invalid: Boolean,
  describedBy: String
})
const emit = defineEmits(['update:modelValue', 'blur'])
const query = ref(''),
  options = ref([]),
  known = ref(new Map()),
  loading = ref(false),
  error = ref(''),
  hasMore = ref(false)
let request,
  sequence = 0
const available = computed(() =>
  options.value.filter((o) => !props.modelValue.includes(o.value))
)
const dependencyKey = computed(() => JSON.stringify(props.dependencies))
watch(dependencyKey, () => {
  request?.abort()
  sequence++
  options.value = []
  known.value = new Map()
  query.value = ''
  error.value = ''
  loading.value = false
  emit('update:modelValue', [])
})
async function search(q = '') {
  request?.abort()
  const controller = new AbortController()
  request = controller
  const current = ++sequence
  loading.value = true
  error.value = ''
  try {
    const url = new URL(props.searchUrl, window.location.origin)
    url.searchParams.set('recordId', props.recordId)
    url.searchParams.set('q', q.slice(0, 100))
    url.searchParams.set('dependencies', dependencyKey.value)
    if (props.conditionToken)
      url.searchParams.set('conditionToken', props.conditionToken)
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal
    })
    const data = await response.json()
    if (!response.ok)
      throw new Error(data.error || 'Options could not be loaded.')
    if (current !== sequence) return
    options.value = data.options
    hasMore.value = data.hasMore === true
    for (const item of data.options) known.value.set(item.value, item)
  } catch (cause) {
    if (current === sequence && cause.name !== 'AbortError') {
      options.value = []
      error.value = 'Could not load people. Try searching again.'
    }
  } finally {
    if (current === sequence) loading.value = false
  }
}
async function select(value) {
  if (
    !available.value.some((o) => o.value === value) ||
    props.modelValue.length >= 100
  )
    return
  emit('update:modelValue', [...props.modelValue, value])
  await nextTick()
  query.value = ''
}
function setQuery(value) {
  request?.abort()
  sequence++
  loading.value = false
  query.value = value
  options.value = []
}
onBeforeUnmount(() => {
  sequence++
  request?.abort()
})
</script>
<template>
  <div>
    <Chips
      v-if="modelValue.length"
      class="selected-chips mb-2"
      :model-value="modelValue"
      :format-value="(id) => known.get(id)?.label || id"
      :normalize-value="
        () => {
          throw new Error('Choose from search results.')
        }
      "
      @update:model-value="emit('update:modelValue', $event)"
    />
    <Combobox
      :id="id"
      :model-value="null"
      :query="query"
      :options="available"
      :loading="loading"
      :error="error"
      :aria-invalid="invalid || undefined"
      :aria-describedby="describedBy"
      placeholder="Search by name or email"
      empty-text="No eligible people found."
      class="focus:border-brand dark:focus:border-brand rounded-none border-0 border-b border-dashed border-gray-200 bg-transparent px-1 text-sm shadow-none focus:outline-none dark:border-gray-700 dark:bg-transparent dark:focus:outline-none"
      @update:query="setQuery"
      @search="search"
      @update:open="
        (open) => {
          if (open) search(query)
        }
      "
      @update:model-value="select"
      @blur="emit('blur')"
    />
    <p v-if="hasMore" class="mt-1 text-xs text-gray-500">
      More people match. Keep typing to narrow the search.
    </p>
    <p v-if="modelValue.length" class="mt-1 text-xs text-gray-500">
      {{ modelValue.length }}
      {{ modelValue.length === 1 ? 'person' : 'people' }} selected
    </p>
  </div>
</template>
<style scoped>
.selected-chips :deep(input) {
  display: none;
}
</style>
