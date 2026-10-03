<script setup>
defineProps({ error: Object })
const reload = () => window.location.reload()
</script>

<template>
  <div
    :role="error ? 'alert' : 'status'"
    data-test="quest-panel-fallback"
    class="rounded-md border border-gray-200 px-4 py-6 text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400"
  >
    <template v-if="error">
      Could not load this view.
      <button type="button" class="ml-1 underline" @click="reload">
        Reload page
      </button>
    </template>
    <template v-else>Loading view…</template>
  </div>
</template>
