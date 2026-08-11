<script setup>
import { computed, onUnmounted, ref } from 'vue'
import Tooltip from '@/components/ui/tooltip/Tooltip.vue'

const props = defineProps({
  url: { type: String, required: true },
  title: { type: String, required: true },
  text: { type: String, default: '' },
  showLabel: { type: Boolean, default: false }
})

const state = ref('idle')
let resetTimer

const visibleLabel = computed(() => {
  if (state.value === 'copied') return 'Copied'
  if (state.value === 'failed') return 'Try again'
  return 'Share'
})

const accessibleLabel = computed(() => {
  if (state.value === 'copied') return `Link copied for ${props.title}`
  if (state.value === 'failed')
    return `Copy failed for ${props.title}. Try again`
  return `Share ${props.title}`
})

onUnmounted(() => window.clearTimeout(resetTimer))

async function share() {
  const url = new URL(props.url, window.location.origin).toString()
  const shareData = {
    title: props.title,
    text: props.text || undefined,
    url
  }

  if (typeof navigator.share === 'function') {
    try {
      await navigator.share(shareData)
      return
    } catch (error) {
      if (error?.name === 'AbortError') return
    }
  }

  try {
    await copyText(url)
    setTemporaryState('copied')
  } catch {
    setTemporaryState('failed')
  }
}

function setTemporaryState(nextState) {
  window.clearTimeout(resetTimer)
  state.value = nextState
  resetTimer = window.setTimeout(() => {
    state.value = 'idle'
  }, 2200)
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }

  const field = document.createElement('textarea')
  field.value = value
  field.setAttribute('readonly', '')
  field.style.position = 'fixed'
  field.style.opacity = '0'
  document.body.appendChild(field)
  field.select()
  const copied = document.execCommand('copy')
  field.remove()
  if (!copied) throw new Error('Copy is unavailable')
}
</script>

<template>
  <Tooltip :text="accessibleLabel">
    <button
      type="button"
      :aria-label="accessibleLabel"
      :class="[
        'min-h-10 inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-gray-400 transition hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-950 focus-visible:ring-offset-2 dark:hover:text-gray-200 dark:focus-visible:ring-white dark:focus-visible:ring-offset-gray-900',
        showLabel
          ? 'opacity-100'
          : 'sm:opacity-0 sm:focus-visible:opacity-100 sm:group-hover:opacity-100'
      ]"
      @click="share"
    >
      <svg
        v-if="state !== 'copied'"
        aria-hidden="true"
        viewBox="0 0 20 20"
        class="size-4"
        fill="none"
      >
        <path
          d="M10 12.75V3.5m0 0L6.75 6.75M10 3.5l3.25 3.25M5.75 9.25H4.5A1.5 1.5 0 0 0 3 10.75v4.75A1.5 1.5 0 0 0 4.5 17h11a1.5 1.5 0 0 0 1.5-1.5v-4.75a1.5 1.5 0 0 0-1.5-1.5h-1.25"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <svg
        v-else
        aria-hidden="true"
        viewBox="0 0 20 20"
        class="size-4"
        fill="none"
      >
        <path
          d="m4.75 10.25 3.25 3.25 7.25-7.25"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <span
        aria-hidden="true"
        :class="!showLabel && state === 'idle' ? 'sr-only' : undefined"
      >
        {{ visibleLabel }}
      </span>
    </button>
  </Tooltip>
  <span class="sr-only" aria-live="polite" aria-atomic="true">
    {{
      state === 'copied'
        ? 'Link copied.'
        : state === 'failed'
        ? 'Copy failed.'
        : ''
    }}
  </span>
</template>
