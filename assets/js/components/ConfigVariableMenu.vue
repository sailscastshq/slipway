<script setup>
import EllipsisHorizontal from '@/components/ui/icons/EllipsisHorizontal.vue'
import Input from '@/components/ui/input/Input.vue'
import Select from '@/components/ui/select/Select.vue'
import Popover from '@/components/ui/popover/Popover.vue'
import { nextTick, ref, useId } from 'vue'

const props = defineProps({
  variableKey: { type: String, required: true },
  metadata: { type: Object, required: true }
})

const emit = defineEmits(['update', 'remove'])
const popover = ref()
const menuId = `config-variable-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
async function focusEditor(open) {
  if (!open) return
  await nextTick()
  const content = popover.value?.content
  const element = content?.value || content
  const first = element?.querySelector('button, input')
  ;(first || element)?.focus({ preventScroll: true })
}
function remove() {
  popover.value?.close({ restoreFocus: true })
  emit('remove')
}

function update(field, value) {
  emit('update', {
    ...props.metadata,
    [field]: value
  })
}

function previewPolicyDescription(policy) {
  return {
    omit: 'Not copied to preview environments.',
    inherit: 'Copied to preview environments.',
    randomize: 'A fresh value is generated for each preview environment.'
  }[policy]
}
</script>

<template>
  <div :data-test="`config-menu-${variableKey}`">
    <button
      type="button"
      :popovertarget="menuId"
      aria-haspopup="dialog"
      :aria-label="`Configure ${variableKey}`"
      class="min-h-11 min-w-11 flex cursor-pointer items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-200 dark:focus-visible:ring-gray-700"
    >
      <EllipsisHorizontal class="h-4 w-4" />
    </button>

    <Popover
      ref="popover"
      :id="menuId"
      role="dialog"
      tabindex="-1"
      :aria-label="`Configure ${variableKey}`"
      placement="bottom-end"
      :offset="4"
      class="w-72 space-y-4 p-4"
      @update:open="focusEditor"
    >
      <p
        v-if="metadata.managed"
        class="text-xs leading-5 text-gray-500 dark:text-gray-400"
      >
        Managed by Slipway. Change or remove the service that owns this value.
      </p>

      <div v-if="metadata.managed">
        <p class="text-xs font-medium text-gray-700 dark:text-gray-300">
          Preview environments
        </p>
        <p
          data-test="config-preview-policy-description"
          class="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400"
        >
          {{ previewPolicyDescription(metadata.previewPolicy) }}
        </p>
      </div>

      <template v-else>
        <label class="block">
          <span class="text-xs font-medium text-gray-700 dark:text-gray-300"
            >Value type</span
          >
          <Select
            :model-value="metadata.kind"
            :options="[
              { value: 'secret', label: 'Secret' },
              { value: 'plain', label: 'Plain config' }
            ]"
            @change="update('kind', $event)"
            class="focus-visible:outline-brand mt-2 w-full rounded-md border-0 bg-gray-50 px-3 py-2.5 text-sm text-gray-900 dark:bg-gray-900 dark:text-white"
          />
        </label>

        <label class="block">
          <span class="text-xs font-medium text-gray-700 dark:text-gray-300"
            >Preview environments</span
          >
          <Select
            :model-value="metadata.previewPolicy"
            :options="[
              { value: 'omit', label: 'Omit' },
              { value: 'inherit', label: 'Inherit' },
              { value: 'randomize', label: 'Generate a new value' }
            ]"
            @change="update('previewPolicy', $event)"
            class="focus-visible:outline-brand mt-2 w-full rounded-md border-0 bg-gray-50 px-3 py-2.5 text-sm text-gray-900 dark:bg-gray-900 dark:text-white"
          />
          <span
            data-test="config-preview-policy-description"
            class="mt-1 block text-xs leading-5 text-gray-500 dark:text-gray-400"
          >
            {{ previewPolicyDescription(metadata.previewPolicy) }}
          </span>
        </label>

        <label class="block">
          <span class="text-xs font-medium text-gray-700 dark:text-gray-300"
            >Description
            <span class="font-normal text-gray-400">(optional)</span></span
          >
          <Input
            :value="metadata.description || ''"
            @blur="update('description', $event.target.value)"
            maxlength="160"
            class="focus-visible:outline-brand mt-2 block w-full rounded-md border-0 bg-gray-50 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus-visible:outline focus-visible:outline-2 dark:bg-gray-900 dark:text-white"
            placeholder="What uses this value?"
          />
        </label>

        <button
          type="button"
          @click="remove"
          class="min-h-11 text-sm text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
        >
          Remove variable
        </button>
      </template>
    </Popover>
  </div>
</template>
