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
    'focus:border-brand dark:focus:border-brand rounded-none border-0 border-b border-dashed border-gray-200 bg-transparent text-gray-900 shadow-none focus:outline-none focus-visible:outline-none focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-transparent dark:text-white',
    attrs.class
  )
)
</script>

<template>
  <Select
    v-bind="forwardedAttrs"
    :class="triggerClasses"
    :style="attrs.style"
  />
</template>
