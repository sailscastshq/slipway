<script setup>
import { useId } from 'vue'
import Button from '@/components/ui/button/Button.vue'
import Dialog from '@/components/ui/dialog/Dialog.vue'
import Spinner from '@/components/SlipwaySpinner.vue'

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
const instanceId = useId()
const titleId = `confirm-modal-title-${instanceId}`
const messageId = `confirm-modal-message-${instanceId}`

function cancel() {
  if (!props.loading) emit('cancel')
}

function confirm() {
  if (!props.loading) emit('confirm')
}

function handleOpenChange(open) {
  if (!open) cancel()
}
</script>

<template>
  <Dialog
    :open="show"
    :dismissible="!loading"
    :aria-labelledby="titleId"
    :aria-describedby="messageId"
    :aria-busy="loading ? 'true' : undefined"
    data-test="confirm-modal"
    class="transition-discrete starting:open:scale-95 starting:open:opacity-0 starting:open:backdrop:bg-black/0 z-50 max-w-sm scale-95 border-gray-200 bg-white p-6 text-gray-950 opacity-0 shadow-xl transition-[display,overlay,opacity,transform] duration-200 ease-out backdrop:bg-black/0 backdrop:transition-colors backdrop:duration-200 open:scale-100 open:opacity-100 open:backdrop:bg-black/50 motion-reduce:transition-none dark:border-gray-700 dark:bg-gray-900 dark:text-white"
    @update:open="handleOpenChange"
  >
    <h3 :id="titleId" class="text-lg font-semibold">
      {{ title }}
    </h3>
    <p :id="messageId" class="mt-2 text-sm text-gray-500 dark:text-gray-400">
      {{ message }}
    </p>
    <slot name="form" />
    <div class="mt-4 flex justify-end gap-3">
      <Button
        type="button"
        autofocus
        :disabled="loading"
        class="min-h-0 min-w-0 cursor-pointer rounded-md border border-gray-300 bg-transparent px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 active:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-transparent dark:text-gray-300 dark:hover:bg-gray-800 dark:active:bg-gray-700"
        @click="cancel"
      >
        {{ cancelLabel }}
      </Button>
      <Button
        type="button"
        :disabled="loading"
        :aria-busy="loading ? 'true' : undefined"
        :class="[
          'min-h-0 min-w-0 cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50',
          destructive
            ? 'bg-red-600 hover:bg-red-700 active:bg-red-800 dark:bg-red-600 dark:text-white dark:hover:bg-red-700 dark:active:bg-red-800'
            : 'bg-gray-900 hover:bg-gray-800 active:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100 dark:active:bg-gray-200'
        ]"
        @click="confirm"
      >
        <span v-if="loading" class="flex items-center gap-2">
          <Spinner class="size-4" />
          Loading...
        </span>
        <span v-else>{{ confirmLabel }}</span>
      </Button>
    </div>
  </Dialog>
</template>
