<script setup>
import { computed, ref, useAttrs } from 'vue'
import { twMerge } from 'tailwind-merge'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  modelValue: { type: [String, Number], default: undefined },
  type: { type: String, default: 'text' }
})
const emit = defineEmits(['update:modelValue', 'input'])
const attrs = useAttrs()
const element = ref()
let composing = false

const resolvedValue = computed(() => props.modelValue ?? attrs.value)

const forwardedAttrs = computed(() => {
  const {
    class: _class,
    value: _value,
    'data-slot': _dataSlot,
    ...rest
  } = attrs
  return rest
})

function commitValue(event) {
  const value = ['number', 'range'].includes(props.type)
    ? event.target.value === ''
      ? ''
      : event.target.valueAsNumber
    : event.target.value
  emit('update:modelValue', value)
}

function updateValue(event) {
  if (!composing) commitValue(event)
  emit('input', event)
}

function finishComposition(event) {
  composing = false
  commitValue(event)
}

defineExpose({
  element,
  focus: (options) => element.value?.focus(options)
})
</script>

<template>
  <input
    ref="element"
    v-bind="forwardedAttrs"
    :type="type"
    :value="resolvedValue"
    data-slot="input"
    :class="
      twMerge(
        ['disabled:cursor-not-allowed motion-reduce:transition-none'],
        attrs.class
      )
    "
    @compositionstart="composing = true"
    @compositionend="finishComposition"
    @input="updateValue"
  />
</template>
