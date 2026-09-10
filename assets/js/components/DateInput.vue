<script setup>
import { computed, ref, useAttrs, watch } from 'vue'
import DatePicker from '@/components/ui/date-picker/DatePicker.vue'
import Input from '@/components/ui/input/Input.vue'

defineOptions({ inheritAttrs: false })
const props = defineProps({
  modelValue: { type: String, default: '' },
  type: { type: String, default: 'date' },
  id: String,
  disabled: Boolean,
  required: Boolean,
  timeLabel: { type: String, default: 'Time (24-hour)' }
})
const emit = defineEmits(['update:modelValue', 'blur'])
const attrs = useAttrs()
const hasTime = computed(() =>
  ['datetime', 'datetime-local', 'timestamp'].includes(props.type)
)
const date = ref('')
const time = ref('')
watch(
  () => props.modelValue,
  (value) => {
    const [day = '', clock = ''] = (value || '').split('T')
    date.value = day
    time.value = clock
  },
  { immediate: true }
)
function chooseDate(value) {
  date.value = value
  if (!value) {
    time.value = ''
    emit('update:modelValue', '')
    return
  }
  if (hasTime.value && !time.value) time.value = '00:00'
  publish()
}
function chooseTime(value) {
  time.value = value
  publish()
}
function publish() {
  if (!hasTime.value) emit('update:modelValue', date.value)
  else if (
    date.value &&
    /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?$/.test(time.value)
  ) {
    emit('update:modelValue', `${date.value}T${time.value}`)
  }
}
</script>

<template>
  <div
    :class="[
      'focus-within:border-brand flex min-w-0 items-center gap-2',
      attrs.class
    ]"
  >
    <DatePicker
      v-bind="
        Object.fromEntries(
          Object.entries(attrs).filter(([key]) => key !== 'class')
        )
      "
      :id="id"
      :model-value="date"
      :disabled="disabled"
      :required="required"
      class="[&_[data-slot=date-picker-button]]:min-w-8 min-w-0 flex-1 [&_input]:w-full [&_input]:min-w-0 [&_input]:rounded-none [&_input]:border-0 [&_input]:bg-transparent [&_input]:px-1 [&_input]:py-1 [&_input]:pe-9 [&_input]:shadow-none [&_input]:outline-none [&_input]:ring-0"
      @update:model-value="chooseDate"
      @blur="emit('blur', $event)"
    />
    <Input
      v-if="hasTime"
      :id="id ? `${id}-time` : undefined"
      :model-value="time"
      type="text"
      inputmode="text"
      placeholder="HH:mm"
      pattern="([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.[0-9]{1,3})?)?"
      :aria-label="timeLabel"
      :aria-describedby="attrs['aria-describedby']"
      :disabled="disabled"
      :required="required || Boolean(date)"
      class="w-24 shrink-0 rounded-none border-0 border-l border-dashed border-gray-200 bg-transparent px-2 py-1 text-sm tabular-nums shadow-none focus:outline-none focus:ring-0 dark:border-gray-700"
      @update:model-value="chooseTime"
      @blur="emit('blur', $event)"
    />
  </div>
</template>
