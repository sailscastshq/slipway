<script setup>
import Input from '@/components/ui/input/Input.vue'
import { ref } from 'vue'

defineProps({
  id: {
    type: String,
    required: true
  },
  label: {
    type: String,
    required: true
  },
  placeholder: {
    type: String,
    default: ''
  }
})

const model = defineModel({
  type: String,
  default: ''
})
const input = ref(null)

defineExpose({
  focus() {
    input.value?.focus()
  }
})
</script>

<template>
  <Input
    :id="id"
    ref="input"
    v-model="model"
    type="search"
    autocomplete="off"
    :aria-label="label"
    :placeholder="placeholder"
    class="focus:border-brand h-10 w-full border-b border-dashed border-gray-200 bg-transparent px-1 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-0 dark:border-gray-700 dark:bg-transparent dark:text-white dark:placeholder-gray-500"
  />
</template>
