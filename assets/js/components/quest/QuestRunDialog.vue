<script setup>
import { computed, ref, watch } from 'vue'
import Dialog from '@/components/ui/dialog/Dialog.vue'
import Button from '@/components/ui/button/Button.vue'
import Input from '@/components/ui/input/Input.vue'
import Textarea from '@/components/ui/textarea/Textarea.vue'
import Select from '@/components/ui/select/Select.vue'
import Spinner from '@/components/SlipwaySpinner.vue'
import X from '@/components/ui/icons/X.vue'
import Play from '@/components/ui/icons/Play.vue'
import {
  createQuestInputDraft,
  validateQuestInputs,
  questInputType,
  requestQuestInvocation
} from '@/lib/questWorkspace.mjs'

const props = defineProps({
  open: Boolean,
  review: Object,
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
const inputs = computed(() => props.review?.job?.inputs || [])
const validation = computed(() =>
  validateQuestInputs(inputs.value, draft.value)
)
const fieldClass =
  'min-h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-950 dark:text-white'

watch(
  () => props.open,
  (open) => {
    if (!open) {
      draft.value = {}
      return
    }
    draft.value = createQuestInputDraft(inputs.value, props.review?.inputs)
    attempted.value = false
    productionConfirmed.value = false
    response.value = null
    requestId.value = crypto.randomUUID()
  }
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
  attempted.value = true
  if (
    !validation.value.valid ||
    submitting.value ||
    props.stale ||
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
    class="max-h-[90dvh] overflow-y-auto p-0"
    @update:open="emit('update:open', $event)"
  >
    <form
      v-if="review"
      data-test="quest-run-form"
      novalidate
      @submit.prevent="submit"
    >
      <div
        class="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4 dark:border-gray-800"
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
      <div class="space-y-5 px-5 py-5">
        <p
          v-if="review.job.description"
          class="text-sm text-gray-500 dark:text-gray-400"
        >
          {{ review.job.description }}
        </p>
        <div
          v-if="stale"
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
              v-if="!input.required"
              class="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400"
              ><input
                v-model="draft[input.name].included"
                type="checkbox"
                class="accent-gray-900 dark:accent-white"
                :disabled="submitting"
              />
              Include</label
            >
            <span v-else class="text-xs text-gray-400">{{
              questInputType(input)
            }}</span>
          </div>
          <template v-if="draft[input.name]?.included">
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
              :disabled="submitting"
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
              :disabled="submitting"
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
              :disabled="submitting"
              :autocomplete="input.sensitive ? 'new-password' : 'off'"
              :step="questInputType(input) === 'number' ? 'any' : undefined"
              :aria-invalid="attempted && !!validation.errors[input.name]"
              :aria-describedby="`quest-input-help-${index}`"
            />
          </template>
          <div :id="`quest-input-help-${index}`" class="space-y-1 text-xs">
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
            <p v-if="input.sensitive" class="text-gray-500 dark:text-gray-400">
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
          <input
            v-model="productionConfirmed"
            data-test="quest-production-confirm"
            type="checkbox"
            class="mt-1 accent-amber-700"
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
        class="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-4 dark:border-gray-800"
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
