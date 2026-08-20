<script setup>
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useAttrs
} from 'vue'

defineOptions({ inheritAttrs: false })

const model = defineModel()
const emit = defineEmits(['change'])
const attrs = useAttrs()
const element = ref()
let form

const forwardedAttrs = computed(() => {
  const {
    class: _class,
    type: _type,
    checked: _checked,
    'data-slot': _dataSlot,
    'data-state': _dataState,
    'data-disabled': _dataDisabled,
    'data-invalid': _dataInvalid,
    ...rest
  } = attrs
  return rest
})

const disabled = computed(
  () => attrs.disabled !== undefined && attrs.disabled !== false
)
const invalid = computed(
  () => attrs['aria-invalid'] === true || attrs['aria-invalid'] === 'true'
)

function inputValue() {
  if (!element.value) return undefined
  return Object.prototype.hasOwnProperty.call(element.value, '_value')
    ? element.value._value
    : element.value.value
}

const checked = computed(() => Object.is(model.value, attrs.value ?? 'on'))

function groupHasCheckedRadio() {
  if (!element.value) return false
  const root = element.value.form ?? element.value.getRootNode()
  const controls =
    element.value.form?.elements ??
    root?.querySelectorAll?.('input[type="radio"]') ??
    []

  return Array.from(controls).some(
    (control) =>
      control.type === 'radio' &&
      control.name === element.value.name &&
      control.form === element.value.form &&
      control.checked
  )
}

function resetModelFromElement() {
  if (element.value.checked) model.value = inputValue()
  else if (!groupHasCheckedRadio()) model.value = undefined
}

function handleReset() {
  queueMicrotask(resetModelFromElement)
}

function handleChange(event) {
  nextTick(() => emit('change', event))
}

onMounted(() => {
  element.value.defaultChecked = element.value.checked
  form = element.value.form
  form?.addEventListener('reset', handleReset)
})

onBeforeUnmount(() => {
  form?.removeEventListener('reset', handleReset)
})

defineExpose({
  element,
  focus: (options) => element.value?.focus(options)
})
</script>

<template>
  <input
    ref="element"
    v-model="model"
    v-bind="forwardedAttrs"
    type="radio"
    data-slot="radio"
    :data-state="checked ? 'checked' : 'unchecked'"
    :data-disabled="disabled ? '' : undefined"
    :data-invalid="invalid ? '' : undefined"
    :class="[
      'disabled:cursor-not-allowed motion-reduce:transition-none',
      attrs.class
    ]"
    @change="handleChange"
  />
</template>
