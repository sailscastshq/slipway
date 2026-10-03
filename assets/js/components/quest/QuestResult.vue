<script setup>
import { computed, ref, watch } from 'vue'
import HelmResultTreeNode from '@/components/HelmResultTreeNode.vue'
import Table from '@/components/ui/table/Table.vue'
import {
  isHelmTableValue,
  isHelmBranch,
  helmTableColumns,
  helmScalarPresentation,
  serializeHelmValue
} from '@/lib/helmResult'
const props = defineProps({ result: Object, pending: Boolean, legacy: Boolean })
const view = ref('raw')
const value = computed(() => props.result?.value)
const table = computed(() => isHelmTableValue(value.value))
const structured = computed(() => isHelmBranch(value.value))
const columns = computed(() => helmTableColumns(value.value))
const available = computed(() => props.result?.status === 'available')
const views = computed(() =>
  table.value
    ? ['table', 'tree', 'raw']
    : structured.value
    ? ['tree', 'raw']
    : ['raw']
)
const unavailableText = computed(() => {
  if (props.legacy) return 'Return values were not recorded for legacy events.'
  if (props.pending)
    return 'The return value will appear when this run finishes.'
  return (
    {
      undefined: 'This job returned undefined.',
      unsupported: 'This runtime does not capture return values.',
      too_large: 'The return value exceeded the capture limit.',
      serialization_error: 'The return value could not be serialized.',
      unavailable: 'The return value is no longer available.'
    }[props.result?.status] || 'No return value was recorded.'
  )
})
watch(
  () => props.result,
  () => {
    view.value = table.value ? 'table' : structured.value ? 'tree' : 'raw'
  },
  { immediate: true }
)
</script>

<template>
  <div data-test="quest-run-result" class="min-w-0">
    <p
      v-if="result?.exit"
      class="border-b border-gray-100 px-4 py-2 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400"
    >
      Exit: {{ result.exit }}
    </p>
    <p
      v-if="!available"
      class="px-4 py-8 text-sm text-gray-500 dark:text-gray-400"
    >
      {{ unavailableText }}
    </p>
    <template v-else>
      <div
        class="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-2 dark:border-gray-800"
      >
        <span class="text-xs text-gray-500 dark:text-gray-400">{{
          table
            ? `${value.length} rows`
            : Array.isArray(value)
            ? `${value.length} items`
            : value === null
            ? 'null'
            : typeof value
        }}</span>
        <div
          v-if="views.length > 1"
          class="flex gap-1"
          aria-label="Result view"
        >
          <button
            v-for="option in views"
            :key="option"
            type="button"
            :aria-pressed="view === option"
            :class="[
              'rounded px-2 py-1 text-xs capitalize',
              view === option
                ? 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-white'
                : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
            ]"
            @click="view = option"
          >
            {{ option }}
          </button>
        </div>
      </div>
      <div class="max-h-96 overflow-auto">
        <Table v-if="view === 'table' && table" class="text-xs">
          <thead
            class="sticky top-0 bg-gray-50 text-gray-500 dark:bg-gray-900 dark:text-gray-400"
          >
            <tr>
              <th
                v-for="column in columns"
                :key="column"
                class="whitespace-nowrap px-4 py-2 font-medium"
              >
                {{ column }}
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
            <tr v-for="(row, index) in value" :key="index">
              <td
                v-for="column in columns"
                :key="column"
                class="whitespace-pre-wrap px-4 py-2 font-mono"
              >
                {{ helmScalarPresentation(row[column]).text }}
              </td>
            </tr>
          </tbody>
        </Table>
        <ul v-else-if="view === 'tree' && structured" class="p-4">
          <HelmResultTreeNode
            v-for="[key, item] in Object.entries(value)"
            :key="key"
            :name="key"
            :value="item"
          />
        </ul>
        <pre
          v-else
          class="whitespace-pre-wrap break-words p-4 font-mono text-xs leading-6 text-gray-700 dark:text-gray-300"
          >{{ serializeHelmValue(value) }}</pre
        >
      </div>
      <p
        v-if="result.truncated"
        class="border-t border-gray-100 px-4 py-2 text-xs text-amber-700 dark:border-gray-800 dark:text-amber-400"
      >
        Return value truncated.
      </p>
    </template>
  </div>
</template>
