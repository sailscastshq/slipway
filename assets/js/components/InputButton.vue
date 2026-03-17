<script setup>
import SlippyLoader from '@/components/SlippyLoader.vue'

const props = defineProps({
  processing: {
    type: Boolean,
    default: false
  }
})
</script>

<template>
  <button
    type="submit"
    class="border-brand bg-brand disabled:text-gray relative flex items-center justify-center rounded-md border px-4 py-3 text-white disabled:cursor-not-allowed disabled:border-gray-200/40 disabled:bg-gray-200/40"
  >
    <SlippyLoader v-if="processing" class="absolute text-white" />
    <span :class="{ invisible: processing }"><slot>Submit</slot></span>
  </button>
</template>
