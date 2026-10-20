<script setup>
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import Dialog from '@/components/ui/dialog/Dialog.vue'
import X from '@/components/ui/icons/X.vue'
import {
  authorizeMediaPreview,
  loadPdfPreview,
  normalizeMediaPreview
} from '@/lib/bridge/media-preview.mjs'
const props = defineProps({ preview: Object })
const emit = defineEmits(['close'])
const dialog = ref(),
  video = ref(),
  source = ref(null),
  error = ref(''),
  busy = ref(false)
let controller,
  generation = 0,
  pdfUrl
function stop() {
  generation++
  controller?.abort()
  if (pdfUrl) {
    URL.revokeObjectURL(pdfUrl)
    pdfUrl = null
  }
  if (video.value) {
    video.value.pause()
    video.value.removeAttribute('src')
    video.value.load()
  }
  source.value = null
}
function dismiss() {
  stop()
  emit('close')
}
watch(
  () => props.preview,
  async (value) => {
    stop()
    error.value = ''
    busy.value = false
    if (!value) {
      dialog.value?.close()
      return
    }
    const preview = normalizeMediaPreview(value)
    if (!preview) return
    const current = generation
    await nextTick()
    if (current !== generation) return
    const invoker =
      document.activeElement !== document.body
        ? document.activeElement
        : document.querySelector('button[aria-label^="Actions for "]')
    dialog.value?.showModal(invoker)
    controller = new AbortController()
    busy.value = true
    try {
      await authorizeMediaPreview(preview, controller.signal)
      const objectUrl =
        preview.type === 'pdf'
          ? await loadPdfPreview(preview, controller.signal)
          : null
      if (current === generation) {
        pdfUrl = objectUrl
        source.value = { ...preview, ...(objectUrl ? { objectUrl } : {}) }
      } else if (objectUrl) URL.revokeObjectURL(objectUrl)
    } catch (e) {
      if (current === generation && e.name !== 'AbortError')
        error.value = e.message?.includes('64 MiB')
          ? 'This PDF is too large for inline preview (64 MiB maximum).'
          : 'This material is unavailable or your access has expired.'
    } finally {
      if (current === generation) busy.value = false
    }
  },
  { immediate: true }
)
onBeforeUnmount(stop)
</script>
<template>
  <Dialog
    ref="dialog"
    aria-labelledby="bridge-media-title"
    class="w-[calc(100vw-2rem)] max-w-5xl p-0"
    @update:open="(value) => !value && dismiss()"
    @cancel="dismiss"
    @close="dismiss"
  >
    <div
      class="flex items-center justify-between gap-4 border-b border-gray-200 px-4 py-3 dark:border-gray-700"
    >
      <h2 id="bridge-media-title" class="truncate text-base font-semibold">
        {{ preview?.title }}
      </h2>
      <button
        type="button"
        class="size-9 grid shrink-0 place-items-center rounded-md text-gray-500 hover:text-gray-900 focus-visible:outline-2 dark:hover:text-white"
        aria-label="Close preview"
        autofocus
        @click="dialog?.close()"
      >
        <X class="size-5" />
      </button>
    </div>
    <div class="max-h-[calc(100dvh-8rem)] overflow-auto p-4">
      <p
        v-if="busy"
        role="status"
        class="py-12 text-center text-sm text-gray-500"
      >
        Loading preview…
      </p>
      <p
        v-else-if="error"
        role="alert"
        class="py-12 text-center text-sm text-gray-600 dark:text-gray-300"
      >
        {{ error }}
      </p>
      <video
        v-else-if="source?.type === 'video'"
        ref="video"
        :src="source.url"
        :aria-label="source.title"
        controls
        playsinline
        preload="metadata"
        class="max-h-[calc(100dvh-12rem)] w-full rounded bg-black"
        @error="
          error =
            'This video could not be played. Check your access or try again.'
        "
      />
      <iframe
        v-else-if="source?.type === 'pdf'"
        :src="`${source.objectUrl}#toolbar=0&navpanes=0&view=FitH`"
        :title="source.title"
        referrerpolicy="no-referrer"
        class="h-[min(70dvh,48rem)] w-full rounded border border-gray-200 bg-white dark:border-gray-700"
      />
    </div>
  </Dialog>
</template>
