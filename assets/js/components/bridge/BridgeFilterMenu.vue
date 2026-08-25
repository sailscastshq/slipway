<script setup>
import Input from '@/components/ui/input/Input.vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import BridgeRelationshipCombobox from '@/components/bridge/BridgeRelationshipCombobox.vue'
import Select from '@/components/ui/select/Select.vue'
import FilterBar from '@/components/ui/filter-bar/FilterBar.vue'
import Badge from '@/components/ui/badge/Badge.vue'

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
  },
  busy: Boolean
})

const emit = defineEmits(['apply'])

const filterBar = ref(null)
const trigger = ref(null)
const panel = ref(null)
const open = ref(false)

const filters = computed(() => Object.values(props.definitions || {}))
const activeCount = computed(() => Object.keys(props.modelValue || {}).length)

function blankFilter(definition) {
  return {
    operator: definition.defaultOperator,
    value: '',
    from: '',
    to: ''
  }
}

function stateFor(draft, definition) {
  const current = draft?.[definition.field]
  if (!current) return blankFilter(definition)
  return {
    ...blankFilter(definition),
    ...current,
    from: toInputDate(definition, current.from),
    to: toInputDate(definition, current.to)
  }
}

async function show() {
  open.value = true
  await nextTick()
  panel.value?.querySelector('select, input, button:not([disabled])')?.focus()
}

function hide({ restoreFocus = false } = {}) {
  open.value = false
  filterBar.value?.cancel()
  if (restoreFocus) nextTick(() => trigger.value?.focus())
}

function toggle() {
  if (open.value) hide()
  else show()
}

function handleApply(draft) {
  const filters = serializeDraft(draft)
  if (stableStringify(filters) !== stableStringify(props.modelValue)) {
    emit('apply', filters)
  }
  open.value = false
  nextTick(() => trigger.value?.focus())
}

function handleClear(filters) {
  emit('apply', filters)
  open.value = false
  nextTick(() => trigger.value?.focus())
}

function clearDraft(filter) {
  for (const definition of filters.value) {
    filter.update(definition.field, undefined)
  }
}

