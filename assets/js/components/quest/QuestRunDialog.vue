<script setup>
import { computed, ref, watch } from 'vue'
import Dialog from '@/components/ui/dialog/Dialog.vue'
import Button from '@/components/ui/button/Button.vue'
import Input from '@/components/ui/input/Input.vue'
import Textarea from '@/components/ui/textarea/Textarea.vue'
import Select from '@/components/ui/select/Select.vue'
import Checkbox from '@/components/ui/checkbox/Checkbox.vue'
import Spinner from '@/components/SlipwaySpinner.vue'
import X from '@/components/ui/icons/X.vue'
import Play from '@/components/ui/icons/Play.vue'
import {
  createQuestInputDraft,
  questInputHasSourceValue,
  validateQuestInputs,
  requestQuestInvocation
} from './questInvocation.mjs'
import { questInputType, questSnapshotIsFresh } from '@/lib/questWorkspace.mjs'

const props = defineProps({
  open: Boolean,
  review: Object,
  workspace: Object,
  stale: Boolean,
  apiUrl: String,
  csrf: String
})
const emit = defineEmits(['update:open', 'accepted'])
const draft = ref({})
const attempted = ref(false)
const submitting = ref(false)
const response = ref(null)
const requestId = ref('')
const productionConfirmed = ref(false)
const expired = ref(false)
const inputs = computed(() => props.review?.job?.inputs || [])
const validation = computed(() =>
  validateQuestInputs(
    inputs.value,
    draft.value,
    props.review?.job?.scheduledInputs
  )
)
const usesSourceValue = (input) =>
  questInputHasSourceValue(input, props.review?.job?.scheduledInputs)
const fieldClass =
  'focus:border-brand min-h-10 w-full rounded-none border-0 border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none disabled:opacity-50 dark:border-gray-700 dark:text-white dark:placeholder-gray-500'

watch(
  () => props.open,
  (open) => {
    if (!open) {
      draft.value = {}
      return
    }
    draft.value = createQuestInputDraft(
      inputs.value,
      props.review?.inputs,
      props.review?.job?.scheduledInputs
    )
    attempted.value = false
    productionConfirmed.value = false
    expired.value = false
    response.value = null
    requestId.value = crypto.randomUUID()
  },
  { immediate: true }
)

function choices(input) {
  if (Array.isArray(input.isIn))
    return input.isIn.map((value) => ({
      label: typeof value === 'string' ? value : JSON.stringify(value),
      value: ['json', 'ref', 'array', 'object'].includes(questInputType(input))
        ? JSON.stringify(value, null, 2)
        : value
    }))
  return [
    { label: 'True', value: true },
    { label: 'False', value: false }
  ]
}

async function submit() {
  if (!questSnapshotIsFresh(props.workspace)) {
    expired.value = true
    return
  }
  attempted.value = true
  if (
    !validation.value.valid ||
    submitting.value ||
    props.stale ||
    expired.value ||
    response.value?.state === 'unconfirmed' ||
    (props.review?.target.isProduction && !productionConfirmed.value)
  )
    return
  submitting.value = true
  const job = props.review.job
  response.value = await requestQuestInvocation(
    `${props.apiUrl}/jobs/${encodeURIComponent(job.name)}/run`,
    {
      jobInputs: validation.value.values,
      metadataVersion: job.metadataVersion,
      runtimeId: props.review.target.runtimeId,
      requestId: requestId.value,
      productionConfirmed: productionConfirmed.value,
      ...(props.review.priorRunId
        ? { priorRunId: props.review.priorRunId }
        : {})
    },
    props.csrf
  )
  submitting.value = false
  // A confirmed rejection may be corrected and deliberately submitted again.
  // Keep the original key for uncertain outcomes; those must be reconciled.
  if (response.value.state === 'request_failed')
    requestId.value = crypto.randomUUID()
  if (response.value.state === 'accepted') {
    emit('accepted', response.value.run)
    emit('update:open', false)
  }
}
</script>

