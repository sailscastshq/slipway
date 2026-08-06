<script setup>
import { router } from '@inertiajs/vue3'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import MarkdownEditor from '@/components/content/MarkdownEditor.vue'
import BridgeRelationshipSelect from '@/components/bridge/BridgeRelationshipSelect.vue'
import {
  bridgeFieldType,
  bridgeSelectOptions,
  formatBridgeBytes,
  safeBridgeHttpUrl
} from '@/lib/bridge/fields.mjs'
import { containsRawHtml } from '@/lib/content/markdown.mjs'
import { resolveBridgeFieldComponent } from '@/lib/bridge/field-components.mjs'
import {
  fileFingerprint,
  uploadMultipartParts
} from '@/lib/bridge/resilient-upload.mjs'

const props = defineProps({
  field: {
    type: Object,
    required: true
  },
  modelValue: {
    default: null
  },
  error: {
    type: String,
    default: ''
  },
  isEdit: Boolean,
  modelIdentity: {
    type: String,
    required: true
  },
  recordId: {
    type: [String, Number],
    default: null
  },
  associationOptions: {
    type: Array,
    default: () => []
  },
  associationSearchUrl: {
    type: String,
    default: ''
  },
  associationDisabledReason: {
    type: String,
    default: ''
  },
  associationSearchPlaceholder: {
    type: String,
    default: ''
  },
  associationEmptyText: {
    type: String,
    default: ''
  },
  resourceRelationships: {
    type: Object,
    default: () => ({})
  },
  uploadUrl: {
    type: String,
    default: ''
  },
  uploadValues: {
    type: Object,
    default: () => ({})
  }
})

const emit = defineEmits(['update:modelValue', 'blur', 'clear-error'])

const fileInput = ref(null)
const uploading = ref(false)
const uploadError = ref('')
const uploadPhase = ref('')
const uploadedBytes = ref(0)
const totalUploadBytes = ref(0)
const uploadAbortController = ref(null)
const pendingUploadFile = ref(null)
const uploadSession = ref(null)
const richTextEditor = ref(null)
const richTextMode = ref('visual')
const richTextCompatibility = ref({ supported: true })

