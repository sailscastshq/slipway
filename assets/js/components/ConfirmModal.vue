<script setup>
import { watch, onUnmounted } from 'vue'
import SlippyLoader from '@/components/SlippyLoader.vue'

const props = defineProps({
  show: {
    type: Boolean,
    default: false
  },
  title: {
    type: String,
    default: 'Are you sure?'
  },
  message: {
    type: String,
    default: 'This action cannot be undone.'
  },
  confirmLabel: {
    type: String,
    default: 'Confirm'
  },
  cancelLabel: {
    type: String,
    default: 'Cancel'
  },
  destructive: {
    type: Boolean,
    default: false
  },
  loading: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['confirm', 'cancel'])

// Handle escape key to close modal
function handleKeydown(e) {
  if (e.key === 'Escape' && !props.loading) {
    emit('cancel')
  }
}

watch(() => props.show, (isShown) => {
  if (isShown) {
    document.addEventListener('keydown', handleKeydown)
  } else {
    document.removeEventListener('keydown', handleKeydown)
  }
}, { immediate: true })

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div v-if="show" class="fixed inset-0 z-50 flex items-center justify-center">
        <div class="fixed inset-0 bg-black/50" @click="emit('cancel')" />
        <Transition
          enter-active-class="transition duration-200 ease-out"
          enter-from-class="scale-95 opacity-0"
          enter-to-class="scale-100 opacity-100"
          leave-active-class="transition duration-150 ease-in"
          leave-from-class="scale-100 opacity-100"
          leave-to-class="scale-95 opacity-0"
        >
          <div
            v-if="show"
            class="relative w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6 shadow-xl dark:border-gray-700 dark:bg-gray-900"
          >
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white">
              {{ title }}
            </h3>
            <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
              {{ message }}
            </p>
            <div class="mt-4 flex justify-end space-x-3">
              <button
                @click="emit('cancel')"
                :disabled="loading"
                class="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                {{ cancelLabel }}
              </button>
              <button
                @click="emit('confirm')"
                :disabled="loading"
                :class="[
                  'rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50',
                  destructive
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-gray-900 hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100'
                ]"
              >
                <span v-if="loading" class="flex items-center gap-2">
                  <SlippyLoader size="h-4 w-4" />
                  Loading...
                </span>
                <span v-else>{{ confirmLabel }}</span>
              </button>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>