<template>
  <Dialog
    :open="open"
    :dismissible="!submitting"
    aria-labelledby="quest-run-title"
    class="max-h-[90dvh] overflow-hidden p-0"
    @update:open="emit('update:open', $event)"
  >
    <form
      v-if="open && review"
      data-test="quest-run-form"
      class="flex max-h-[calc(90dvh-2px)] min-h-0 flex-col"
      novalidate
      @submit.prevent="submit"
    >
      <div
        class="flex shrink-0 items-start justify-between gap-4 border-b border-gray-200 px-5 py-4 dark:border-gray-800"
      >
        <div class="min-w-0">
          <h2 id="quest-run-title" class="font-semibold">
            Run {{ review.job.friendlyName || review.job.name }}
          </h2>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {{ review.target.appName }} <span aria-hidden="true">/</span>
            {{ review.target.environmentName }}
          </p>
        </div>
        <button
          type="button"
          aria-label="Close run dialog"
          :disabled="submitting"
          class="rounded p-1 text-gray-400 hover:text-gray-900 disabled:opacity-40 dark:hover:text-white"
          @click="emit('update:open', false)"
        >
          <X class="h-4 w-4" />
        </button>
      </div>
      <div
        data-test="quest-run-fields"
        class="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-5"
      >
        <p
          v-if="review.job.description"
          class="text-sm text-gray-500 dark:text-gray-400"
        >
          {{ review.job.description }}
        </p>
        <div
          v-if="stale || expired"
          role="alert"
          class="rounded-md bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
        >
          The job or runtime changed. Close this dialog and review the current
          inputs before running.
        </div>
        <p
          v-if="!inputs.length"
          class="text-sm text-gray-500 dark:text-gray-400"
        >
          This job takes no inputs.
        </p>
        <div
          v-for="(input, index) in inputs"
          :key="input.name"
          class="space-y-1.5"
        >
          <div class="flex flex-wrap items-center justify-between gap-2">
            <label :for="`quest-input-${index}`" class="text-sm font-medium"
              >{{ input.friendlyName || input.name }}
              <span v-if="input.required" class="text-red-500">*</span></label
            >
            <label
              v-if="!input.required || usesSourceValue(input)"
              class="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400"
              ><Checkbox
                v-model="draft[input.name].included"
                class="accent-brand text-brand focus:ring-brand h-4 w-4 rounded border-gray-300 dark:border-gray-600 dark:bg-gray-900"
                :disabled="submitting"
              />
              {{ usesSourceValue(input) ? 'Override' : 'Include' }}</label
            >
            <span v-else class="text-xs text-gray-400">{{
              questInputType(input)
            }}</span>
          </div>
          <template v-if="draft[input.name]?.included">
            <label
              v-if="
                input.allowNull === true &&
                ['string', 'number', 'boolean'].includes(questInputType(input))
              "
              class="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400"
            >
              <Checkbox
                v-model="draft[input.name].useNull"
                :disabled="submitting"
                class="accent-brand text-brand focus:ring-brand h-4 w-4 rounded border-gray-300 dark:border-gray-600 dark:bg-gray-900"
              />
              Use null
            </label>
            <Select
              v-if="
                !input.sensitive &&
                (input.isIn?.length || questInputType(input) === 'boolean')
              "
              :id="`quest-input-${index}`"
              v-model="draft[input.name].raw"
              :options="choices(input)"
              placeholder="Choose a value"
              :class="fieldClass"
              :disabled="submitting || draft[input.name].useNull"
              :aria-invalid="attempted && !!validation.errors[input.name]"
              :aria-describedby="`quest-input-help-${index}`"
            />
            <Textarea
              v-else-if="
                !input.sensitive &&
                ['json', 'ref', 'object', 'array'].includes(
                  questInputType(input)
                )
              "
              :id="`quest-input-${index}`"
              v-model="draft[input.name].raw"
              :class="[fieldClass, 'font-mono text-xs']"
              rows="4"
              spellcheck="false"
              :disabled="submitting || draft[input.name].useNull"
              :aria-invalid="attempted && !!validation.errors[input.name]"
              :aria-describedby="`quest-input-help-${index}`"
            />
            <Input
              v-else
              :id="`quest-input-${index}`"
              v-model="draft[input.name].raw"
              :type="
                input.sensitive
                  ? 'password'
                  : questInputType(input) === 'number'
                  ? 'number'
                  : 'text'
              "
              :class="fieldClass"
              :disabled="submitting || draft[input.name].useNull"
              :autocomplete="input.sensitive ? 'new-password' : 'off'"
              :step="
                questInputType(input) === 'number'
                  ? input.isInteger
                    ? '1'
                    : 'any'
                  : undefined
              "
              :aria-invalid="attempted && !!validation.errors[input.name]"
              :aria-describedby="`quest-input-help-${index}`"
            />
          </template>
          <div :id="`quest-input-help-${index}`" class="space-y-1 text-xs">
            <p
              v-if="usesSourceValue(input) && !draft[input.name]?.included"
              class="text-gray-500 dark:text-gray-400"
            >
              Uses the app’s source value.
            </p>
            <p
              v-if="attempted && validation.errors[input.name]"
              class="text-red-600 dark:text-red-400"
            >
              {{ validation.errors[input.name] }}
            </p>
            <p
              v-else-if="input.description"
              class="text-gray-500 dark:text-gray-400"
            >
              {{ input.description }}
            </p>
            <p
              v-if="input.sensitive && draft[input.name]?.included"
              class="text-gray-500 dark:text-gray-400"
            >
              Sensitive input. Enter it again for each run.
            </p>
            <p
              v-if="input.serverValidated"
              class="text-gray-500 dark:text-gray-400"
            >
              Additional validation runs on the server.
            </p>
          </div>
        </div>
        <label
          v-if="review.target.isProduction"
          class="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300"
        >
          <Checkbox
            v-model="productionConfirmed"
            data-test="quest-production-confirm"
            class="accent-brand text-brand focus:ring-brand mt-0.5 h-4 w-4 rounded border-gray-300 dark:border-gray-600 dark:bg-gray-900"
            :disabled="submitting"
          />
          <span>I understand this runs against production</span>
        </label>
        <div
          v-if="response?.error"
          role="alert"
          data-test="quest-run-request-error"
          class="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300"
        >
          {{ response.error }}
        </div>
      </div>
      <div
        class="flex shrink-0 items-center justify-end gap-2 border-t border-gray-200 px-5 py-4 dark:border-gray-800"
      >
        <Button
          :disabled="submitting"
          class="min-h-9 bg-transparent px-3 text-gray-600 hover:bg-gray-100 dark:bg-transparent dark:text-gray-300 dark:hover:bg-gray-800"
          @click="emit('update:open', false)"
          >{{
            response?.state === 'unconfirmed'
              ? 'Close and check Runs'
              : 'Cancel'
          }}</Button
        >
        <Button
          type="submit"
          :disabled="
            submitting ||
            stale ||
            expired ||
            response?.state === 'unconfirmed' ||
            (review.target.isProduction && !productionConfirmed)
          "
          class="min-h-9 px-3"
          data-test="quest-confirm-run"
          ><Spinner v-if="submitting" class="h-3.5 w-3.5" /><Play
            v-else
            class="h-3.5 w-3.5"
          />{{ submitting ? 'Submitting…' : 'Run job' }}</Button
        >
      </div>
    </form>
  </Dialog>
</template>