const attribute = computed(() => props.field.attr)
const type = computed(() => bridgeFieldType(attribute.value))
const label = computed(() => attribute.value.label || props.field.name)
const description = computed(
  () => attribute.value.field?.help || attribute.value.description || ''
)
const placeholder = computed(
  () => attribute.value.field?.placeholder || defaultPlaceholder(type.value)
)
const options = computed(() => bridgeSelectOptions(attribute.value))
const fieldId = computed(() =>
  `bridge-${props.modelIdentity}-${props.field.name}`.replace(
    /[^A-Za-z0-9_-]/g,
    '-'
  )
)
const errorId = computed(() => `${fieldId.value}-error`)
const helpId = computed(() => `${fieldId.value}-help`)
const describedBy = computed(
  () =>
    [
      description.value ? helpId.value : null,
      visibleError.value ? errorId.value : null
    ]
      .filter(Boolean)
      .join(' ') || undefined
)
const richTextSecurityError = computed(() => {
  if (
    type.value !== 'richtext' ||
    attribute.value.field?.format?.toLowerCase() !== 'markdown'
  ) {
    return ''
  }
  return containsRawHtml(String(props.modelValue || ''))
    ? 'Raw HTML is not allowed in Bridge Markdown fields.'
    : ''
})
const visibleError = computed(
  () => uploadError.value || richTextSecurityError.value || props.error
)
const customComponent = computed(() =>
  resolveBridgeFieldComponent(attribute.value.field?.component, 'form')
)
const isImageUpload = computed(
  () =>
    type.value === 'image' || attribute.value.field?.upload?.kind === 'image'
)
const uploadedValue = computed(() =>
  props.modelValue && typeof props.modelValue === 'object'
    ? props.modelValue
    : null
)
const currentUploadUrl = computed(
  () => uploadedValue.value?.url || props.modelValue || ''
)
const safeCurrentUploadUrl = computed(() =>
  safeBridgeHttpUrl(currentUploadUrl.value)
)
const accept = computed(() =>
  (attribute.value.field?.upload?.accept || []).join(',')
)
const maxBytes = computed(
  () => attribute.value.field?.upload?.maxBytes || 5 * 1024 * 1024
)
const uploadPathValues = computed(() => {
  const upload = attribute.value.field?.upload || {}
  const templates = [upload.directory, upload.filename]
    .filter(Boolean)
    .join('/')
  const roots = Array.from(
    templates.matchAll(
      /\{([A-Za-z][A-Za-z0-9]*)(?:\.[A-Za-z][A-Za-z0-9]*)?(?:\|slug)?\}/g
    ),
    (match) => match[1]
  )
  const dependencyRoots = roots.flatMap((name) =>
    Object.values(props.resourceRelationships?.[name]?.where || {})
      .map((constraint) => constraint?.fromField)
      .filter(Boolean)
  )
  return Object.fromEntries(
    Array.from(new Set([...roots, ...dependencyRoots]))
      .filter((name) =>
        Object.prototype.hasOwnProperty.call(props.uploadValues, name)
      )
      .map((name) => [name, props.uploadValues[name]])
  )
})
const richTextUploadsConfigured = computed(
  () =>
    type.value === 'richtext' &&
    attribute.value.field?.format?.toLowerCase() === 'markdown' &&
    attribute.value.field?.upload?.kind === 'image' &&
    attribute.value.field?.upload?.storage === 'bridge' &&
    Boolean(props.uploadUrl)
)
const uploadHint = computed(() => {
  const accepted = attribute.value.field?.upload?.accept || []
  const labels = accepted.map((value) => {
    if (value.endsWith('/*')) return value.slice(0, -2)
    return value.split('/').pop()?.replace('jpeg', 'jpg') || value
  })
  const types =
    labels.length === 0
      ? 'Any file type'
      : new Intl.ListFormat(undefined, {
          style: 'short',
          type: 'disjunction'
        }).format(labels.map((value) => value.toUpperCase()))
  return `${types} · ${formatBridgeBytes(maxBytes.value)} max`
})
const uploadPercent = computed(() => {
  if (!totalUploadBytes.value) return 0
  return Math.min(
    100,
    Math.round((uploadedBytes.value / totalUploadBytes.value) * 100)
  )
})
const uploadStatus = computed(() => {
  if (uploadPhase.value === 'preparing') return 'Preparing secure upload…'
  if (uploadPhase.value === 'resuming') return 'Recovering uploaded parts…'
  if (uploadPhase.value === 'verifying') return 'Verifying upload…'
  if (uploadPhase.value === 'uploading') {
    const progress = `${formatBridgeBytes(
      uploadedBytes.value
    )} of ${formatBridgeBytes(totalUploadBytes.value)}`
    return `Uploading ${uploadPercent.value}% · ${progress}`
  }
  return ''
})
const currencySymbol = computed(() => {
  const currency = attribute.value.field?.currency || {}
  try {
    return (
      new Intl.NumberFormat(currency.locale || 'en-US', {
        style: 'currency',
        currency: currency.code || 'USD',
        currencyDisplay: 'narrowSymbol'
      })
        .formatToParts(0)
        .find((part) => part.type === 'currency')?.value ||
      currency.code ||
      'USD'
    )
  } catch {
    return currency.code || 'USD'
  }
})
const inputClass =
  'focus:border-brand h-11 w-full border-b border-dashed border-gray-200 bg-transparent px-1 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus-visible:ring-0 disabled:cursor-not-allowed disabled:text-gray-400 dark:border-gray-700 dark:text-white dark:placeholder-gray-500'
const textareaClass =
  'focus:border-brand min-h-28 w-full resize-none border-b border-dashed border-gray-200 bg-transparent px-1 py-2 text-sm leading-6 text-gray-900 placeholder-gray-400 focus:outline-none focus-visible:ring-0 disabled:cursor-not-allowed disabled:text-gray-400 dark:border-gray-700 dark:text-white dark:placeholder-gray-500'

function update(value) {
  emit('update:modelValue', value)
  if (props.error) emit('clear-error')
}

function handleBlur() {
  emit('blur')
}

