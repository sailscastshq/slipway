<script setup>
import Share from '@/components/ui/icons/Share.vue'
import Check from '@/components/ui/icons/Check.vue'
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
      <Share v-if="state !== 'copied'" class="size-4" />
      <Check v-else class="size-4" stroke-width="1.6" />
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
