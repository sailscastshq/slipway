<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import ActionMenu from '@/components/ActionMenu.vue'
import HelmResultTreeNode from '@/components/HelmResultTreeNode.vue'
import Table from '@/components/ui/table/Table.vue'
import { questResultCountLabel } from '@/lib/questWorkspace.mjs'
import {
  isHelmTableValue,
  isHelmBranch,
  helmTableColumns,
  helmScalarPresentation
} from '@/lib/helmResult'
import {
  downloadQuestResultJson,
  serializeQuestResult
} from './questResultActions.mjs'
const props = defineProps({ result: Object, pending: Boolean, legacy: Boolean })
const view = ref('raw')
const busy = ref(false)
const actionMessage = ref('')
const actionFailed = ref(false)
let actionSequence = 0
const value = computed(() => props.result?.value)
const table = computed(() => isHelmTableValue(value.value))
const structured = computed(() => isHelmBranch(value.value))
const columns = computed(() => helmTableColumns(value.value))
const json = computed(() =>
  props.pending || props.legacy ? null : serializeQuestResult(props.result)
)
const available = computed(() => json.value !== null)
const actionItems = computed(() => [
  {
    key: 'copy-json',
    label: props.result?.truncated ? 'Copy retained JSON' : 'Copy as JSON'
  },
  {
    key: 'export-json',
    label: props.result?.truncated ? 'Export retained JSON' : 'Export JSON'
  }
])
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
  if (props.result?.status === 'available')
    return 'The retained return value could not be serialized.'
  return (
    {
      undefined: 'Return value: undefined.',
      unsupported: 'This return value is not supported.',
      too_large: 'The return value exceeded the capture limit.',
      serialization_error: 'The return value could not be serialized.',
      unavailable: 'Return value unavailable.'
    }[props.result?.status] || 'No return value was recorded.'
  )
})
watch(
  () => [
    props.result,
    props.result?.truncated,
    props.pending,
    props.legacy,
    json.value
  ],
  () => {
    resetActions()
    view.value = table.value ? 'table' : structured.value ? 'tree' : 'raw'
  },
  { immediate: true }
)
onBeforeUnmount(resetActions)

function resetActions() {
  actionSequence += 1
  busy.value = false
  actionMessage.value = ''
  actionFailed.value = false
}

async function handleAction(item) {
  if (
    busy.value ||
    !available.value ||
    !['copy-json', 'export-json'].includes(item.key)
  )
    return
  const current = ++actionSequence
  const text = json.value
  const truncated = Boolean(props.result?.truncated)
  const copying = item.key === 'copy-json'
  busy.value = true
  actionFailed.value = false
  actionMessage.value = copying ? 'Copying result…' : 'Starting download…'
  // Announce each interaction, including repeated copies or downloads.
  await nextTick()
  if (current !== actionSequence) return
  try {
    let message
    if (copying) {
      await navigator.clipboard.writeText(text)
      message = truncated
        ? 'Copied retained JSON only. The return value is truncated.'
        : 'Copied result JSON to clipboard.'
    } else {
      const filename = downloadQuestResultJson(text, truncated)
      message = `Download started: ${filename}.`
    }
    if (current === actionSequence) actionMessage.value = message
  } catch {
    if (current === actionSequence) {
      actionFailed.value = true
      actionMessage.value = copying
        ? 'Could not copy the result. Try again or export JSON.'
        : 'Could not start the download. Try again or copy JSON.'
    }
  } finally {
    if (current === actionSequence) busy.value = false
  }
}
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
        class="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 py-2 dark:border-gray-800"
      >
        <span class="text-xs text-gray-500 dark:text-gray-400">{{
          table
            ? questResultCountLabel(value.length, 'row')
            : Array.isArray(value)
            ? questResultCountLabel(value.length, 'item')
            : value === null
            ? 'null'
            : typeof value
        }}</span>
        <div class="flex items-center gap-2">
          <div
            v-if="views.length > 1"
            class="flex gap-1"
            role="group"
            aria-label="Result view"
          >
            <button
              v-for="option in views"
              :key="option"
              type="button"
              :aria-pressed="view === option"
              :class="[
                'rounded px-2 py-1 text-xs capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 dark:focus-visible:ring-gray-700',
                view === option
                  ? 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-white'
                  : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
              ]"
              @click="view = option"
            >
              {{ option }}
            </button>
          </div>
          <ActionMenu
            :items="actionItems"
            :disabled="busy"
            :aria-busy="busy"
            label="Sanitized business result actions"
            test-id="quest-result-actions"
            @select="handleAction"
          />
        </div>
      </div>
      <p class="sr-only" data-test="quest-result-scope">
        Copy and export include only the retained, sanitized return value.
      </p>
      <p
        v-if="result.truncated"
        role="note"
        class="px-4 pt-2 text-xs text-amber-700 dark:text-amber-400"
      >
        Return value truncated. Copy and export will not include omitted data.
      </p>
      <p
        data-test="quest-result-action-feedback"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        :class="[
          actionMessage ? 'px-4 pt-2 text-xs' : 'sr-only',
          actionFailed
            ? 'text-red-600 dark:text-red-400'
            : 'text-gray-500 dark:text-gray-400'
        ]"
      >
        {{ actionMessage }}
      </p>
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
          >{{ json }}</pre
        >
      </div>
    </template>
  </div>
</template>