function toggleRichTextMode() {
  const next = richTextMode.value === 'source' ? 'visual' : 'source'
  richTextEditor.value?.setMode(next)
}

async function uploadFile(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return

  await beginUpload(file)
}

async function beginUpload(file) {
  uploadError.value = ''
  uploadSession.value = null
  if (file.size > maxBytes.value) {
    uploadError.value = `Choose a file no larger than ${formatBridgeBytes(
      maxBytes.value
    )}.`
    return
  }
  if (!props.uploadUrl) {
    uploadError.value = 'This Bridge upload field is not configured.'
    return
  }

  pendingUploadFile.value = file
  uploading.value = true
  uploadedBytes.value = 0
  totalUploadBytes.value = file.size
  uploadAbortController.value = new AbortController()
  try {
    let prepared
    let operation
    const persisted = readPersistedUpload(file)
    if (persisted) {
      uploadPhase.value = 'resuming'
      prepared = persisted
      try {
        operation = await resumeDirectUpload(prepared)
      } catch (error) {
        if (!/invalid|expired|no longer available/i.test(error.message)) {
          throw error
        }
        clearPersistedUpload()
        prepared = null
      }
    }
    if (!prepared) {
      uploadPhase.value = 'preparing'
      prepared = await prepareDirectUpload(file)
      operation = prepared
      persistUpload(prepared, file)
    }
    uploadSession.value = prepared
    if (!operation.completed) {
      uploadPhase.value = 'uploading'
      if (prepared.strategy === 'multipart') {
        await putFileMultipart(file, prepared, operation)
      } else {
        await putFileWithRetry(file, operation)
      }
    }
    uploadPhase.value = 'verifying'
    const result = await completeDirectUpload(prepared)
    rememberUpload(result, file)
    clearPersistedUpload()
    pendingUploadFile.value = null
  } catch (error) {
    if (error.code === 'UPLOAD_CANCELLED') {
      uploadError.value = 'Upload cancelled. You can retry when ready.'
    } else if (uploadSession.value?.strategy === 'multipart') {
      uploadError.value =
        'Upload paused. Retry to continue from the parts already stored.'
    } else {
      uploadError.value = error.message || 'The file could not be uploaded.'
    }
  } finally {
    uploadAbortController.value = null
    uploadPhase.value = ''
    uploading.value = false
  }
}

async function prepareDirectUpload(file) {
  const response = await fetch(`${props.uploadUrl}/prepare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      values: uploadPathValues.value,
      ...(props.isEdit && props.recordId !== null
        ? { recordId: String(props.recordId) }
        : {})
    })
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(result.message || 'The upload could not be prepared.')
  }
  if (!result.url || !result.uploadIntent) {
    throw new Error('Bridge did not return a valid direct upload operation.')
  }
  if (
    result.strategy === 'single' &&
    (!result.uploadUrl || result.method !== 'PUT')
  ) {
    throw new Error('Bridge did not return a valid direct upload operation.')
  }
  if (
    result.strategy === 'multipart' &&
    (!Number.isSafeInteger(result.partSize) || !Array.isArray(result.parts))
  ) {
    throw new Error('Bridge did not return a valid multipart upload.')
  }
  return result
}

async function resumeDirectUpload(prepared) {
  const response = await fetch(`${props.uploadUrl}/resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(uploadSessionBody(prepared))
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(result.message || 'Bridge could not resume the upload.')
  }
  return result
}

async function putFileWithRetry(file, operation) {
  let lastError
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await uploadBlob({
        blob: file,
        uploadUrl: operation.uploadUrl,
        headers: operation.headers,
        signal: uploadAbortController.value.signal,
        onProgress(loaded) {
          uploadedBytes.value = loaded
          totalUploadBytes.value = file.size
        }
      })
      uploadedBytes.value = file.size
      return
    } catch (error) {
      if (error.code === 'UPLOAD_CANCELLED') throw error
      lastError = error
      if (attempt < 2) await waitForRetry(500 * 2 ** attempt)
    }
  }
  throw lastError
}

