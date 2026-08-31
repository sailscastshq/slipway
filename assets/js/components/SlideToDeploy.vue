<script setup>
import ChevronRight from '@/components/ui/icons/ChevronRight.vue'
import { computed, ref } from 'vue'
import Slide from '@/components/ui/slide/Slide.vue'
import Spinner from '@/components/SlipwaySpinner.vue'

const props = defineProps({
  isProduction: {
    type: Boolean,
    default: false
  },
  environmentName: {
    type: String,
    default: ''
  },
  disabled: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['deploy'])
const deploying = ref(false)

const envLabel = computed(
  () => props.environmentName || (props.isProduction ? 'production' : 'staging')
)
const label = computed(() =>
  deploying.value
    ? `Sliding to ${envLabel.value}...`
    : `Slide to ${envLabel.value}`
)

const slideClasses = [
  'h-10 min-h-10 w-full border-gray-200 bg-gray-100 p-0.5 text-xs text-gray-400 shadow-none dark:border-gray-800 dark:bg-gray-900 dark:text-gray-500',
  'data-[state=dragging]:cursor-grabbing data-[state=pending]:opacity-100',
  '**:data-[slot=slide-fill]:bg-transparent',
  '**:data-[slot=slide-label]:px-10 **:data-[slot=slide-label]:whitespace-nowrap',
  '**:data-[slot=slide-thumb]:inset-s-0.5 **:data-[slot=slide-thumb]:top-0.5 **:data-[slot=slide-thumb]:size-9 **:data-[slot=slide-thumb]:shadow-lg',
  '[&[data-progress=middle]_[data-slot=slide-fill]]:bg-yellow-500/10',
  '[&[data-progress=middle]_[data-slot=slide-thumb]]:bg-yellow-500 [&[data-progress=middle]_[data-slot=slide-thumb]]:text-white',
  '[&[data-progress=ready]_[data-slot=slide-fill]]:bg-green-500/10 [&[data-progress=complete]_[data-slot=slide-fill]]:bg-green-500/10',
  '[&[data-progress=ready]_[data-slot=slide-thumb]]:bg-green-500 [&[data-progress=complete]_[data-slot=slide-thumb]]:bg-green-500',
  '[&[data-progress=ready]_[data-slot=slide-thumb]]:text-white [&[data-progress=complete]_[data-slot=slide-thumb]]:text-white'
].join(' ')

function deploy() {
  if (deploying.value || props.disabled) return

  deploying.value = true
  emit('deploy')
}

function reset() {
  deploying.value = false
}

defineExpose({ reset })
</script>

<template>
  <Slide
    :pending="deploying"
    :disabled="disabled"
    :class="slideClasses"
    @confirm="deploy"
  >
    {{ label }}

    <template #thumb="{ pending }">
      <Spinner v-if="pending" class="size-4" />
      <ChevronRight v-else class="size-4 rtl:rotate-180" stroke-width="2" />
    </template>
  </Slide>
</template>
