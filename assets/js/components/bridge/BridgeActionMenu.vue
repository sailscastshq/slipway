<script setup>
import { nextTick, onMounted, onUnmounted, ref } from 'vue'

const props = defineProps({
  items: {
    type: Array,
    default: () => []
  },
  label: {
    type: String,
    default: 'Actions'
  },
  disabled: Boolean,
  testId: {
    type: String,
    default: 'bridge-action-menu'
  }
})

const emit = defineEmits(['select'])
const root = ref(null)
const trigger = ref(null)
const menu = ref(null)
const open = ref(false)

async function toggle() {
  if (props.disabled) return
  open.value = !open.value
  if (open.value) {
    await nextTick()
    menu.value?.querySelector('[role="menuitem"]')?.focus()
  }
}

function close({ restoreFocus = false } = {}) {
  if (!open.value) return
  open.value = false
  if (restoreFocus) nextTick(() => trigger.value?.focus())
}

function select(item) {
  trigger.value?.focus()
  close()
  emit('select', item)
}

function handleKeydown(event) {
  const items = Array.from(
    menu.value?.querySelectorAll('[role="menuitem"]:not(:disabled)') || []
  )
  const currentIndex = items.indexOf(document.activeElement)

  if (event.key === 'Escape') {
    event.preventDefault()
    close({ restoreFocus: true })
    return
  }

  let nextIndex
  if (event.key === 'ArrowDown') {
    nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length
  } else if (event.key === 'ArrowUp') {
    nextIndex =
      currentIndex < 0
        ? items.length - 1
        : (currentIndex - 1 + items.length) % items.length
  } else if (event.key === 'Home') {
    nextIndex = 0
  } else if (event.key === 'End') {
    nextIndex = items.length - 1
  } else {
    return
  }

  event.preventDefault()
  items[nextIndex]?.focus()
}

function handlePointerDown(event) {
  if (!root.value?.contains(event.target)) close()
}

onMounted(() => document.addEventListener('pointerdown', handlePointerDown))
onUnmounted(() =>
  document.removeEventListener('pointerdown', handlePointerDown)
)
</script>

<template>
  <div v-if="items.length > 0" ref="root" class="relative">
    <button
      ref="trigger"
      type="button"
      :disabled="disabled"
      :data-test="`${testId}-trigger`"
      class="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-200 dark:focus-visible:ring-gray-700"
      :aria-label="label"
      aria-haspopup="menu"
      :aria-expanded="open"
      @click.stop="toggle"
    >
      <svg
        class="h-4 w-4"
        fill="currentColor"
        viewBox="0 0 20 20"
        aria-hidden="true"
      >
        <path
          d="M6 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm6 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm6 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z"
        />
      </svg>
    </button>

    <div
      v-if="open"
      ref="menu"
      role="menu"
      :data-test="testId"
      class="min-w-44 absolute right-0 top-full z-30 mt-1 rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
      @click.stop
      @keydown="handleKeydown"
    >
      <button
        v-for="item in items"
        :key="item.key"
        type="button"
        role="menuitem"
        :disabled="item.disabled"
        :data-test="`${testId}-${item.key}`"
        :class="[
          'flex w-full px-3 py-2 text-left text-sm focus:outline-none disabled:cursor-not-allowed disabled:opacity-40',
          item.destructive
            ? 'text-red-600 hover:bg-red-50 focus:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20 dark:focus:bg-red-900/20'
            : 'text-gray-700 hover:bg-gray-50 focus:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800 dark:focus:bg-gray-800'
        ]"
        @click="select(item)"
      >
        {{ item.label }}
      </button>
    </div>
  </div>
</template>
