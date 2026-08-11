<script setup>
import Spinner from '@/components/ui/spinner/Spinner.vue'
import SlippyLoader from '@/components/SlippyLoader.vue'

defineOptions({ inheritAttrs: false })
</script>

<template>
  <Spinner v-bind="$attrs">
    <SlippyLoader />
  </Spinner>
</template>
