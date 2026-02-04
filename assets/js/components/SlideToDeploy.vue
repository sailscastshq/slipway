<script setup>
import { ref, computed } from 'vue'

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

const trackRef = ref(null)
const handleRef = ref(null)
const state = ref('idle') // 'idle' | 'sliding' | 'deploying'
const offset = ref(0)
const animating = ref(false)

const HANDLE_W = 112
const PAD = 4
const THRESHOLD = 0.8

const travel = computed(() => {
  if (!trackRef.value) return 0
  return trackRef.value.offsetWidth - HANDLE_W - PAD * 2
})

const progress = computed(() => {
  if (travel.value <= 0) return 0
  return Math.min(Math.max(offset.value, 0) / travel.value, 1)
})

const clampedOffset = computed(() => {
  return Math.min(Math.max(offset.value, 0), Math.max(travel.value, 0))
})

const fillPx = computed(() => {
  return PAD + HANDLE_W + clampedOffset.value
})

const fillColor = computed(() => {
  return props.isProduction ? 'bg-amber-500' : 'bg-emerald-500'
})

const envLabel = computed(() => {
  return props.environmentName || (props.isProduction ? 'production' : 'staging')
})

const label = computed(() => {
  if (state.value === 'deploying') {
    return `Sliding to ${envLabel.value}...`
  }
  return `Slide to ${envLabel.value}`
})

let startX = 0

function onPointerDown(e) {
  if (state.value !== 'idle' || props.disabled) return
  e.preventDefault()
  handleRef.value.setPointerCapture(e.pointerId)
  startX = e.clientX
  state.value = 'sliding'
  animating.value = false
}

function onPointerMove(e) {
  if (state.value !== 'sliding') return
  offset.value = e.clientX - startX
}

function onPointerUp() {
  if (state.value !== 'sliding') return

  if (progress.value >= THRESHOLD) {
    animating.value = true
    offset.value = travel.value
    state.value = 'deploying'
    emit('deploy')
  } else {
    animating.value = true
    offset.value = 0
    state.value = 'idle'
  }
}

function reset() {
  animating.value = true
  offset.value = 0
  state.value = 'idle'
}

defineExpose({ reset })
</script>

<template>
  <div>
    <!-- Track -->
    <div
      ref="trackRef"
      :class="[
        'relative h-14 select-none overflow-hidden rounded-full p-1',
        'bg-gray-100 dark:bg-gray-800/80'
      ]"
    >
      <!-- Colored fill -->
      <div
        v-if="state !== 'idle'"
        :class="['absolute inset-y-0 left-0 rounded-full', fillColor]"
        :style="{
          width: state === 'deploying' ? '100%' : fillPx + 'px',
          opacity: state === 'deploying' ? 1 : 0.15 + progress * 0.5,
          transition: animating ? 'all 300ms cubic-bezier(0.4, 0, 0.2, 1)' : 'none'
        }"
      />

      <!-- Drag handle -->
      <div
        ref="handleRef"
        :class="[
          'absolute top-1 left-1 z-10 flex h-12 w-28 items-center justify-center gap-1.5 rounded-full shadow-md',
          'bg-white text-gray-900 dark:bg-gray-100',
          state === 'idle' && !disabled ? 'cursor-grab' : '',
          state === 'sliding' ? 'cursor-grabbing' : '',
          disabled ? 'opacity-50 cursor-not-allowed' : ''
        ]"
        :style="{
          transform: `translateX(${clampedOffset}px)`,
          transition: animating ? 'transform 300ms cubic-bezier(0.4, 0, 0.2, 1)' : 'none'
        }"
        style="touch-action: none"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
      >
        <template v-if="state === 'deploying'">
          <svg class="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        </template>
        <template v-else>
          <span class="text-sm font-semibold">Slide</span>
          <div class="flex items-center animate-nudge-right">
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7" />
            </svg>
            <svg class="-ml-2.5 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
