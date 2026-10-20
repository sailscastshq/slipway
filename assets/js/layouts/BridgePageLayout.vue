<script setup>
import { usePage } from '@inertiajs/vue3'
import { computed, ref, watch } from 'vue'
import BridgeMediaPreview from '@/components/bridge/BridgeMediaPreview.vue'
import AppLayout from '@/layouts/AppLayout.vue'
import BridgeWorkspaceLayout from '@/layouts/BridgeWorkspaceLayout.vue'

const page = usePage()
const isHostBridge = computed(() => page.props.hostBridgeOrigin === true)
const preview = ref(null)
let lastPreview
watch(
  () => page.props.flash?.bridgeActionPreview,
  (value) => {
    if (isHostBridge.value && value?.id && value.id !== lastPreview) {
      lastPreview = value.id
      preview.value = value
    }
  },
  { immediate: true }
)
watch(
  () => page.url,
  () => {
    preview.value = null
  },
  { flush: 'sync' }
)
</script>

<template>
  <BridgeWorkspaceLayout v-if="isHostBridge">
    <slot />
  </BridgeWorkspaceLayout>
  <AppLayout v-else>
    <slot />
  </AppLayout>
  <BridgeMediaPreview
    v-if="isHostBridge"
    :preview="preview"
    @close="preview = null"
  />
</template>
