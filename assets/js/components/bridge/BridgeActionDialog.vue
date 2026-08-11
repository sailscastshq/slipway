<script setup>
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useForm } from '@inertiajs/vue3'
import BridgeFieldInput from '@/components/bridge/BridgeFieldInput.vue'
import { Spinner } from '@/components/ui/spinner'
import {
  prepareBridgeFieldSubmission,
  toBridgeFieldInputValue,
  validateBridgeFieldValue
} from '@/lib/bridge/fields.mjs'
import { containsRawHtml } from '@/lib/content/markdown.mjs'

const props = defineProps({
  show: Boolean,
  action: {
    type: Object,
    default: null
  },
  submitUrl: {
    type: String,
    required: true
  },
  modelIdentity: {
    type: String,
    required: true
  },
  recordId: {
    type: [String, Number],
    default: null
  },
  recordIds: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['cancel', 'complete'])
const dialog = ref(null)
const formValues = ref({})
const localErrors = ref({})
const returnFocus = ref(null)
const form = useForm({})
let bodyOverflow = ''
let scrollLocked = false

const fields = computed(() =>
  Object.entries(props.action?.fields || {}).map(([name, attr]) => ({
    name,
    attr,
    readOnly: false
  }))
)
const titleId = computed(
  () => `bridge-action-${props.action?.name || 'dialog'}-title`
)
const selectionLabel = computed(() => {
  if (props.action?.scope !== 'bulk') return ''
  return `${props.recordIds.length.toLocaleString()} ${
    props.recordIds.length === 1 ? 'record' : 'records'
  } selected`
})
const isFormReady = computed(
  () =>
    fields.value.every(
      (field) => validateField(field) === '' && !form.errors[field.name]
    ) && Object.keys(localErrors.value).length === 0
)

watch(
  () => [props.show, props.action],
  async ([shown]) => {
    if (!shown || !props.action) {
      unlockPageScroll()
      return
    }
    lockPageScroll()
    returnFocus.value = document.activeElement
    form.clearErrors()
    localErrors.value = {}
    formValues.value = Object.fromEntries(
      fields.value.map((field) => [
        field.name,
        toBridgeFieldInputValue(field.attr, undefined)
      ])
    )
    await nextTick()
    const firstInput = dialog.value?.querySelector(
      'input:not([type="hidden"]), textarea, select, button[role="switch"], [contenteditable="true"]'
    )
    const focusTarget = firstInput || dialog.value
    focusTarget?.focus()
  }
)

onUnmounted(unlockPageScroll)

function lockPageScroll() {
  if (scrollLocked) return
  bodyOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  scrollLocked = true
}

function unlockPageScroll() {
  if (!scrollLocked) return
  document.body.style.overflow = bodyOverflow
  scrollLocked = false
}

function validateField(field) {
  if (
    field.attr.field?.type === 'richtext' &&
    field.attr.field?.format?.toLowerCase() === 'markdown' &&
    containsRawHtml(String(formValues.value[field.name] || ''))
  ) {
    return 'Raw HTML is not allowed in Bridge Markdown fields.'
  }
  return validateBridgeFieldValue({
    attribute: field.attr,
    value: formValues.value[field.name]
  })
}

function validateAndRemember(field) {
  const error = validateField(field)
  if (error) localErrors.value[field.name] = error
  else delete localErrors.value[field.name]
}

function updateField(field, value) {
  formValues.value[field.name] = value
  if (localErrors.value[field.name]) validateAndRemember(field)
  if (form.errors[field.name]) form.clearErrors(field.name)
}

function clearFieldError(field) {
  delete localErrors.value[field.name]
  form.clearErrors(field.name)
}

function cancel() {
  if (form.processing) return
  emit('cancel')
  nextTick(() => returnFocus.value?.focus?.())
}

function submit() {
  for (const field of fields.value) validateAndRemember(field)
  if (!isFormReady.value || form.processing) return

  const values = {}
  for (const field of fields.value) {
    const prepared = prepareBridgeFieldSubmission({
      attribute: field.attr,
      value: formValues.value[field.name]
    })
    if (prepared.include) values[field.name] = prepared.value
  }

  form
    .transform(() => ({
      values,
      ...(props.action.scope === 'record' ? { recordId: props.recordId } : {}),
      ...(props.action.scope === 'bulk' ? { recordIds: props.recordIds } : {})
    }))
    .post(props.submitUrl, {
      preserveScroll: true,
      onSuccess: () => {
        emit('complete')
        nextTick(() => returnFocus.value?.focus?.())
      }
    })
}

function handleKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    cancel()
    return
  }
  if (event.key !== 'Tab') return

  const focusable = Array.from(
    dialog.value?.querySelectorAll(
      'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'
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
      <div
        v-if="show && action"
        class="fixed inset-0 z-50 flex items-center justify-center p-4"
      >
        <button
          type="button"
          class="fixed inset-0 cursor-default bg-black/50"
          tabindex="-1"
          aria-label="Close action dialog"
          @click="cancel"
        />
        <Transition
          enter-active-class="transition duration-200 ease-out"
          enter-from-class="scale-95 opacity-0"
          enter-to-class="scale-100 opacity-100"
          leave-active-class="transition duration-150 ease-in"
          leave-from-class="scale-100 opacity-100"
          leave-to-class="scale-95 opacity-0"
        >
          <form
            ref="dialog"
            role="dialog"
            aria-modal="true"
            :aria-labelledby="titleId"
            :data-test="`bridge-action-dialog-${action.name}`"
            class="relative flex max-h-[min(44rem,calc(100vh-2rem))] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900"
            tabindex="-1"
            @submit.prevent="submit"
            @keydown="handleKeydown"
          >
            <div class="overflow-y-auto px-6 pb-2 pt-6">
              <h2
                :id="titleId"
                class="text-lg font-semibold text-gray-900 dark:text-white"
              >
                {{ action.label }}
              </h2>
              <p
                v-if="action.description"
                class="mt-1.5 text-sm leading-6 text-gray-500 dark:text-gray-400"
              >
                {{ action.description }}
              </p>
              <p
                v-if="selectionLabel"
                class="mt-2 text-xs font-medium text-gray-400 dark:text-gray-500"
              >
                {{ selectionLabel }}
              </p>
              <p
                v-if="action.confirm"
                class="mt-4 text-sm leading-6 text-gray-600 dark:text-gray-300"
              >
                {{ action.confirm }}
              </p>

              <div v-if="fields.length > 0" class="mt-5 space-y-5 pb-3">
                <BridgeFieldInput
                  v-for="field in fields"
                  :key="field.name"
                  :field="field"
                  :model-value="formValues[field.name]"
                  :error="
                    localErrors[field.name] || form.errors[field.name] || ''
                  "
                  :model-identity="`${modelIdentity}-${action.name}`"
                  @update:model-value="updateField(field, $event)"
                  @blur="validateAndRemember(field)"
                  @clear-error="clearFieldError(field)"
                />
              </div>
              <p
                v-if="form.errors.error"
                role="alert"
                class="mt-4 text-sm text-red-600 dark:text-red-400"
              >
                {{ form.errors.error }}
              </p>
            </div>

            <div class="flex justify-end gap-3 px-6 pb-6 pt-4">
              <button
                type="button"
                :disabled="form.processing"
                class="rounded-md px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50 dark:text-gray-400 dark:hover:text-white"
                @click="cancel"
              >
                Cancel
              </button>
              <button
                type="submit"
                :disabled="form.processing || !isFormReady"
                :class="[
                  'rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40',
                  action.destructive
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-gray-900 hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100'
                ]"
              >
                <span v-if="form.processing" class="flex items-center gap-2">
                  <Spinner class="h-4 w-4" />
                  Running…
                </span>
                <span v-else>{{ action.label }}</span>
              </button>
            </div>
          </form>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>