async function putFileMultipart(file, prepared, operation) {
  await uploadMultipartParts({
    file,
    partSize: prepared.partSize,
    signedParts: operation.parts || [],
    uploadedParts: operation.uploadedParts || [],
    signal: uploadAbortController.value.signal,
    uploadPart({ blob, uploadUrl, signal, onProgress }) {
      return uploadBlob({ blob, uploadUrl, signal, onProgress })
    },
    onProgress(loaded, total) {
      uploadedBytes.value = loaded
      totalUploadBytes.value = total
    }
  })
}

function uploadBlob({ blob, uploadUrl, headers = {}, signal, onProgress }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const error = new Error('Upload cancelled.')
      error.code = 'UPLOAD_CANCELLED'
      reject(error)
      return
    }
    const request = new XMLHttpRequest()
    let settled = false
    let stalled = false
    let lastProgressAt = Date.now()

    request.open('PUT', uploadUrl)
    for (const [name, value] of Object.entries(headers || {})) {
      request.setRequestHeader(name, value)
    }
    request.upload.addEventListener('progress', (event) => {
      lastProgressAt = Date.now()
      onProgress(event.loaded, event.total || blob.size)
    })
    request.addEventListener('load', () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(blob.size, blob.size)
        finish(resolve)
        return
      }
      finish(
        reject,
        new Error(
          request.status === 403
            ? 'Object storage rejected the upload. Check the bucket CORS policy and retry.'
            : `Object storage rejected the upload (${request.status}).`
        )
      )
    })
    request.addEventListener('error', () => {
      finish(
        reject,
        new Error(
          'The browser could not reach object storage. Check the bucket CORS policy and your connection.'
        )
      )
    })
    request.addEventListener('abort', () => {
      const error = new Error(
        stalled
          ? 'The upload stalled before this part completed.'
          : 'Upload cancelled.'
      )
      error.code = stalled ? 'UPLOAD_STALLED' : 'UPLOAD_CANCELLED'
      finish(reject, error)
    })
    const onAbort = () => request.abort()
    signal?.addEventListener('abort', onAbort, { once: true })
    const stallTimer = window.setInterval(() => {
      if (Date.now() - lastProgressAt < 45_000) return
      stalled = true
      request.abort()
    }, 5000)

    function finish(callback, value) {
      if (settled) return
      settled = true
      window.clearInterval(stallTimer)
      signal?.removeEventListener('abort', onAbort)
      callback(value)
    }

    request.send(blob)
  })
}

