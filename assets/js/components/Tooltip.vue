<script setup>
import { ref, computed, onBeforeUnmount } from 'vue'

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
const tooltipStyle = ref({})
const actualPosition = ref(props.position)
let timeout = null

function updatePosition() {
  if (!triggerRef.value) return

  const rect = triggerRef.value.getBoundingClientRect()
  const gap = 8 // Space between trigger and tooltip
  const tooltipHeight = 32 // Approximate tooltip height
  const tooltipWidth = 100 // Approximate tooltip width

  let top, left
  let finalPosition = props.position

  // Auto-detect if we need to flip vertical position
  if (props.position === 'top' && rect.top < tooltipHeight + gap) {
    finalPosition = 'bottom'
  } else if (props.position === 'bottom' && window.innerHeight - rect.bottom < tooltipHeight + gap) {
    finalPosition = 'top'
  } else if (props.position === 'left' && rect.left < tooltipWidth + gap) {
    finalPosition = 'right'
  } else if (props.position === 'right' && window.innerWidth - rect.right < tooltipWidth + gap) {
    finalPosition = 'left'
  }

  actualPosition.value = finalPosition

  switch (finalPosition) {
    case 'top':
      top = rect.top - gap
      left = rect.left + rect.width / 2
      break
    case 'bottom':
      top = rect.bottom + gap
      left = rect.left + rect.width / 2
      break
    case 'left':
      top = rect.top + rect.height / 2
      left = rect.left - gap
      break
    case 'right':
      top = rect.top + rect.height / 2
      left = rect.right + gap
      break
  }

  // Check if tooltip would overflow right edge and adjust
  const centerX = rect.left + rect.width / 2
  if (finalPosition === 'top' || finalPosition === 'bottom') {
    if (centerX + tooltipWidth / 2 > window.innerWidth - 10) {
      // Would overflow right - align to right edge instead
      left = window.innerWidth - tooltipWidth / 2 - 10
    } else if (centerX - tooltipWidth / 2 < 10) {
      // Would overflow left - align to left edge instead
      left = tooltipWidth / 2 + 10
    }
  }

  tooltipStyle.value = {
    top: `${top}px`,
    left: `${left}px`
  }
}

function handleMouseEnter() {
  timeout = setTimeout(() => {
    updatePosition()
    show.value = true
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
  const base = 'fixed z-[9999] whitespace-nowrap rounded-md bg-gray-900 dark:bg-gray-100 px-2.5 py-1.5 text-xs font-medium text-white dark:text-gray-900 shadow-lg pointer-events-none'

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
    top: 'top-full left-1/2 -translate-x-1/2 border-t-gray-900 dark:border-t-gray-100 border-x-transparent border-b-transparent',
    bottom: 'bottom-full left-1/2 -translate-x-1/2 border-b-gray-900 dark:border-b-gray-100 border-x-transparent border-t-transparent',
    left: 'left-full top-1/2 -translate-y-1/2 border-l-gray-900 dark:border-l-gray-100 border-y-transparent border-r-transparent',
    right: 'right-full top-1/2 -translate-y-1/2 border-r-gray-900 dark:border-r-gray-100 border-y-transparent border-l-transparent'
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
          />
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
