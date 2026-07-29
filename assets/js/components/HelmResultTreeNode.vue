<script setup>
import { computed } from 'vue'
import { helmScalarPresentation, isHelmBranch } from '@/lib/helmResult'

const props = defineProps({
  name: {
    type: [String, Number],
    required: true
  },
  value: {
    default: null
  },
  depth: {
    type: Number,
    default: 0
  }
})

const branch = computed(() => isHelmBranch(props.value))
const entries = computed(() =>
  branch.value ? Object.entries(props.value) : []
)
const branchSummary = computed(() => {
  const count = entries.value.length
  if (Array.isArray(props.value)) {
    return count === 0 ? '[]' : `Array(${count})`
  }
  return count === 0 ? '{}' : `{${count}}`
})
const scalar = computed(() => helmScalarPresentation(props.value))

function scalarClasses(type) {
  return {
    boolean: 'text-blue-600 dark:text-blue-400',
    date: 'text-cyan-600 dark:text-cyan-400',
    number: 'text-purple-600 dark:text-purple-400',
    bigint: 'text-purple-600 dark:text-purple-400',
    null: 'italic text-gray-400 dark:text-gray-600',
    string: 'text-amber-600 dark:text-amber-400',
    undefined: 'italic text-gray-400 dark:text-gray-600'
  }[type]
}
</script>

<template>
  <li class="min-w-max">
    <details v-if="branch" class="helm-tree-branch">
      <summary
        class="flex cursor-pointer list-none items-center gap-1 rounded-sm py-0.5 pr-2 font-mono text-xs leading-5 text-gray-700 outline-none hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-gray-300 dark:text-gray-300 dark:hover:bg-gray-900 dark:focus-visible:ring-gray-700"
      >
        <svg
          class="helm-tree-chevron h-3 w-3 shrink-0 text-gray-400 transition-transform motion-reduce:transition-none dark:text-gray-600"
          fill="none"
          viewBox="0 0 12 12"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            d="m4.5 2.5 3.5 3.5-3.5 3.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.25"
          />
        </svg>
        <span class="text-pink-600 dark:text-pink-400">{{ name }}</span>
        <span aria-hidden="true" class="text-gray-400 dark:text-gray-600"
          >:</span
        >
        <span class="text-gray-500 dark:text-gray-500">{{
          branchSummary
        }}</span>
      </summary>
      <ul
        v-if="entries.length"
        class="ml-1.5 space-y-0 border-l border-gray-100 pl-3 dark:border-gray-800"
      >
        <HelmResultTreeNode
          v-for="([key, entryValue], index) in entries"
          :key="`${depth}-${key}-${index}`"
          :name="key"
          :value="entryValue"
          :depth="depth + 1"
        />
      </ul>
    </details>

    <div
      v-else
      class="flex min-w-0 items-start gap-1 py-0.5 pl-4 pr-2 font-mono text-xs leading-5"
    >
      <span class="shrink-0 text-pink-600 dark:text-pink-400">{{ name }}</span>
      <span aria-hidden="true" class="shrink-0 text-gray-400 dark:text-gray-600"
        >:</span
      >
      <time
        v-if="scalar.datetime"
        :datetime="scalar.datetime"
        :title="scalar.title"
        :class="scalarClasses(scalar.type)"
        class="break-all"
        >{{ scalar.text }}</time
      >
      <span
        v-else
        :title="scalar.title"
        :class="scalarClasses(scalar.type)"
        class="max-w-80 sm:max-w-96 min-w-0 truncate"
        >{{ scalar.text }}</span
      >
    </div>
  </li>
</template>

<style scoped>
.helm-tree-branch[open] > summary .helm-tree-chevron {
  transform: rotate(90deg);
}
</style>
