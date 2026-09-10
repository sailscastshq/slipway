<script setup>
import { computed, useAttrs } from 'vue'
import DatePicker from '@/components/ui/date-picker/DatePicker.vue'
import SchedulePicker from '@/components/ui/schedule-picker/SchedulePicker.vue'

defineOptions({ inheritAttrs: false })
const props = defineProps({
  modelValue: { type: String, default: '' },
  type: { type: String, default: 'date' },
  id: String,
  disabled: Boolean,
  readonly: Boolean,
  required: Boolean
})
const emit = defineEmits(['update:modelValue', 'blur'])
const attrs = useAttrs()
const hasTime = computed(() =>
  ['datetime', 'datetime-local', 'timestamp'].includes(props.type)
)
const inputAttrs = computed(() =>
  Object.fromEntries(Object.entries(attrs).filter(([key]) => key !== 'class'))
)
const instant = computed(() => {
  if (!props.modelValue) return ''
  const date = new Date(props.modelValue)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
})
</script>

<template>
  <SchedulePicker
    v-if="hasTime"
    v-bind="inputAttrs"
    :id="id"
    :model-value="instant"
    :allow-past="true"
    :disabled="disabled"
    :readonly="readonly"
    :required="required"
    :placeholder="attrs.placeholder || 'Choose date and time'"
    :class="[
      'focus-within:border-brand min-w-0 gap-0 [&_[data-slot=input]]:w-full [&_[data-slot=input]]:min-w-0 [&_[data-slot=input]]:rounded-none [&_[data-slot=input]]:border-0 [&_[data-slot=input]]:bg-transparent [&_[data-slot=input]]:px-1 [&_[data-slot=input]]:py-1 [&_[data-slot=input]]:pe-12 [&_[data-slot=input]]:shadow-none [&_[data-slot=input]]:outline-none [&_[data-slot=input]]:ring-0 [&_[data-slot=schedule-picker-status]]:sr-only',
      attrs.class
    ]"
    @update:model-value="emit('update:modelValue', $event)"
    @blur="emit('blur', $event)"
  />
  <div
    v-else
    :class="[
      'focus-within:border-brand flex min-w-0 items-center gap-2',
      attrs.class
    ]"
  >
    <DatePicker
      v-bind="inputAttrs"
      :id="id"
      :model-value="modelValue"
      :disabled="disabled"
      :readonly="readonly"
      :required="required"
      class="[&_[data-slot=date-picker-button]]:min-w-8 min-w-0 flex-1 [&_input]:w-full [&_input]:min-w-0 [&_input]:rounded-none [&_input]:border-0 [&_input]:bg-transparent [&_input]:px-1 [&_input]:py-1 [&_input]:pe-9 [&_input]:shadow-none [&_input]:outline-none [&_input]:ring-0"
      @update:model-value="emit('update:modelValue', $event)"
      @blur="emit('blur', $event)"
    />
  </div>
</template>
