<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import contract from '../../../../api/lib/app-appearance'
const props = defineProps({ appearance: Object, previewMode: String })
const systemDark = ref(
  typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
)
const hostMode = ref(null)
let media
const mode = computed(() => {
  const appearance = props.appearance || {}
  const choice =
    props.previewMode ||
    (appearance.mode === 'host'
      ? hostMode.value || appearance.resolvedMode || appearance.fallbackMode
      : appearance.mode)
  return ['light', 'dark'].includes(choice)
    ? choice
    : systemDark.value
    ? 'dark'
    : 'light'
})
const style = computed(() =>
  props.appearance?.configured &&
  (props.previewMode || props.appearance?.preview)
    ? {
        ...contract.variables(props.appearance, mode.value),
        colorScheme: mode.value
      }
    : null
)
function updateSystem(event) {
  systemDark.value = event.matches
}
function receiveMode(event) {
  if (
    props.appearance?.mode !== 'host' ||
    window.parent === window ||
    event.origin !== window.location.origin ||
    event.source !== window.parent
  )
    return
  const data = event.data
  if (
    data?.type !== 'slipway:appearance' ||
    data.version !== 1 ||
    !['light', 'dark'].includes(data.mode) ||
    Object.keys(data).some((key) => !['type', 'version', 'mode'].includes(key))
  )
    return
  hostMode.value = data.mode
}
watch(mode, (value) => {
  if (props.appearance?.stylesheet)
    document.documentElement.dataset.appearanceMode = value
})
onMounted(() => {
  if (props.appearance?.stylesheet)
    document.documentElement.dataset.appearanceMode = mode.value
  media = window.matchMedia('(prefers-color-scheme: dark)')
  media.addEventListener('change', updateSystem)
  window.addEventListener('message', receiveMode)
})
onUnmounted(() => {
  media?.removeEventListener('change', updateSystem)
  window.removeEventListener('message', receiveMode)
})
</script>
<template>
  <div
    :class="{ 'app-appearance': appearance?.configured }"
    :data-appearance-mode="appearance?.configured ? mode : undefined"
    :data-density="appearance?.density"
    :style="style"
  >
    <slot />
  </div>
</template>
