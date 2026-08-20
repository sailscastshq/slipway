<script setup>
import Textarea from '@/components/ui/textarea/Textarea.vue'
import Input from '@/components/ui/input/Input.vue'
import { ref, watch } from 'vue'

const props = defineProps({ flag: { type: Object, required: true } })
const emit = defineEmits(['update', 'remove'])

const description = ref('')
const rolloutPercentage = ref(0)
const targets = ref('')

watch(
  () => props.flag,
  (flag) => {
    description.value = flag.description || ''
    rolloutPercentage.value = Number(flag.rolloutPercentage || 0)
    targets.value = (flag.targets || []).join('\n')
  },
  { immediate: true, deep: true }
)

function save(event) {
  emit('update', {
    description: description.value.trim() || null,
    rolloutPercentage: Number(rolloutPercentage.value),
    targets: targets.value
      .split(/[\n,]/)
      .map((target) => target.trim())
      .filter(Boolean)
  })
  event.currentTarget.closest('details').removeAttribute('open')
}

function remove(event) {
  emit('remove')
  event.currentTarget.closest('details').removeAttribute('open')
}
</script>

<template>
  <details class="relative">
    <summary
      class="list-none rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
      aria-label="Release flag settings"
    >
      <svg class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
        <circle cx="5" cy="12" r="1.5" />
        <circle cx="12" cy="12" r="1.5" />
        <circle cx="19" cy="12" r="1.5" />
      </svg>
    </summary>
    <form
      @submit.prevent="save"
      class="absolute right-0 z-30 mt-1 w-72 rounded-lg border border-gray-200 bg-white p-3 shadow-lg dark:border-gray-700 dark:bg-gray-900"
    >
      <label class="block text-xs font-medium text-gray-700 dark:text-gray-300">
        Description
        <Input
          v-model="description"
          maxlength="160"
          class="mt-1 w-full border-b border-gray-200 bg-transparent py-1.5 text-sm font-normal text-gray-900 placeholder-gray-400 focus:border-gray-500 focus:outline-none dark:border-gray-700 dark:text-white"
          placeholder="What this release changes"
        />
      </label>
      <label
        class="mt-3 block text-xs font-medium text-gray-700 dark:text-gray-300"
      >
        Rollout
        <div class="mt-1 flex items-center gap-2">
          <input
            v-model.number="rolloutPercentage"
            type="range"
            min="0"
            max="100"
            step="1"
            class="min-w-0 flex-1 accent-gray-900 dark:accent-white"
          />
          <span class="w-10 text-right font-mono text-xs text-gray-500"
            >{{ rolloutPercentage }}%</span
          >
        </div>
      </label>
      <label
        class="mt-3 block text-xs font-medium text-gray-700 dark:text-gray-300"
      >
        Allowlist
        <Textarea
          v-model="targets"
          rows="3"
          class="mt-1 w-full resize-none border-b border-gray-200 bg-transparent py-1.5 font-mono text-xs font-normal text-gray-900 placeholder-gray-400 focus:border-gray-500 focus:outline-none dark:border-gray-700 dark:text-white"
          placeholder="user:42&#10;account:acme"
        />
      </label>
      <p class="mt-1 text-[11px] leading-4 text-gray-400">
        One user, account, tenant, or team per line.
      </p>
      <div class="mt-3 flex items-center justify-between">
        <button
          type="button"
          @click="remove"
          class="text-xs font-medium text-red-600 hover:text-red-700 dark:text-red-400"
        >
          Delete
        </button>
        <button
          type="submit"
          class="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
        >
          Save
        </button>
      </div>
    </form>
  </details>
</template>
