<script setup>
import { computed, nextTick, ref, useAttrs, useId } from 'vue'
import { twMerge } from 'tailwind-merge'

defineOptions({ inheritAttrs: false })
const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  disabled: Boolean,
  readonly: Boolean,
  required: Boolean,
  normalizeValue: { type: Function, default: (value) => value.trim() },
  formatValue: { type: Function, default: (value) => value },
  maxItems: { type: Number, default: 100 }
})
const emit = defineEmits(['update:modelValue', 'blur'])
const attrs = useAttrs()
const input = ref()
const draft = ref('')
const message = ref('')
const errorId = `chips-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}-error`
const inputAttrs = computed(() =>
  Object.fromEntries(Object.entries(attrs).filter(([key]) => key !== 'class'))
)
const describedBy = computed(
  () =>
    [attrs['aria-describedby'], message.value && errorId]
      .filter(Boolean)
      .join(' ') || undefined
)
function add() {
  if (props.disabled || props.readonly || !draft.value.trim()) return
  try {
    const value = props.normalizeValue(draft.value)
    if (!value) throw new Error('Enter a value.')
    if (props.modelValue.includes(value))
      throw new Error('This value is already added.')
    if (props.modelValue.length >= props.maxItems)
      throw new Error(`Use at most ${props.maxItems} values.`)
    emit('update:modelValue', [...props.modelValue, value])
    draft.value = ''
    message.value = ''
    input.value?.setCustomValidity('')
  } catch (error) {
    message.value = error.message || 'Enter a valid value.'
    input.value?.setCustomValidity(message.value)
  }
}
async function remove(index) {
  if (props.disabled || props.readonly) return
  emit(
    'update:modelValue',
    props.modelValue.filter((_, i) => i !== index)
  )
  message.value = ''
  input.value?.setCustomValidity('')
  await nextTick()
  input.value?.focus()
}
function keydown(event) {
  if (event.isComposing) return
  if (event.key === 'Enter') {
    event.preventDefault()
    add()
  }
}
function edit() {
  message.value = ''
  input.value?.setCustomValidity('')
}
function blur(event) {
  add()
  emit('blur', event)
}
defineExpose({ focus: () => input.value?.focus(), input })
</script>

<template>
  <div
    data-slot="chips"
    :class="twMerge('min-h-11 flex flex-wrap items-center gap-2', attrs.class)"
  >
    <span
      v-for="(value, index) in modelValue"
      :key="value"
      data-slot="chip"
      class="inline-flex max-w-full items-center gap-1 rounded-md bg-gray-100 px-2 py-1 text-sm text-gray-950 dark:bg-gray-800 dark:text-white"
    >
      <span class="wrap-break-word min-w-0">{{ formatValue(value) }}</span>
      <button
        v-if="!readonly"
        type="button"
        :disabled="disabled"
        :aria-label="`Remove ${formatValue(value)}`"
        class="size-6 grid shrink-0 place-items-center rounded hover:bg-gray-200 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 dark:hover:bg-gray-700"
        @click="remove(index)"
      >
        ×
      </button>
    </span>
    <input
      ref="input"
      v-bind="inputAttrs"
      v-model="draft"
      type="text"
      :disabled="disabled"
      :readonly="readonly"
      :required="required && !modelValue.length"
      :aria-invalid="message ? 'true' : attrs['aria-invalid']"
      :aria-describedby="describedBy"
      class="min-w-48 flex-1 border-0 bg-transparent py-1 text-sm outline-none disabled:cursor-not-allowed"
      @input="edit"
      @keydown="keydown"
      @blur="blur"
    />
    <span
      v-if="message"
      :id="errorId"
      role="alert"
      class="w-full text-sm text-red-600 dark:text-red-400"
      >{{ message }}</span
    >
  </div>
</template>
