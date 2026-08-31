<script setup>
import EllipsisHorizontal from '@/components/ui/icons/EllipsisHorizontal.vue'
import { computed, useId } from 'vue'
import { Link } from '@inertiajs/vue3'
import Menu from '@/components/ui/menu/Menu.vue'

const props = defineProps({
  items: {
    type: Array,
    default: () => []
  },
  label: {
    type: String,
    default: 'Actions'
  },
  orientation: {
    type: String,
    default: 'horizontal',
    validator: (value) => ['horizontal', 'vertical'].includes(value)
  },
  placement: {
    type: String,
    default: 'bottom',
    validator: (value) => ['top', 'bottom'].includes(value)
  },
  disabled: Boolean,
  testId: {
    type: String,
    default: 'bridge-action-menu'
  }
})

const emit = defineEmits(['select'])
const generatedId = useId().replace(/[^a-zA-Z0-9_-]/g, '')
const menuId = `action-menu-${generatedId}`
const menuPlacement = computed(() =>
  props.placement === 'top' ? 'top-end' : 'bottom-end'
)

function select(item) {
  emit('select', item)
}

function itemClasses(item) {
  return [
    'flex w-full px-3 py-2 text-left text-sm focus:outline-none disabled:cursor-not-allowed disabled:opacity-40',
    item.destructive
      ? 'text-red-600 hover:bg-red-50 focus:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20 dark:focus:bg-red-900/20'
      : 'text-gray-700 hover:bg-gray-50 focus:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800 dark:focus:bg-gray-800'
  ]
}
</script>

<template>
  <div v-if="items.length > 0" class="relative">
    <button
      type="button"
      :disabled="disabled"
      :popovertarget="menuId"
      :data-test="`${testId}-trigger`"
      class="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-200 dark:focus-visible:ring-gray-700"
      :aria-label="label"
    >
      <EllipsisHorizontal class="h-4 w-4" />
    </button>

    <Menu
      :id="menuId"
      :aria-label="label"
      :placement="menuPlacement"
      :offset="4"
      :data-test="testId"
      class="min-w-44 rounded-md border-gray-200 bg-white px-0 py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
    >
      <template v-for="item in items" :key="item.key">
        <Link
          v-if="item.href && !item.disabled"
          :href="item.href"
          :data-test="`${testId}-${item.key}`"
          :class="itemClasses(item)"
          @click="select(item)"
        >
          {{ item.label }}
        </Link>
        <button
          v-else
          type="button"
          :disabled="item.disabled"
          :data-test="`${testId}-${item.key}`"
          :class="itemClasses(item)"
          @click="select(item)"
        >
          {{ item.label }}
        </button>
      </template>
    </Menu>
  </div>
</template>
