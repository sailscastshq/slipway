<script setup>
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import Spinner from '@/components/SlipwaySpinner.vue'

const props = defineProps({
  show: Boolean,
  findings: {
    type: Array,
    default: () => []
  },
  target: {
    type: Object,
    default: null
  },
  ttlSeconds: {
    type: Number,
    default: 60
  },
  loading: Boolean,
  error: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['arm', 'cancel'])
const dialog = ref(null)
const cancelButton = ref(null)

watch(
  () => props.show,
  async (show) => {
    if (show) {
      document.addEventListener('keydown', handleKeydown)
      await nextTick()
      cancelButton.value?.focus()
    } else {
      document.removeEventListener('keydown', handleKeydown)
    }
  },
  { immediate: true }
)

onBeforeUnmount(() => document.removeEventListener('keydown', handleKeydown))

function handleKeydown(event) {
  if (event.key === 'Escape' && !props.loading) {
    emit('cancel')
    return
  }
  if (event.key !== 'Tab' || !dialog.value) return

  const focusable = [
    ...dialog.value.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled])'
    )
  ]
  if (focusable.length === 0) return
  const first = focusable[0]
  const last = focusable.at(-1)
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-150 ease-out motion-reduce:transition-none"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-100 ease-in motion-reduce:transition-none"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="show"
        class="fixed inset-0 z-50 flex items-center justify-center p-4"
      >
        <button
          type="button"
          aria-label="Close production write warning"
          class="bg-black/45 absolute inset-0 cursor-default"
          :disabled="loading"
          @click="emit('cancel')"
        />

        <section
          ref="dialog"
          data-test="helm-write-guard"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="helm-write-guard-title"
          aria-describedby="helm-write-guard-description"
          class="relative w-full max-w-md rounded-xl bg-white p-5 shadow-2xl ring-1 ring-black/10 dark:bg-gray-900 dark:ring-white/10"
        >
          <div class="flex items-start gap-3">
            <span
              class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-400"
              aria-hidden="true"
            >
              <svg
                class="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="1.8"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M12 9v4m0 3.25h.01M10.3 4.55 2.9 17.4a2 2 0 0 0 1.73 3h14.74a2 2 0 0 0 1.73-3L13.7 4.55a1.96 1.96 0 0 0-3.4 0Z"
                />
              </svg>
            </span>
            <div class="min-w-0 flex-1">
              <h2
                id="helm-write-guard-title"
                class="text-base font-semibold text-gray-950 dark:text-white"
              >
                Arm production writes?
              </h2>
              <p
                id="helm-write-guard-description"
                class="mt-1 text-sm leading-5 text-gray-500 dark:text-gray-400"
              >
                Helm found an obvious side effect in code targeting
                <span class="font-medium text-gray-700 dark:text-gray-200">{{
                  target?.app?.name || 'this app'
                }}</span
                >.
              </p>
            </div>
          </div>

          <ul
            v-if="findings.length"
            class="mt-4 space-y-1.5 rounded-lg bg-gray-50 px-3 py-2.5 dark:bg-gray-950/70"
          >
            <li
              v-for="(finding, index) in findings"
              :key="`${finding.kind}-${finding.line}-${index}`"
              class="flex items-baseline justify-between gap-3 text-xs"
            >
              <span class="text-gray-700 dark:text-gray-300">{{
                finding.label
              }}</span>
              <code
                class="shrink-0 text-[11px] text-gray-400 dark:text-gray-600"
                >line {{ finding.line }}</code
              >
            </li>
          </ul>

          <p class="mt-3 text-xs leading-5 text-gray-500 dark:text-gray-400">
            Arming lasts {{ ttlSeconds }} seconds, applies only to this exact
            source and deployment, and is consumed after one attempt. Detection
            is a safety heuristic—not a security sandbox.
          </p>

          <p
            v-if="error"
            data-test="helm-write-guard-error"
            role="alert"
            class="mt-3 text-xs text-red-600 dark:text-red-400"
          >
            {{ error }}
          </p>

          <div class="mt-5 flex items-center justify-end gap-2">
            <button
              ref="cancelButton"
              type="button"
              :disabled="loading"
              class="rounded-md px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white"
              @click="emit('cancel')"
            >
              Cancel
            </button>
            <button
              type="button"
              data-test="helm-arm-writes"
              :disabled="loading"
              class="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-wait disabled:opacity-60 dark:bg-red-600 dark:hover:bg-red-500"
              @click="emit('arm')"
            >
              <span v-if="loading" class="flex items-center gap-2">
                <Spinner class="h-3.5 w-3.5" />
                Arming
              </span>
              <span v-else>Arm writes for {{ ttlSeconds }}s</span>
            </button>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>
