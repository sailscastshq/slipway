<script setup>
import { ref, computed, onBeforeUnmount } from 'vue'
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

const slideTrack = ref(null)
const slideProgress = ref(0)
const isSliding = ref(false)
const deploying = ref(false)

const envLabel = computed(() => {
  return (
    props.environmentName || (props.isProduction ? 'production' : 'staging')
  )
})

const thumbColor = computed(() => {
  if (slideProgress.value < 0.33)
    return 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
  if (slideProgress.value < 0.66) return 'bg-yellow-500 text-white'
  return 'bg-green-500 text-white'
})

const trackFill = computed(() => {
  if (slideProgress.value < 0.33) return 'bg-transparent'
  if (slideProgress.value < 0.66) return 'bg-yellow-500/10'
  return 'bg-green-500/10'
})

const label = computed(() => {
  if (deploying.value) return `Sliding to ${envLabel.value}...`
  if (slideProgress.value > 0.85) return 'Release to confirm'
  return `Slide to ${envLabel.value}`
})

let cleanupSlide = null

function startSlide(e) {
  if (deploying.value || props.disabled) return
  isSliding.value = true
  const startX = e.type === 'touchstart' ? e.touches[0].clientX : e.clientX
  const track = slideTrack.value
  const maxSlide = track.offsetWidth - 40

  const onMove = (moveEvent) => {
    const currentX =
      moveEvent.type === 'touchmove'
        ? moveEvent.touches[0].clientX
        : moveEvent.clientX
    const delta = currentX - startX
    slideProgress.value = Math.max(0, Math.min(1, delta / maxSlide))
  }

  const onEnd = () => {
    isSliding.value = false
    if (slideProgress.value > 0.85) {
      slideProgress.value = 1
      deploying.value = true
      emit('deploy')
    } else {
      slideProgress.value = 0
    }
    cleanup()
  }

  const cleanup = () => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onEnd)
    document.removeEventListener('touchmove', onMove)
    document.removeEventListener('touchend', onEnd)
    cleanupSlide = null
  }

  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onEnd)
  document.addEventListener('touchmove', onMove)
  document.addEventListener('touchend', onEnd)
  cleanupSlide = cleanup
}

onBeforeUnmount(() => {
  if (cleanupSlide) cleanupSlide()
})

function reset() {
  deploying.value = false
  slideProgress.value = 0
}

defineExpose({ reset })
</script>

<template>
  <div
    ref="slideTrack"
    :class="[
      'relative h-10 select-none overflow-hidden rounded-full border',
      'border-gray-200 bg-gray-100 dark:border-gray-800 dark:bg-gray-900',
      disabled ? 'cursor-not-allowed opacity-50' : ''
    ]"
  >
    <!-- Track fill (grows from left as thumb slides right) -->
    <div
      class="absolute inset-y-0 left-0"
      :class="[trackFill, { 'transition-[width] duration-300': !isSliding }]"
      :style="{ width: `${slideProgress * 100}%` }"
    ></div>

    <!-- Label -->
    <span
      class="pointer-events-none absolute inset-0 flex items-center justify-center text-xs font-medium text-gray-400 dark:text-gray-500"
    >
      {{ label }}
    </span>

    <!-- Thumb (starts at left, slides right) -->
    <div
      class="absolute bottom-0.5 top-0.5 flex w-10 items-center justify-center rounded-full shadow-lg"
      :class="[
        deploying
          ? 'cursor-not-allowed bg-green-500 text-white'
          : thumbColor + ' cursor-grab active:cursor-grabbing',
        { 'transition-all duration-300 ease-out': !isSliding }
      ]"
      :style="{
        left: `calc(${slideProgress * 100}% - ${slideProgress * 2.5}rem)`
      }"
      @mousedown.prevent="startSlide"
      @touchstart.prevent="startSlide"
    >
      <svg
        v-if="!deploying"
        class="h-4 w-4"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M9 5l7 7-7 7"
        />
      </svg>
      <Spinner v-else class="h-4 w-4" />
    </div>
  </div>
</template>
