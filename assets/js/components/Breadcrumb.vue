<script setup>
import { Link } from '@inertiajs/vue3'

defineProps({
  items: {
    type: Array,
    required: true
    // Each item: { label: string, href?: string }
    // Last item (no href) is the current page
  }
})
</script>

<template>
  <!-- Mobile: parent + current page -->
  <nav class="flex items-center space-x-2 text-sm md:hidden">
    <template v-if="items.length > 1">
      <Link
        :href="items[items.length - 2].href"
        class="text-gray-500 dark:text-gray-400"
      >
        {{ items[items.length - 2].label }}
      </Link>
      <span class="text-gray-400 dark:text-gray-600">/</span>
    </template>
    <span class="font-medium text-gray-900 dark:text-white">{{
      items[items.length - 1].label
    }}</span>
  </nav>
  <!-- Desktop: full breadcrumb -->
  <nav class="hidden items-center space-x-2 text-sm md:flex">
    <template v-for="(item, index) in items" :key="index">
      <span v-if="index > 0" class="text-gray-400 dark:text-gray-600">/</span>
      <Link
        v-if="item.href"
        :href="item.href"
        class="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
      >
        {{ item.label }}
      </Link>
      <span v-else class="font-medium text-gray-900 dark:text-white">{{
        item.label
      }}</span>
    </template>
  </nav>
</template>
