<script setup>
import { usePage } from '@inertiajs/vue3'
import { computed } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'
import BridgeWorkspaceLayout from '@/layouts/BridgeWorkspaceLayout.vue'

const page = usePage()
const isHostBridge = computed(() => page.props.hostBridgeOrigin === true)
</script>

<template>
  <BridgeWorkspaceLayout v-if="isHostBridge">
    <slot />
  </BridgeWorkspaceLayout>
  <AppLayout v-else>
    <slot />
  </AppLayout>
</template>
