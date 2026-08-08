<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps({
  id: {
    type: String,
    required: true
  },
  label: {
    type: String,
    required: true
  },
  modelValue: {
    type: [String, Number],
    default: ''
  },
  options: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['update:modelValue'])
const root = ref(null)
const trigger = ref(null)
const menu = ref(null)
const open = ref(false)

const selected = computed(() =>
  props.options.find(
    (option) => String(option.value) === String(props.modelValue)
  )
)
const listboxId = computed(() => `${props.id}-options`)

async function show({ focus = false, position = 'selected' } = {}) {
  open.value = true
  if (!focus) return
  await nextTick()
  const options = Array.from(
    menu.value?.querySelectorAll('[role="option"]') || []
  )
  const selectedIndex = props.options.findIndex(
    (option) => String(option.value) === String(props.modelValue)
  )
  const index =
    position === 'last'
      ? options.length - 1
      : position === 'first'
      ? 0
      : Math.max(0, selectedIndex)
  options[index]?.focus()
}

function hide({ restoreFocus = false } = {}) {
  open.value = false
  if (restoreFocus) nextTick(() => trigger.value?.focus())
}

function toggle() {
  if (open.value) hide()
  else show()
}

function choose(option) {
  emit('update:modelValue', option.value)
  hide({ restoreFocus: true })
}

function handleMenuKeydown(event) {
  const options = Array.from(
    menu.value?.querySelectorAll('[role="option"]') || []
  )
  const currentIndex = options.indexOf(document.activeElement)

  if (event.key === 'Escape') {
    event.preventDefault()
    hide({ restoreFocus: true })
    return
  }

  let nextIndex
  if (event.key === 'ArrowDown') {
    nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % options.length
  } else if (event.key === 'ArrowUp') {
    nextIndex =
      currentIndex < 0
        ? options.length - 1
        : (currentIndex - 1 + options.length) % options.length
  } else if (event.key === 'Home') {
    nextIndex = 0
  } else if (event.key === 'End') {
    nextIndex = options.length - 1
  } else {
    return
  }

  event.preventDefault()
  options[nextIndex]?.focus()
}

function handleDocumentPointerDown(event) {
  if (open.value && root.value && !root.value.contains(event.target)) hide()
}

onMounted(() =>
  document.addEventListener('pointerdown', handleDocumentPointerDown)
)
onBeforeUnmount(() =>
  document.removeEventListener('pointerdown', handleDocumentPointerDown)
)
</script>

<template>
  <div ref="root" class="relative inline-block">
    <button
      :id="id"
      ref="trigger"
      type="button"
      role="combobox"
      :aria-label="label"
      :aria-expanded="open"
      :aria-controls="listboxId"
      aria-haspopup="listbox"
      class="min-h-10 inline-flex max-w-[16rem] items-center justify-between gap-3 rounded-lg bg-gray-100 px-3.5 text-left text-sm font-semibold text-gray-950 transition hover:bg-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-950 focus-visible:ring-offset-2 dark:bg-gray-900 dark:text-white dark:hover:bg-gray-800 dark:focus-visible:ring-white dark:focus-visible:ring-offset-gray-950"
      @click="toggle"
      @keydown.down.prevent="show({ focus: true, position: 'first' })"
      @keydown.up.prevent="show({ focus: true, position: 'last' })"
      @keydown.escape.prevent="hide({ restoreFocus: true })"
    >
      <span class="truncate">{{ selected?.label || 'Select…' }}</span>
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        class="size-4 shrink-0 text-gray-400 transition"
        :class="{ 'rotate-180': open }"
        fill="none"
      >
        <path
          d="m5 6.5 3 3 3-3"
          stroke="currentColor"
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="1.5"
        />
      </svg>
    </button>

    <div
      v-if="open"
      :id="listboxId"
      ref="menu"
      role="listbox"
      :aria-label="`${label} options`"
      class="min-w-44 absolute left-0 z-50 mt-2 max-h-64 w-max max-w-[min(20rem,calc(100vw-2.5rem))] overflow-y-auto rounded-xl border border-gray-200 bg-white py-1 shadow-xl shadow-gray-950/10 dark:border-gray-700 dark:bg-gray-900 dark:shadow-black/30"
      @keydown="handleMenuKeydown"
    >
      <button
        v-for="option in options"
        :key="String(option.value)"
        type="button"
        role="option"
        :aria-selected="String(option.value) === String(modelValue)"
        class="min-h-10 flex w-full items-center justify-between gap-4 px-3.5 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none dark:text-gray-300 dark:hover:bg-gray-800 dark:focus:bg-gray-800"
        @click="choose(option)"
      >
        <span class="truncate">{{ option.label }}</span>
        <svg
          v-if="String(option.value) === String(modelValue)"
          aria-hidden="true"
          viewBox="0 0 16 16"
          class="size-4 shrink-0 text-gray-500 dark:text-gray-400"
          fill="none"
        >
          <path
            d="m3.5 8 2.75 2.75L12.5 4.5"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.6"
          />
        </svg>
      </button>
    </div>
  </div>
</template>
