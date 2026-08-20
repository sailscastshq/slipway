<script setup>
import Input from '@/components/ui/input/Input.vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import BridgeRelationshipSelect from '@/components/bridge/BridgeRelationshipSelect.vue'
import Select from '@/components/ui/select/Select.vue'

const props = defineProps({
  definitions: {
    type: Object,
    default: () => ({})
  },
  modelValue: {
    type: Object,
    default: () => ({})
  },
  relationshipBaseUrl: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['apply'])

const root = ref(null)
const trigger = ref(null)
const panel = ref(null)
const open = ref(false)
const draft = ref({})
const initialSerialized = ref('{}')

const filters = computed(() => Object.values(props.definitions || {}))
const activeCount = computed(() => Object.keys(props.modelValue || {}).length)
const hasDraft = computed(() => Object.keys(serializeDraft()).length > 0)
const changed = computed(
  () => stableStringify(serializeDraft()) !== initialSerialized.value
)

watch(
  () => props.modelValue,
  () => {
    if (!open.value) resetDraft()
  },
  { deep: true, immediate: true }
)

function blankFilter(definition) {
  return {
    operator: definition.defaultOperator,
    value: '',
    from: '',
    to: ''
  }
}

function resetDraft() {
  const next = {}
  for (const definition of filters.value) {
    const current = props.modelValue?.[definition.field]
    next[definition.field] = current
      ? {
          ...blankFilter(definition),
          ...current,
          from: toInputDate(definition, current.from),
          to: toInputDate(definition, current.to)
        }
      : blankFilter(definition)
  }
  draft.value = next
  initialSerialized.value = stableStringify(serializeDraft())
}

async function show() {
  resetDraft()
  open.value = true
  await nextTick()
  panel.value?.querySelector('select, input, button:not([disabled])')?.focus()
}

function hide({ restoreFocus = false } = {}) {
  open.value = false
  resetDraft()
  if (restoreFocus) nextTick(() => trigger.value?.focus())
}

function toggle() {
  if (open.value) hide()
  else show()
}

function apply() {
  emit('apply', serializeDraft())
  open.value = false
  nextTick(() => trigger.value?.focus())
}

function clear() {
  draft.value = Object.fromEntries(
    filters.value.map((definition) => [
      definition.field,
      blankFilter(definition)
    ])
  )
}

function clearAndApply() {
  clear()
  emit('apply', {})
  open.value = false
  nextTick(() => trigger.value?.focus())
}

function serializeDraft() {
  const values = {}
  for (const definition of filters.value) {
    const state = draft.value[definition.field]
    if (!state) continue

    if (['isNull', 'isNotNull'].includes(state.operator)) {
      values[definition.field] = { operator: state.operator }
      continue
    }
    if (state.operator === 'between') {
      if (hasValue(state.from) || hasValue(state.to)) {
        values[definition.field] = {
          operator: 'between',
          ...(hasValue(state.from) ? { from: state.from } : {}),
          ...(hasValue(state.to) ? { to: state.to } : {})
        }
      }
      continue
    }
    if (hasValue(state.value)) {
      values[definition.field] = {
        operator: state.operator,
        value: state.value
      }
    }
  }
  return values
}

function hasValue(value) {
  return value !== '' && value !== null && value !== undefined
}

function supportsValue(definition) {
  return !['isNull', 'isNotNull'].includes(
    draft.value[definition.field]?.operator
  )
}

function isRange(definition) {
  return draft.value[definition.field]?.operator === 'between'
}

function isText(definition) {
  return ['text', 'textarea', 'richtext', 'email', 'url'].includes(
    definition.type
  )
}

function inputType(definition) {
  if (definition.type === 'date') return 'date'
  if (['datetime', 'timestamp'].includes(definition.type)) {
    return 'datetime-local'
  }
  return 'number'
}

function operatorLabel(operator) {
  return (
    {
      contains: 'Contains',
      equals: 'Is',
      between: 'Between',
      isNull: 'Is empty',
      isNotNull: 'Is not empty'
    }[operator] || operator
  )
}

function fieldId(definition, suffix) {
  return `bridge-filter-${definition.field}-${suffix}`.replace(
    /[^A-Za-z0-9_-]/g,
    '-'
  )
}

function relationshipUrl(definition) {
  if (!props.relationshipBaseUrl) return ''
  return `${props.relationshipBaseUrl}/${encodeURIComponent(
    definition.field
  )}/options?surface=filter`
}

function toInputDate(definition, value) {
  if (!value || !['datetime', 'timestamp'].includes(definition.type)) {
    return value || ''
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function stableStringify(value) {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(value || {}).sort(([left], [right]) =>
        left.localeCompare(right)
      )
    )
  )
}

function handleDocumentPointerDown(event) {
  if (open.value && root.value && !root.value.contains(event.target)) {
    hide()
  }
}

function handleKeydown(event) {
  if (event.key === 'Escape' && open.value) {
    event.preventDefault()
    hide({ restoreFocus: true })
  }
}

onMounted(() => {
  document.addEventListener('pointerdown', handleDocumentPointerDown)
  document.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleDocumentPointerDown)
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <div ref="root" class="relative" data-test="bridge-filter-menu">
    <button
      ref="trigger"
      type="button"
      :aria-expanded="open"
      aria-haspopup="dialog"
      aria-controls="bridge-filter-panel"
      class="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 motion-reduce:transition-none dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white dark:focus-visible:ring-gray-700"
      data-test="bridge-filter-toggle"
      @click="toggle"
    >
      <svg
        class="h-4 w-4"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        aria-hidden="true"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M3.5 5.25h13M5.75 10h8.5M8 14.75h4"
        />
      </svg>
      Filter
      <span
        v-if="activeCount"
        class="min-w-4 flex h-4 items-center justify-center rounded-full bg-gray-900 px-1 text-[10px] font-semibold text-white dark:bg-white dark:text-gray-900"
      >
        {{ activeCount }}
      </span>
    </button>

    <form
      v-if="open"
      id="bridge-filter-panel"
      ref="panel"
      role="dialog"
      aria-label="Filter records"
      class="absolute left-0 z-40 mt-2 w-[22rem] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl shadow-gray-900/10 dark:border-gray-700 dark:bg-gray-900 dark:shadow-black/30"
      data-test="bridge-filter-panel"
      @submit.prevent="apply"
    >
      <div class="flex items-center justify-between px-4 pb-2 pt-3.5">
        <p class="text-sm font-semibold text-gray-900 dark:text-white">
          Filter records
        </p>
        <button
          v-if="hasDraft"
          type="button"
          class="text-xs font-medium text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          @click="clear"
        >
          Clear
        </button>
      </div>

      <div class="max-h-[28rem] space-y-4 overflow-y-auto px-4 py-2">
        <div
          v-for="definition in filters"
          :key="definition.field"
          class="space-y-1.5"
        >
          <div class="flex items-center justify-between gap-3">
            <label
              :for="fieldId(definition, 'operator')"
              class="truncate text-xs font-medium text-gray-600 dark:text-gray-300"
            >
              {{ definition.label }}
            </label>
            <Select
              :id="fieldId(definition, 'operator')"
              v-model="draft[definition.field].operator"
              :options="
                definition.operators.map((operator) => ({
                  value: operator,
                  label: operatorLabel(operator)
                }))
              "
              class="border-0 bg-transparent py-0 pl-1 pr-5 text-right text-xs text-gray-500 focus:ring-0 dark:bg-gray-900 dark:text-gray-400"
            />
          </div>

          <div v-if="supportsValue(definition)">
            <div
              v-if="isRange(definition)"
              class="grid grid-cols-[1fr_auto_1fr] items-center gap-2"
            >
              <label :for="fieldId(definition, 'from')" class="sr-only">
                {{ definition.label }} from
              </label>
              <Input
                :id="fieldId(definition, 'from')"
                v-model="draft[definition.field].from"
                :type="inputType(definition)"
                :step="
                  ['number', 'currency'].includes(definition.type)
                    ? 'any'
                    : undefined
                "
                placeholder="From"
                class="focus:border-brand min-w-0 border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
              />
              <span class="text-xs text-gray-400 dark:text-gray-500">to</span>
              <label :for="fieldId(definition, 'to')" class="sr-only">
                {{ definition.label }} to
              </label>
              <Input
                :id="fieldId(definition, 'to')"
                v-model="draft[definition.field].to"
                :type="inputType(definition)"
                :step="
                  ['number', 'currency'].includes(definition.type)
                    ? 'any'
                    : undefined
                "
                placeholder="To"
                class="focus:border-brand min-w-0 border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
              />
            </div>

            <Input
              v-else-if="isText(definition)"
              :id="fieldId(definition, 'value')"
              v-model="draft[definition.field].value"
              type="text"
              :aria-label="`${definition.label} value`"
              :placeholder="`${operatorLabel(
                draft[definition.field].operator
              )}…`"
              class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
            />

            <Select
              v-else-if="definition.type === 'boolean'"
              :id="fieldId(definition, 'value')"
              v-model="draft[definition.field].value"
              :options="[
                { value: '', label: 'Choose…' },
                { value: 'true', label: 'Yes' },
                { value: 'false', label: 'No' }
              ]"
              :aria-label="`${definition.label} value`"
              class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-0 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            />

            <Select
              v-else-if="definition.type === 'select'"
              :id="fieldId(definition, 'value')"
              v-model="draft[definition.field].value"
              :options="[
                { value: '', label: 'Choose…' },
                ...(definition.options || []).map((option) => ({
                  value: option.value,
                  label: option.label,
                  disabled: option.disabled
                }))
              ]"
              :aria-label="`${definition.label} value`"
              class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-0 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            />

            <BridgeRelationshipSelect
              v-else-if="definition.type === 'belongsTo'"
              :id="fieldId(definition, 'value')"
              :label="definition.label"
              v-model="draft[definition.field].value"
              :search-url="relationshipUrl(definition)"
              :searchable="definition.relationship?.searchable !== false"
            />

            <Input
              v-else
              :id="fieldId(definition, 'value')"
              v-model="draft[definition.field].value"
              :type="inputType(definition)"
              :aria-label="`${definition.label} value`"
              step="any"
              class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
            />
          </div>
        </div>
      </div>

      <div
        class="flex items-center justify-between border-t border-gray-100 px-4 py-3 dark:border-gray-800"
      >
        <button
          type="button"
          class="text-xs font-medium text-gray-500 hover:text-gray-900 disabled:cursor-default disabled:opacity-40 dark:text-gray-400 dark:hover:text-white"
          :disabled="activeCount === 0"
          @click="clearAndApply"
        >
          Reset filters
        </button>
        <button
          type="submit"
          :disabled="!changed"
          class="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
        >
          Apply
        </button>
      </div>
    </form>
  </div>
</template>
