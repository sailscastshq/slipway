<script setup>
import Input from '@/components/ui/input/Input.vue'
import Radio from '@/components/ui/radio/Radio.vue'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import CodeEditor from '@/components/CodeEditor.vue'
import Spinner from '@/components/SlipwaySpinner.vue'

const props = defineProps({
  show: Boolean,
  snippet: {
    type: Object,
    default: null
  },
  loading: Boolean,
  error: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['cancel', 'save'])
const dialogRoot = ref(null)
const nameInput = ref(null)
const name = ref('')
const source = ref('')
const scope = ref('personal')

const editing = computed(() => Boolean(props.snippet?.id))
const canSave = computed(
  () =>
    !props.loading && Boolean(name.value.trim()) && Boolean(source.value.trim())
)
let previouslyFocused
let previousBodyOverflow = ''

watch(
  () => [props.show, props.snippet],
  async ([show]) => {
    if (!show) {
      document.body.style.overflow = previousBodyOverflow
      previouslyFocused?.focus?.()
      previouslyFocused = null
      return
    }
    previouslyFocused = document.activeElement
    previousBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    name.value = props.snippet?.name || ''
    source.value = props.snippet?.source || ''
    scope.value = props.snippet?.scope || 'personal'
    await nextTick()
    nameInput.value?.focus()
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  document.body.style.overflow = previousBodyOverflow
})

function close() {
  if (!props.loading) emit('cancel')
}

function submit() {
  if (!canSave.value) return
  emit('save', {
    name: name.value.trim(),
    source: source.value,
    scope: scope.value
  })
}

function handleKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
    return
  }

  if (event.key === 'Tab') {
    const focusable = Array.from(
      dialogRoot.value?.querySelectorAll(
        'button:not(:disabled), input:not(:disabled), [contenteditable="true"], [tabindex]:not([tabindex="-1"])'
      ) || []
    )
    if (focusable.length === 0) return

    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-100 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="show"
        class="fixed inset-0 isolate z-[60] flex items-center justify-center p-4"
        @keydown="handleKeydown"
      >
        <div class="fixed inset-0 z-0 bg-black/50" @click="close" />
        <form
          ref="dialogRoot"
          data-test="helm-snippet-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="helm-snippet-dialog-title"
          class="relative z-10 flex max-h-[calc(100vh-2rem)] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900"
          @submit.prevent="submit"
        >
          <div class="px-5 pb-4 pt-5">
            <div class="flex items-start justify-between gap-4">
              <div>
                <h2
                  id="helm-snippet-dialog-title"
                  class="text-base font-semibold text-gray-900 dark:text-white"
                >
                  {{ editing ? 'Edit snippet' : 'Save snippet' }}
                </h2>
                <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  Snippets are inserted into Helm without running.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close"
                class="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-200 dark:focus-visible:ring-gray-700"
                @click="close"
              >
                <svg
                  class="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M6 18 18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <div class="mt-5 space-y-5">
              <label class="block">
                <span
                  class="text-sm font-medium text-gray-700 dark:text-gray-300"
                  >Name</span
                >
                <Input
                  ref="nameInput"
                  v-model="name"
                  data-test="helm-snippet-name"
                  type="text"
                  maxlength="100"
                  autocomplete="off"
                  placeholder="Active creators"
                  class="mt-2 block w-full border-0 border-b border-gray-200 bg-transparent px-0 py-2 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-gray-900 focus:ring-0 dark:border-gray-700 dark:text-white dark:placeholder:text-gray-600 dark:focus:border-gray-300"
                />
              </label>

              <fieldset>
                <legend
                  class="text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  Visibility
                </legend>
                <div class="mt-2 grid grid-cols-2 gap-2">
                  <label
                    v-for="option in [
                      {
                        value: 'personal',
                        label: 'Personal',
                        hint: 'Only you'
                      },
                      {
                        value: 'project',
                        label: 'Project',
                        hint: 'Everyone on this project'
                      }
                    ]"
                    :key="option.value"
                    :class="[
                      'cursor-pointer rounded-lg border px-3 py-2.5 transition-colors',
                      scope === option.value
                        ? 'border-gray-900 bg-gray-50 dark:border-gray-300 dark:bg-gray-800'
                        : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600'
                    ]"
                  >
                    <Radio
                      v-model="scope"
                      name="snippet-scope"
                      :value="option.value"
                      class="sr-only"
                    />
                    <span
                      class="block text-sm font-medium text-gray-900 dark:text-white"
                      >{{ option.label }}</span
                    >
                    <span
                      class="mt-0.5 block text-xs text-gray-500 dark:text-gray-400"
                      >{{ option.hint }}</span
                    >
                  </label>
                </div>
              </fieldset>

              <div>
                <p class="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Source
                </p>
                <div
                  class="mt-2 overflow-hidden rounded-lg border border-gray-200 bg-white focus-within:border-gray-400 dark:border-gray-700 dark:bg-gray-950 dark:focus-within:border-gray-500"
                >
                  <CodeEditor
                    v-model="source"
                    language="javascript"
                    aria-label="Snippet source"
                    test-id="helm-snippet-source"
                    min-height="8rem"
                    max-height="14rem"
                    padding="compact"
                  />
                </div>
              </div>

              <p
                v-if="error"
                data-test="helm-snippet-error"
                role="alert"
                class="text-sm text-red-600 dark:text-red-400"
              >
                {{ error }}
              </p>
            </div>
          </div>

          <div
            class="flex shrink-0 justify-end gap-3 border-t border-gray-100 px-5 py-4 dark:border-gray-800"
          >
            <button
              type="button"
              :disabled="loading"
              class="rounded-md px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
              @click="close"
            >
              Cancel
            </button>
            <button
              data-test="helm-snippet-save"
              type="submit"
              :disabled="!canSave"
              class="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
            >
              <span v-if="loading" class="flex items-center gap-2">
                <Spinner class="h-3.5 w-3.5" />
                Saving
              </span>
              <span v-else>{{
                editing ? 'Save changes' : 'Save snippet'
              }}</span>
            </button>
          </div>
        </form>
      </div>
    </Transition>
  </Teleport>
</template>
