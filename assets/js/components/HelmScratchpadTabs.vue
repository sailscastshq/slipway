<script setup>
import X from '@/components/ui/icons/X.vue'
import Plus from '@/components/ui/icons/Plus.vue'
import Input from '@/components/ui/input/Input.vue'
import { computed, nextTick, ref } from 'vue'
import ActionMenu from '@/components/ActionMenu.vue'
import Tooltip from '@/components/ui/tooltip/Tooltip.vue'
import {
  helmScratchpadIsModified,
  helmScratchpadTargetLabel,
  helmScratchpadTargetTitle
} from '@/lib/helmScratchpads.mjs'

const props = defineProps({
  tabs: { type: Array, default: () => [] },
  activeId: { type: String, default: '' },
  currentTargetKey: { type: String, default: '' },
  disabled: Boolean,
  canCreate: Boolean
})

const emit = defineEmits([
  'close',
  'create',
  'duplicate',
  'move',
  'rename',
  'save'
])

const renamingId = ref('')
const renameValue = ref('')
const renameInput = ref(null)
const activeIndex = computed(() =>
  props.tabs.findIndex((tab) => tab.id === props.activeId)
)
const activeTab = computed(() => props.tabs[activeIndex.value] || null)
const actions = computed(() => {
  if (!activeTab.value) return []
  return [
    { key: 'rename', label: 'Rename' },
    { key: 'duplicate', label: 'Duplicate', disabled: !props.canCreate },
    {
      key: 'move-left',
      label: 'Move left',
      disabled: activeIndex.value <= 0
    },
    {
      key: 'move-right',
      label: 'Move right',
      disabled: activeIndex.value >= props.tabs.length - 1
    },
    { key: 'save', label: 'Save as snippet' },
    { key: 'close', label: 'Delete scratchpad', destructive: true }
  ]
})

async function beginRename(tab = activeTab.value) {
  if (!tab || props.disabled) return
  renamingId.value = tab.id
  renameValue.value = tab.name
  await nextTick()
  renameInput.value?.focus()
  renameInput.value?.select()
}

async function commitRename(returnFocus = false) {
  if (!renamingId.value) return
  const id = renamingId.value
  renamingId.value = ''
  emit('rename', id, renameValue.value)
  if (returnFocus) {
    await nextTick()
    document.getElementById(`helm-scratchpad-${id}-tab`)?.focus()
  }
}

async function cancelRename() {
  const id = renamingId.value
  renamingId.value = ''
  await nextTick()
  document.getElementById(`helm-scratchpad-${id}-tab`)?.focus()
}

function setRenameInput(element) {
  renameInput.value = element
}

function handleAction(action) {
  const tab = activeTab.value
  if (!tab) return
  if (action.key === 'rename') beginRename(tab)
  if (action.key === 'duplicate') emit('duplicate', tab)
  if (action.key === 'move-left') emit('move', tab, -1)
  if (action.key === 'move-right') emit('move', tab, 1)
  if (action.key === 'save') emit('save', tab)
  if (action.key === 'close') emit('close', tab)
}

function createScratchpad() {
  if (props.disabled || !props.canCreate) return
  emit('create')
}
</script>

<template>
  <div
    data-test="helm-scratchpads"
    class="min-h-9 flex shrink-0 items-center gap-2 bg-white px-3 py-0.5 dark:bg-gray-950"
  >
    <div
      data-slot="tabs-list"
      class="flex min-w-0 flex-1 items-center gap-3 overflow-x-auto"
    >
      <template v-for="(tab, index) in tabs" :key="tab.id">
        <Input
          v-if="renamingId === tab.id"
          :ref="setRenameInput"
          v-model="renameValue"
          data-test="helm-scratchpad-rename"
          maxlength="64"
          aria-label="Scratchpad name"
          class="focus:border-brand h-8 w-40 shrink-0 rounded-none border-0 border-b border-dashed border-gray-200 bg-transparent px-0.5 text-xs font-medium text-gray-900 outline-none focus:ring-0 dark:border-gray-700 dark:text-white"
          @blur="commitRename()"
          @keydown.enter.prevent="commitRename(true)"
          @keydown.escape.prevent="cancelRename"
        />
        <button
          v-show="renamingId !== tab.id"
          :id="`helm-scratchpad-${tab.id}-tab`"
          type="button"
          :data-value="tab.id"
          :data-test="`helm-scratchpad-${index}`"
          aria-controls="helm-scratchpad-panel"
          :disabled="disabled"
          :title="helmScratchpadTargetTitle(tab.target)"
          :class="[
            'max-w-64 flex h-8 shrink-0 items-center gap-1.5 rounded-sm px-0.5 text-left text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-gray-300 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none dark:focus-visible:ring-gray-700',
            tab.id === activeId
              ? 'font-medium text-gray-900 dark:text-white'
              : 'text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300'
          ]"
          @click="tab.id === activeId && beginRename(tab)"
        >
          <span class="truncate">{{ tab.name }}</span>
          <span
            v-if="tab.target.key !== currentTargetKey"
            class="max-w-28 truncate font-normal text-gray-400 dark:text-gray-500"
            >{{ helmScratchpadTargetLabel(tab.target) }}</span
          >
          <span
            v-if="helmScratchpadIsModified(tab)"
            class="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"
            aria-hidden="true"
          ></span>
          <span v-if="helmScratchpadIsModified(tab)" class="sr-only">
            Modified
          </span>
        </button>
        <button
          v-if="renamingId !== tab.id"
          type="button"
          :aria-label="`Delete ${tab.name}`"
          :disabled="disabled"
          class="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-900 focus-visible:ring-2 focus-visible:ring-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
          @click.stop="emit('close', tab)"
        >
          <X class="h-3.5 w-3.5" />
        </button>
      </template>
    </div>

    <div class="flex shrink-0 items-center gap-0.5">
      <Tooltip
        :text="canCreate ? 'New scratchpad' : 'Scratchpad limit reached'"
        placement="bottom"
      >
        <button
          type="button"
          data-test="helm-scratchpad-create"
          :aria-disabled="disabled || !canCreate"
          aria-label="New scratchpad"
          :class="[
            'rounded-md p-1.5 text-gray-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 dark:text-gray-500 dark:focus-visible:ring-gray-700',
            disabled || !canCreate
              ? 'cursor-not-allowed opacity-40'
              : 'hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-900 dark:hover:text-gray-200'
          ]"
          @click="createScratchpad"
        >
          <Plus class="h-4 w-4" stroke-width="1.75" />
        </button>
      </Tooltip>
      <ActionMenu
        :items="actions"
        label="Scratchpad actions"
        test-id="helm-scratchpad-actions"
        :disabled="disabled || !activeTab"
        @select="handleAction"
      />
    </div>
  </div>
</template>