async function completeDirectUpload(prepared) {
  const response = await fetch(`${props.uploadUrl}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(uploadSessionBody(prepared))
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(result.message || 'Bridge could not verify the upload.')
  }
  if (!result.url || !result.receipt) {
    throw new Error('The upload did not return a verifiable file URL.')
  }
  return result
}

function rememberUpload(result, file) {
  update({
    url: result.url,
    receipt: result.receipt,
    file: {
      name: file.name,
      size: file.size,
      type: file.type,
      ...(result.file || {})
    }
  })
}

async function cancelUpload() {
  const prepared = uploadSession.value
  uploadAbortController.value?.abort()
  clearPersistedUpload()
  if (!prepared?.uploadIntent) return
  await fetch(`${props.uploadUrl}/abort`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(uploadSessionBody(prepared))
  }).catch(() => {})
}

function retryUpload() {
  if (pendingUploadFile.value && !uploading.value) {
    void beginUpload(pendingUploadFile.value)
  }
}

function uploadSessionBody(prepared) {
  return {
    uploadIntent: prepared.uploadIntent,
    ...(props.isEdit && props.recordId !== null
      ? { recordId: String(props.recordId) }
      : {})
  }
}

function persistUpload(prepared, file) {
  if (prepared.strategy !== 'multipart') return
  try {
    localStorage.setItem(
      persistedUploadKey(),
      JSON.stringify({
        version: 1,
        fingerprint: fileFingerprint(file),
        savedAt: Date.now(),
        session: {
          strategy: prepared.strategy,
          url: prepared.url,
          uploadIntent: prepared.uploadIntent,
          partSize: prepared.partSize,
          partCount: prepared.partCount
        }
      })
    )
  } catch {
    // Resuming in the current page still works when browser storage is blocked.
  }
}

function readPersistedUpload(file) {
  try {
    const stored = JSON.parse(localStorage.getItem(persistedUploadKey()))
    if (
      stored?.version !== 1 ||
      stored.fingerprint !== fileFingerprint(file) ||
      stored.session?.strategy !== 'multipart'
    ) {
      return null
    }
    return stored.session
  } catch {
    return null
  }
}

function clearPersistedUpload() {
  try {
    localStorage.removeItem(persistedUploadKey())
  } catch {
    // Nothing else is required when browser storage is unavailable.
  }
}

function persistedUploadKey() {
  return `bridge-upload:${props.uploadUrl}`
}

function waitForRetry(milliseconds) {
  return new Promise((resolve, reject) => {
    const signal = uploadAbortController.value?.signal
    const finish = (callback, value) => {
      signal?.removeEventListener('abort', onAbort)
      callback(value)
    }
    const timeout = window.setTimeout(() => finish(resolve), milliseconds)
    const onAbort = () => {
      window.clearTimeout(timeout)
      const error = new Error('Upload cancelled.')
      error.code = 'UPLOAD_CANCELLED'
      finish(reject, error)
    }
    if (signal?.aborted) {
      onAbort()
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function guardBrowserNavigation(event) {
  if (!uploading.value) return
  event.preventDefault()
  event.returnValue = ''
}

let removeInertiaGuard
onMounted(() => {
  window.addEventListener('beforeunload', guardBrowserNavigation)
  removeInertiaGuard = router.on('before', (event) => {
    if (
      uploading.value &&
      !window.confirm(
        'An upload is still in progress. Leave now and resume it after selecting the same file again?'
      )
    ) {
      event.preventDefault()
    }
  })
})

onBeforeUnmount(() => {
  uploadAbortController.value?.abort()
  window.removeEventListener('beforeunload', guardBrowserNavigation)
  removeInertiaGuard?.()
})

function defaultPlaceholder(fieldType) {
  if (fieldType === 'email') return 'name@example.com'
  if (fieldType === 'url') return 'https://example.com'
  if (fieldType === 'number' || fieldType === 'currency') return '0'
  if (fieldType === 'json') return '{}'
  if (fieldType === 'textarea' || fieldType === 'richtext') {
    return 'Write your content here…'
  }
  return ''
}
</script>

<template>
  <component
    :is="customComponent"
    v-if="customComponent"
    :field="field"
    :model-value="modelValue"
    :error="visibleError"
    :is-edit="isEdit"
    @update:model-value="update"
    @blur="handleBlur"
  />

  <div v-else class="space-y-2">
    <div
      v-if="type === 'boolean'"
      class="min-h-11 flex items-center justify-between gap-4"
    >
      <label
        :for="fieldId"
        class="text-sm font-medium text-gray-700 dark:text-gray-300"
      >
        {{ label }}
      </label>
      <div class="flex items-center gap-3">
        <button
          :id="fieldId"
          type="button"
          role="switch"
          :aria-checked="Boolean(modelValue)"
          :aria-describedby="describedBy"
          :disabled="field.readOnly"
          :data-test="`${fieldId}-input`"
          :class="[
            'relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 focus-visible:ring-offset-2 motion-reduce:transition-none dark:focus-visible:ring-gray-600 dark:focus-visible:ring-offset-gray-900',
            modelValue
              ? 'bg-gray-900 dark:bg-white'
              : 'bg-gray-300 dark:bg-gray-600',
            field.readOnly ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
          ]"
          @click="update(!modelValue)"
          @blur="handleBlur"
        >
          <span
            :class="[
              'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform motion-reduce:transition-none dark:bg-gray-900',
              modelValue ? 'translate-x-4' : 'translate-x-0'
            ]"
            aria-hidden="true"
          ></span>
        </button>
        <span class="w-6 text-sm text-gray-500 dark:text-gray-400">
          {{ modelValue ? 'Yes' : 'No' }}
        </span>
      </div>
    </div>

    <template v-else>
      <div class="flex items-center justify-between gap-3">
        <label
          :id="type === 'richtext' ? `${fieldId}-label` : undefined"
          :for="type === 'richtext' ? undefined : fieldId"
          class="block text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          {{ label }}
          <span
            v-if="!attribute.required"
            class="ml-1 text-xs font-normal text-gray-400 dark:text-gray-500"
          >
            Optional
          </span>
        </label>
        <button
          v-if="
            type === 'richtext' &&
            attribute.field?.format?.toLowerCase() === 'markdown'
          "
          type="button"
          :data-test="`${fieldId}-mode-toggle`"
          :aria-label="`Edit ${label} as ${
            richTextMode === 'source' ? 'Visual' : 'Markdown'
          }`"
          :disabled="
            richTextMode === 'source' &&
            richTextCompatibility.supported === false
          "
          class="text-xs font-medium text-gray-400 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-500 dark:hover:text-white"
          @click="toggleRichTextMode"
        >
          {{ richTextMode === 'source' ? 'Visual' : 'Markdown' }}
        </button>
      </div>

      <input
        v-if="['text', 'email', 'url', 'password', 'secret'].includes(type)"
        :id="fieldId"
        :value="modelValue"
        :type="
          ['password', 'secret'].includes(type)
            ? 'password'
            : type === 'url'
            ? 'url'
            : type
        "
        :disabled="field.readOnly"
        :required="attribute.required"
        :maxlength="attribute.maxLength || undefined"
        :placeholder="
          ['password', 'secret'].includes(type) && isEdit
            ? 'Leave blank to keep current'
            : placeholder
        "
        :aria-invalid="visibleError ? 'true' : undefined"
        :aria-describedby="describedBy"
        :data-test="`${fieldId}-input`"
        :class="inputClass"
        @input="update($event.target.value)"
        @blur="handleBlur"
      />

      <div
        v-else-if="type === 'currency'"
        class="flex items-center border-b border-dashed border-gray-200 focus-within:border-gray-900 dark:border-gray-700 dark:focus-within:border-white"
      >
        <span
          class="shrink-0 pl-1 text-sm text-gray-400 dark:text-gray-500"
          aria-hidden="true"
        >
          {{ currencySymbol }}
        </span>
        <input
          :id="fieldId"
          :value="modelValue"
          type="number"
          inputmode="decimal"
          step="any"
          :disabled="field.readOnly"
          :required="attribute.required"
          :min="attribute.min ?? undefined"
          :max="attribute.max ?? undefined"
          :placeholder="placeholder"
          :aria-invalid="visibleError ? 'true' : undefined"
          :aria-describedby="describedBy"
          :data-test="`${fieldId}-input`"
          class="bridge-number-input h-11 w-full bg-transparent px-2 text-sm tabular-nums text-gray-900 placeholder-gray-400 focus:outline-none disabled:cursor-not-allowed disabled:text-gray-400 dark:text-white dark:placeholder-gray-500"
          @input="update($event.target.value)"
          @blur="handleBlur"
        />
      </div>

      <input
        v-else-if="type === 'number'"
        :id="fieldId"
        :value="modelValue"
        type="number"
        inputmode="decimal"
        step="any"
        :disabled="field.readOnly"
        :required="attribute.required"
        :min="attribute.min ?? undefined"
        :max="attribute.max ?? undefined"
        :placeholder="placeholder"
        :aria-invalid="visibleError ? 'true' : undefined"
        :aria-describedby="describedBy"
        :data-test="`${fieldId}-input`"
        :class="`${inputClass} bridge-number-input tabular-nums`"
        @input="update($event.target.value)"
        @blur="handleBlur"
      />

      <input
        v-else-if="type === 'date'"
        :id="fieldId"
        :value="modelValue"
        type="date"
        :disabled="field.readOnly"
        :required="attribute.required"
        :aria-invalid="visibleError ? 'true' : undefined"
        :aria-describedby="describedBy"
        :data-test="`${fieldId}-input`"
        :class="inputClass"
        @input="update($event.target.value)"
        @blur="handleBlur"
      />

      <input
        v-else-if="['datetime', 'timestamp'].includes(type)"
        :id="fieldId"
        :value="modelValue"
        type="datetime-local"
        :disabled="field.readOnly"
        :required="attribute.required"
        :aria-invalid="visibleError ? 'true' : undefined"
        :aria-describedby="describedBy"
        :data-test="`${fieldId}-input`"
        :class="inputClass"
        @input="update($event.target.value)"
        @blur="handleBlur"
      />

      <select
        v-else-if="type === 'select'"
        :id="fieldId"
        :value="modelValue"
        :disabled="field.readOnly"
        :required="attribute.required"
        :aria-invalid="visibleError ? 'true' : undefined"
        :aria-describedby="describedBy"
        :data-test="`${fieldId}-input`"
        :class="inputClass"
        @change="update(options[$event.target.selectedIndex - 1]?.value ?? '')"
        @blur="handleBlur"
      >
        <option value="">Select…</option>
        <option
          v-for="option in options"
          :key="`${typeof option.value}:${String(option.value)}`"
          :value="String(option.value)"
          :disabled="option.disabled"
          :selected="Object.is(option.value, modelValue)"
        >
          {{ option.label }}
        </option>
      </select>

      <BridgeRelationshipSelect
        v-else-if="type === 'belongsTo'"
        :id="fieldId"
        :label="label"
        :model-value="modelValue"
        :options="associationOptions"
        :search-url="associationSearchUrl"
        :searchable="attribute.field?.relation?.searchable !== false"
        :disabled="field.readOnly || Boolean(associationDisabledReason)"
        :placeholder="associationDisabledReason"
        :search-placeholder="associationSearchPlaceholder"
        :empty-text="associationEmptyText"
        :required="attribute.required"
        :invalid="Boolean(visibleError)"
        :described-by="describedBy"
        @update:model-value="update"
        @blur="handleBlur"
      />

      <MarkdownEditor
        v-else-if="
          type === 'richtext' &&
          attribute.field?.format?.toLowerCase() === 'markdown'
        "
        ref="richTextEditor"
        :model-value="modelValue"
        variant="field"
        :editor-id="fieldId"
        :placeholder="placeholder"
        :aria-label="label"
        :aria-labelledby="`${fieldId}-label`"
        :aria-describedby="describedBy"
        :required="attribute.required"
        :uploads-configured="richTextUploadsConfigured"
        :upload-url="uploadUrl"
        upload-field-name="file"
        :upload-accept="attribute.field?.upload?.accept || []"
        :max-upload-bytes="attribute.field?.upload?.maxBytes"
        :upload-values="uploadPathValues"
        deny-raw-html
        @update:model-value="update"
        @blur="handleBlur"
        @mode-change="richTextMode = $event"
        @compatibility-change="richTextCompatibility = $event"
      />

      <textarea
        v-else-if="['textarea', 'richtext'].includes(type)"
        :id="fieldId"
        :value="modelValue"
        :disabled="field.readOnly"
        :required="attribute.required"
        :maxlength="attribute.maxLength || undefined"
        :placeholder="placeholder"
        :aria-invalid="visibleError ? 'true' : undefined"
        :aria-describedby="describedBy"
        :data-test="`${fieldId}-input`"
        :class="textareaClass"
        style="field-sizing: content"
        @input="update($event.target.value)"
        @blur="handleBlur"
      ></textarea>

      <textarea
        v-else-if="type === 'json'"
        :id="fieldId"
        :value="modelValue"
        :disabled="field.readOnly"
        :required="attribute.required"
        :placeholder="placeholder"
        :aria-invalid="visibleError ? 'true' : undefined"
        :aria-describedby="describedBy"
        :data-test="`${fieldId}-input`"
        :class="`${textareaClass} font-mono`"
        style="field-sizing: content"
        @input="update($event.target.value)"
        @blur="handleBlur"
      ></textarea>

      <div
        v-else-if="['file', 'image', 'upload'].includes(type)"
        class="space-y-3"
      >
        <input
          :id="fieldId"
          ref="fileInput"
          type="file"
          class="sr-only"
          :accept="accept || undefined"
          :disabled="field.readOnly || uploading"
          :data-test="`${fieldId}-input`"
          @change="uploadFile"
        />
        <div
          v-if="uploading"
          class="space-y-2 rounded-lg bg-gray-50 p-3 dark:bg-gray-900"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          :aria-label="`${label} upload status`"
        >
          <div class="flex items-center justify-between gap-4">
            <p
              class="min-w-0 truncate text-xs font-medium tabular-nums text-gray-600 dark:text-gray-300"
            >
              {{ uploadStatus }}
            </p>
            <button
              v-if="uploadPhase === 'uploading' && uploadAbortController"
              type="button"
              class="shrink-0 text-xs font-medium text-gray-500 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 dark:text-gray-400 dark:hover:text-white dark:focus-visible:ring-gray-600"
              @click="cancelUpload"
            >
              Cancel
            </button>
          </div>
          <progress
            v-if="uploadPhase === 'uploading'"
            :value="uploadPercent"
            max="100"
            class="h-1.5 w-full overflow-hidden rounded-full accent-gray-900 dark:accent-white"
          >
            {{ uploadPercent }}%
          </progress>
          <div
            v-else
            class="h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"
            aria-hidden="true"
          >
            <span
              class="block h-full w-1/3 animate-pulse rounded-full bg-gray-500 motion-reduce:animate-none dark:bg-gray-400"
            ></span>
          </div>
        </div>
        <div
          v-else-if="safeCurrentUploadUrl"
          class="flex min-w-0 items-center gap-3 rounded-lg bg-gray-50 p-3 dark:bg-gray-900"
        >
          <img
            v-if="isImageUpload"
            :src="safeCurrentUploadUrl"
            :alt="`${label} preview`"
            class="h-12 w-16 shrink-0 rounded-md object-cover"
          />
          <div class="min-w-0 flex-1">
            <p
              class="truncate text-sm font-medium text-gray-700 dark:text-gray-200"
            >
              {{ uploadedValue?.file?.name || 'Uploaded file' }}
            </p>
            <a
              :href="safeCurrentUploadUrl"
              target="_blank"
              rel="noreferrer"
              class="block truncate text-xs text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300"
            >
              {{ safeCurrentUploadUrl }}
            </a>
          </div>
          <button
            type="button"
            :disabled="field.readOnly || uploading"
            class="shrink-0 text-xs font-medium text-gray-500 hover:text-gray-900 disabled:opacity-50 dark:text-gray-400 dark:hover:text-white"
            @click="fileInput?.click()"
          >
            Replace
          </button>
        </div>
        <div v-else>
          <button
            type="button"
            :disabled="field.readOnly"
            class="inline-flex h-10 items-center rounded-md bg-gray-100 px-3 text-sm font-medium text-gray-700 hover:bg-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700 dark:focus-visible:ring-gray-600"
            @click="fileInput?.click()"
          >
            {{ isImageUpload ? 'Choose image' : 'Choose file' }}
          </button>
        </div>
        <p class="text-xs text-gray-400 dark:text-gray-500">
          {{ uploadHint }}
        </p>
        <div
          v-if="uploadError && pendingUploadFile && !uploading"
          class="flex items-center gap-3"
        >
          <button
            type="button"
            class="text-xs font-medium text-gray-700 hover:text-gray-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 dark:text-gray-300 dark:hover:text-white dark:focus-visible:ring-gray-600"
            @click="retryUpload"
          >
            Retry upload
          </button>
          <button
            type="button"
            class="text-xs text-gray-400 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 dark:text-gray-500 dark:hover:text-gray-300 dark:focus-visible:ring-gray-600"
            @click="fileInput?.click()"
          >
            Choose another file
          </button>
        </div>
      </div>
    </template>

    <p
      v-if="visibleError"
      :id="errorId"
      class="text-xs text-red-600 dark:text-red-400"
    >
      {{ visibleError }}
    </p>
    <p
      v-if="description"
      :id="helpId"
      class="text-xs leading-5 text-gray-400 dark:text-gray-500"
    >
      {{ description }}
    </p>
  </div>
</template>

<style scoped>
.bridge-number-input {
  appearance: textfield;
  -moz-appearance: textfield;
}

.bridge-number-input::-webkit-outer-spin-button,
.bridge-number-input::-webkit-inner-spin-button {
  margin: 0;
  -webkit-appearance: none;
}
</style>
