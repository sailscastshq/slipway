<script setup>
import { computed, useAttrs } from 'vue'
import { twMerge } from 'tailwind-merge'
import Select from '@/components/ui/select/Select.vue'

defineOptions({ inheritAttrs: false })

const attrs = useAttrs()
const forwardedAttrs = computed(() => {
  const { class: _class, style: _style, ...rest } = attrs
  return rest
})
const triggerClasses = computed(() =>
  twMerge(
    'focus-visible:text-brand dark:focus-visible:text-brand-400 rounded-none border-0 bg-transparent shadow-none focus-visible:outline-none',
    attrs.class
  )
)
const chromeReset = {
  border: '0',
  borderRadius: '0',
  boxShadow: 'none',
  background: 'transparent'
}
</script>

<template>
  <Select
    v-bind="forwardedAttrs"
    :class="triggerClasses"
    :style="[chromeReset, attrs.style]"
  />
</template>
