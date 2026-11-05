<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import WidgetPreview from './WidgetPreview.vue'
import PreviewContent from './PreviewContent.vue'
import BridgePreview from './BridgePreview.vue'
import BeaconStatus from '@/components/beacon/BeaconStatus.vue'
const props = defineProps({
  appearance: Object,
  product: { type: String, default: 'bearing' },
  fallbackName: String,
  mode: String,
  surface: String,
  widget: Boolean,
  mobile: Boolean,
  widgetStyles: String
})
const emit = defineEmits(['update:surface'])
const target = ref(null)
const stage = ref(null)
const availableWidth = ref(720)
let observer, resizeFrame
const viewportWidth = computed(() =>
  props.mobile ? 390 : Math.max(720, availableWidth.value)
)
const scale = computed(() =>
  Math.min(1, availableWidth.value / viewportWidth.value)
)
const height = computed(() =>
  props.product === 'bearing' && props.widget
    ? 760
    : props.product === 'beacon'
    ? 900
    : 620
)
function loaded(event) {
  const doc = event.target.contentDocument
  for (const link of document.querySelectorAll('link[rel="stylesheet"],style'))
    doc.head.append(link.cloneNode(true))
  target.value = doc.body
}
onMounted(() => {
  observer = new ResizeObserver(([entry]) => {
    cancelAnimationFrame(resizeFrame)
    resizeFrame = requestAnimationFrame(() => {
      availableWidth.value = entry.contentRect.width
    })
  })
  observer.observe(stage.value)
})
onUnmounted(() => {
  observer?.disconnect()
  cancelAnimationFrame(resizeFrame)
})
const appearance = computed(() => ({
  ...props.appearance,
  displayName:
    props.appearance?.displayName?.trim() || props.fallbackName || 'App',
  configured: true,
  preview: true,
  mode: props.mode,
  resolvedMode: props.mode
}))
</script>
<template>
  <div
    ref="stage"
    class="relative w-full"
    :style="{ height: `${height * scale}px` }"
  >
    <iframe
      title="Draft appearance preview"
      srcdoc="<!doctype html><html><head><meta name='viewport' content='width=device-width, initial-scale=1'></head><body style='margin:0'></body></html>"
      class="absolute top-0 block border-0 bg-white"
      :style="{
        width: `${viewportWidth}px`,
        height: `${height}px`,
        left: '50%',
        transform: `translateX(-50%) scale(${scale})`,
        transformOrigin: 'top center'
      }"
      @load="loaded"
    />
  </div>
  <Teleport v-if="target" :to="target">
    <BridgePreview
      v-if="product === 'bridge'"
      :appearance="appearance"
      :mode="mode"
    />
    <div
      v-else-if="product === 'beacon'"
      inert
      aria-label="Beacon example status page"
    >
      <BeaconStatus
        :appearance="appearance"
        :app="{ name: appearance.displayName, homePath: '#' }"
      />
    </div>
    <WidgetPreview
      v-else-if="widget"
      :appearance="appearance"
      :mode="mode"
      :surface="surface"
      :widget-styles="widgetStyles"
      @update:surface="emit('update:surface', $event)"
    >
      <PreviewContent
        :appearance="appearance"
        :mode="mode"
        :surface="surface"
        widget
      />
    </WidgetPreview>
    <PreviewContent
      v-else
      :appearance="appearance"
      :mode="mode"
      :surface="surface"
    />
  </Teleport>
</template>
