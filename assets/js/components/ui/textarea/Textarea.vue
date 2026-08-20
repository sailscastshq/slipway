<script setup>
import { computed, ref, useAttrs } from 'vue'
import { twMerge } from 'tailwind-merge'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  modelValue: { type: [String, Number], default: undefined }
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
  emit('update:modelValue', event.target.value)
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
  focus: (options) => element.value?.focus(options),
  select: () => element.value?.select()
})
</script>

<template>
  <textarea
    ref="element"
    v-bind="forwardedAttrs"
    :value="resolvedValue"
    data-slot="textarea"
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
