<script setup>
import { ref, computed, nextTick, onBeforeUnmount } from 'vue'

const props = defineProps({
  text: {
    type: String,
    required: true
  },
  position: {
    type: String,
    default: 'top',
    validator: (v) => ['top', 'bottom', 'left', 'right'].includes(v)
  },
  delay: {
    type: Number,
    default: 150
  }
})

const show = ref(false)
const triggerRef = ref(null)
const tooltipRef = ref(null)
const tooltipStyle = ref({})
const arrowStyle = ref({})
const actualPosition = ref(props.position)
let timeout = null

const GAP = 8
const EDGE_MARGIN = 10
const ARROW_HALF_WIDTH = 6 // must match border-x size
const BORDER_RADIUS = 6 // rounded-md

function positionTooltip() {
  if (!triggerRef.value) return

  const rect = triggerRef.value.getBoundingClientRect()
  const approxHeight = 32
  const approxWidth = 100

  let finalPosition = props.position

  // Flip if not enough space (uses approximations — that's fine for flipping)
  if (props.position === 'top' && rect.top < approxHeight + GAP) {
    finalPosition = 'bottom'
  } else if (
    props.position === 'bottom' &&
    window.innerHeight - rect.bottom < approxHeight + GAP
  ) {
    finalPosition = 'top'
  } else if (props.position === 'left' && rect.left < approxWidth + GAP) {
    finalPosition = 'right'
  } else if (
    props.position === 'right' &&
    window.innerWidth - rect.right < approxWidth + GAP
  ) {
    finalPosition = 'left'
  }

  actualPosition.value = finalPosition

  // Initial position: centered on trigger (overflow adjusted after render)
  let top, left
  switch (finalPosition) {
    case 'top':
      top = rect.top - GAP
      left = rect.left + rect.width / 2
      break
    case 'bottom':
      top = rect.bottom + GAP
      left = rect.left + rect.width / 2
      break
    case 'left':
      top = rect.top + rect.height / 2
      left = rect.left - GAP
      break
    case 'right':
      top = rect.top + rect.height / 2
      left = rect.right + GAP
      break
  }

  tooltipStyle.value = { top: `${top}px`, left: `${left}px` }

  // Default arrow: centered, overlapping by 0.5px to prevent sub-pixel gaps
  if (finalPosition === 'top' || finalPosition === 'bottom') {
    arrowStyle.value = { left: '50%', transform: 'translateX(-50%)' }
  } else {
    arrowStyle.value = { top: '50%', transform: 'translateY(-50%)' }
  }
}

function adjustForOverflow() {
  if (!tooltipRef.value || !triggerRef.value) return

  const pos = actualPosition.value
  if (pos !== 'top' && pos !== 'bottom') return

  const tooltipRect = tooltipRef.value.getBoundingClientRect()
  const triggerRect = triggerRef.value.getBoundingClientRect()
  const triggerCenterX = triggerRect.left + triggerRect.width / 2

  let shiftX = 0
  if (tooltipRect.right > window.innerWidth - EDGE_MARGIN) {
    shiftX = tooltipRect.right - (window.innerWidth - EDGE_MARGIN)
  } else if (tooltipRect.left < EDGE_MARGIN) {
    shiftX = tooltipRect.left - EDGE_MARGIN
  }

  if (shiftX === 0) return

  // Shift tooltip to stay within viewport
  const currentLeft = parseFloat(tooltipStyle.value.left)
  tooltipStyle.value = {
    ...tooltipStyle.value,
    left: `${currentLeft - shiftX}px`
  }

  // Arrow must still point at trigger center
  // After shifting, the tooltip center moved by -shiftX, so arrow needs +shiftX offset
  // Clamp so arrow stays within the rounded corners of the tooltip
  const maxOffset = tooltipRect.width / 2 - BORDER_RADIUS - ARROW_HALF_WIDTH
  const clampedOffset = Math.max(-maxOffset, Math.min(maxOffset, shiftX))

  arrowStyle.value = {
    left: `calc(50% + ${clampedOffset}px)`,
    transform: 'translateX(-50%)'
  }
}

async function handleMouseEnter() {
  timeout = setTimeout(async () => {
    positionTooltip()
    show.value = true
    await nextTick()
    adjustForOverflow()
  }, props.delay)
}

function handleMouseLeave() {
  clearTimeout(timeout)
  show.value = false
}

onBeforeUnmount(() => {
  clearTimeout(timeout)
})

const tooltipClasses = computed(() => {
  const base =
    'fixed z-[9999] whitespace-nowrap rounded-md bg-gray-900 dark:bg-gray-100 px-2.5 py-1.5 text-xs font-medium text-white dark:text-gray-900 shadow-lg pointer-events-none'

  const transforms = {
    top: '-translate-x-1/2 -translate-y-full',
    bottom: '-translate-x-1/2',
    left: '-translate-x-full -translate-y-1/2',
    right: '-translate-y-1/2'
  }

  return `${base} ${transforms[actualPosition.value]}`
})

const arrowClasses = computed(() => {
  const arrows = {
    top: 'top-full border-t-gray-900 dark:border-t-gray-100 border-x-transparent border-b-transparent',
    bottom:
      'bottom-full border-b-gray-900 dark:border-b-gray-100 border-x-transparent border-t-transparent',
    left: 'left-full border-l-gray-900 dark:border-l-gray-100 border-y-transparent border-r-transparent',
    right:
      'right-full border-r-gray-900 dark:border-r-gray-100 border-y-transparent border-l-transparent'
  }
  return arrows[actualPosition.value]
})

const arrowBorderSize = computed(() => {
  if (actualPosition.value === 'top' || actualPosition.value === 'bottom') {
    return 'border-x-[6px] border-y-[5px]'
  }
  return 'border-y-[6px] border-x-[5px]'
})
</script>

<template>
  <div
    ref="triggerRef"
    class="inline-flex"
    @mouseenter="handleMouseEnter"
    @mouseleave="handleMouseLeave"
  >
    <slot />
    <Teleport to="body">
      <Transition
        enter-active-class="transition duration-150 ease-out"
        enter-from-class="opacity-0 scale-95"
        enter-to-class="opacity-100 scale-100"
        leave-active-class="transition duration-100 ease-in"
        leave-from-class="opacity-100 scale-100"
        leave-to-class="opacity-0 scale-95"
      >
        <div
          v-if="show && text"
          ref="tooltipRef"
          :class="tooltipClasses"
          :style="tooltipStyle"
        >
          {{ text }}
          <!-- Arrow -->
          <span
            :class="[
              'absolute h-0 w-0 border-solid',
              arrowClasses,
              arrowBorderSize
            ]"
            :style="arrowStyle"
          />
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