function serializeDraft(draft) {
  const values = {}
  for (const definition of filters.value) {
    const state = draft?.[definition.field]
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

function updateField(filter, definition, patch) {
  filter.update(definition.field, {
    ...stateFor(filter.draft, definition),
    ...patch
  })
}

function hasDraft(draft) {
  return Object.keys(serializeDraft(draft)).length > 0
}

function changed(draft) {
  return (
    stableStringify(serializeDraft(draft)) !== stableStringify(props.modelValue)
  )
}

function hasValue(value) {
  return value !== '' && value !== null && value !== undefined
}

function supportsValue(draft, definition) {
  return !['isNull', 'isNotNull'].includes(stateFor(draft, definition).operator)
}

function isRange(draft, definition) {
  return stateFor(draft, definition).operator === 'between'
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
  const root = filterBar.value?.root?.value || filterBar.value?.root
  if (open.value && root && !root.contains(event.target)) {
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
  <FilterBar
    ref="filterBar"
    :model-value="modelValue"
    :busy="busy"
    label="Filter records"
    class="relative"
    data-test="bridge-filter-menu"
    @apply="handleApply"
    @clear="handleClear"
    v-slot="filter"
  >
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
      <Badge
        v-if="activeCount"
        class="min-w-4 h-4 justify-center bg-gray-900 px-1 text-[10px] font-semibold tabular-nums text-white dark:bg-white dark:text-gray-900"
      >
        {{ activeCount }}
      </Badge>
    </button>

    <div
      v-if="open"
      id="bridge-filter-panel"
      ref="panel"
      role="dialog"
      aria-label="Filter records"
      class="absolute left-0 z-40 mt-2 w-[22rem] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl shadow-gray-900/10 dark:border-gray-700 dark:bg-gray-900 dark:shadow-black/30"
      data-test="bridge-filter-panel"
    >
      <div class="flex items-center justify-between px-4 pb-2 pt-3.5">
        <p class="text-sm font-semibold text-gray-900 dark:text-white">
          Filter records
        </p>
        <button
          v-if="hasDraft(filter.draft)"
          type="button"
          class="text-xs font-medium text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          @click="clearDraft(filter)"
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
              :model-value="stateFor(filter.draft, definition).operator"
              :options="
                definition.operators.map((operator) => ({
                  value: operator,
                  label: operatorLabel(operator)
                }))
              "
              class="border-0 bg-transparent py-0 pl-1 pr-5 text-right text-xs text-gray-500 focus:ring-0 dark:bg-gray-900 dark:text-gray-400"
              @update:model-value="
                updateField(filter, definition, { operator: $event })
              "
            />
          </div>

          <div v-if="supportsValue(filter.draft, definition)">
            <div
              v-if="isRange(filter.draft, definition)"
              class="grid grid-cols-[1fr_auto_1fr] items-center gap-2"
            >
              <label :for="fieldId(definition, 'from')" class="sr-only">
                {{ definition.label }} from
              </label>
              <Input
                :id="fieldId(definition, 'from')"
                :model-value="stateFor(filter.draft, definition).from"
                :type="inputType(definition)"
                :step="
                  ['number', 'currency'].includes(definition.type)
                    ? 'any'
                    : undefined
                "
                placeholder="From"
                class="focus:border-brand min-w-0 border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
                @update:model-value="
                  updateField(filter, definition, { from: $event })
                "
              />
              <span class="text-xs text-gray-400 dark:text-gray-500">to</span>
              <label :for="fieldId(definition, 'to')" class="sr-only">
                {{ definition.label }} to
              </label>
              <Input
                :id="fieldId(definition, 'to')"
                :model-value="stateFor(filter.draft, definition).to"
                :type="inputType(definition)"
                :step="
                  ['number', 'currency'].includes(definition.type)
                    ? 'any'
                    : undefined
                "
                placeholder="To"
                class="focus:border-brand min-w-0 border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
                @update:model-value="
                  updateField(filter, definition, { to: $event })
                "
              />
            </div>

            <Input
              v-else-if="isText(definition)"
              :id="fieldId(definition, 'value')"
              :model-value="stateFor(filter.draft, definition).value"
              type="text"
              :aria-label="`${definition.label} value`"
              :placeholder="`${operatorLabel(
                stateFor(filter.draft, definition).operator
              )}…`"
              class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
              @update:model-value="
                updateField(filter, definition, { value: $event })
              "
            />

            <Select
              v-else-if="definition.type === 'boolean'"
              :id="fieldId(definition, 'value')"
              :model-value="stateFor(filter.draft, definition).value"
              :options="[
                { value: '', label: 'Choose…' },
                { value: 'true', label: 'Yes' },
                { value: 'false', label: 'No' }
              ]"
              :aria-label="`${definition.label} value`"
              class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-0 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              @update:model-value="
                updateField(filter, definition, { value: $event })
              "
            />

            <Select
              v-else-if="definition.type === 'select'"
              :id="fieldId(definition, 'value')"
              :model-value="stateFor(filter.draft, definition).value"
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
              @update:model-value="
                updateField(filter, definition, { value: $event })
              "
            />

            <BridgeRelationshipCombobox
              v-else-if="definition.type === 'belongsTo'"
              :id="fieldId(definition, 'value')"
              :label="definition.label"
              :model-value="stateFor(filter.draft, definition).value"
              :search-url="relationshipUrl(definition)"
              :searchable="definition.relationship?.searchable !== false"
              @update:model-value="
                updateField(filter, definition, { value: $event })
              "
            />

            <Input
              v-else
              :id="fieldId(definition, 'value')"
              :model-value="stateFor(filter.draft, definition).value"
              :type="inputType(definition)"
              :aria-label="`${definition.label} value`"
              step="any"
              class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
              @update:model-value="
                updateField(filter, definition, { value: $event })
              "
            />
          </div>
        </div>
      </div>

      <div
        class="flex items-center justify-between border-t border-gray-100 px-4 py-3 dark:border-gray-800"
      >
        <button
          v-bind="filter.clearAttrs"
          class="text-xs font-medium text-gray-500 hover:text-gray-900 disabled:cursor-default disabled:opacity-40 dark:text-gray-400 dark:hover:text-white"
        >
          Reset filters
        </button>
        <button
          v-bind="filter.applyAttrs"
          :disabled="busy || !changed(filter.draft)"
          class="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
        >
          Apply
        </button>
      </div>
    </div>
  </FilterBar>
</template>
