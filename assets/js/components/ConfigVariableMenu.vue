<script setup>
import Select from '@/components/ui/select/Select.vue'

const props = defineProps({
  variableKey: { type: String, required: true },
  metadata: { type: Object, required: true }
})

const emit = defineEmits(['update', 'remove'])

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

function toggleDetails(event) {
  const details = event.currentTarget.closest('details')
  details.open = !details.open
}
</script>

<template>
  <details :data-test="`config-menu-${variableKey}`" class="relative">
    <summary
      :aria-label="`Configure ${variableKey}`"
      @keydown.enter.prevent="toggleDetails"
      class="flex cursor-pointer list-none rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-200 dark:focus-visible:ring-gray-700 [&::-webkit-details-marker]:hidden"
    >
      <svg
        class="h-4 w-4"
        fill="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle cx="5" cy="12" r="1.5" />
        <circle cx="12" cy="12" r="1.5" />
        <circle cx="19" cy="12" r="1.5" />
      </svg>
    </summary>

    <div
      class="absolute right-0 z-30 mt-1 w-64 space-y-4 rounded-lg bg-white p-4 shadow-lg ring-1 ring-black/5 dark:bg-gray-900 dark:ring-white/10"
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
            class="mt-1 block w-full rounded-md border-0 bg-gray-50 px-2 py-1.5 text-sm text-gray-900 ring-1 ring-inset ring-gray-200 focus:ring-gray-400 dark:bg-gray-950 dark:text-white dark:ring-gray-800 dark:focus:ring-gray-600"
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
            class="mt-1 block w-full rounded-md border-0 bg-gray-50 px-2 py-1.5 text-sm text-gray-900 ring-1 ring-inset ring-gray-200 focus:ring-gray-400 dark:bg-gray-950 dark:text-white dark:ring-gray-800 dark:focus:ring-gray-600"
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
          <input
            :value="metadata.description || ''"
            @blur="update('description', $event.target.value)"
            maxlength="160"
            class="mt-1 block w-full rounded-md border-0 bg-gray-50 px-2 py-1.5 text-sm text-gray-900 ring-1 ring-inset ring-gray-200 placeholder:text-gray-400 focus:ring-gray-400 dark:bg-gray-950 dark:text-white dark:ring-gray-800 dark:focus:ring-gray-600"
            placeholder="What uses this value?"
          />
        </label>

        <button
          type="button"
          @pointerdown.prevent
          @click="emit('remove')"
          class="text-sm text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
        >
          Remove variable
        </button>
      </template>
    </div>
  </details>
</template>
