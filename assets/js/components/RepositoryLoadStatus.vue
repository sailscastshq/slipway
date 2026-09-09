<script setup>
import Alert from '@/components/ui/alert/Alert.vue'
import Button from '@/components/ui/button/Button.vue'

defineProps({ loading: Boolean, error: String })
defineEmits(['retry'])
</script>

<template>
  <div
    v-if="loading"
    role="status"
    class="px-3 py-3 text-sm text-gray-500 dark:text-gray-400"
  >
    Loading all repositories…
  </div>
  <Alert
    v-else-if="error"
    role="alert"
    class="rounded-none bg-amber-50 px-3 py-3 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
  >
    <p>{{ error }}</p>
    <Button
      type="button"
      class="mt-2 h-auto rounded-none bg-transparent p-0 text-sm font-medium text-inherit underline shadow-none hover:bg-transparent dark:bg-transparent dark:text-inherit dark:hover:bg-transparent"
      @click.stop="$emit('retry')"
      >Retry</Button
    >
  </Alert>
</template>
