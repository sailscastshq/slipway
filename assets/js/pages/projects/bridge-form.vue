<script setup>
import { Link, Head, useForm } from '@inertiajs/vue3'
import { inject, ref, computed, onMounted } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'
import ToastContainer from '@/components/ToastContainer.vue'
import { createToast } from '@/composables/toast'
import SlippyLoader from '@/components/SlippyLoader.vue'
import MarkdownEditor from '@/components/content/MarkdownEditor.vue'
import { containsRawHtml } from '@/lib/content/markdown.mjs'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  project: Object,
  environment: Object,
  mode: String,
  modelIdentity: String,
  recordId: String,
  appRunning: Boolean,
  modelMeta: Object,
  record: Object,
  assocOptions: Object,
  error: String
})

const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')
const { toasts, toast, dismiss } = createToast()

const isEdit = computed(() => props.mode === 'edit')

function encodePathSegment(value) {
  return encodeURIComponent(String(value))
}

function displayIdentifier(value) {
  const identifier = String(value ?? '')
  if (identifier.length <= 24) return identifier
  return `${identifier.slice(0, 10)}…${identifier.slice(-6)}`
}

// Form state
const formValues = ref({})
const formErrors = ref({})
const form = useForm({ values: {} })
const richTextEditors = ref({})
const richTextModes = ref({})
const richTextCompatibility = ref({})

// Initialize form values from props
onMounted(() => {
  if (!props.modelMeta) return

  const values = {}
  const surface = isEdit.value ? props.modelMeta.edit : props.modelMeta.create
  for (const name of surface || []) {
    const attr = props.modelMeta.attributes[name]
    if (!attr) continue
    const defaultValue = attr.field?.default ?? attr.defaultsTo
    if (attr.type === 'boolean') values[name] = defaultValue ?? false
    else if (attr.type === 'json')
      values[name] =
        defaultValue !== undefined ? JSON.stringify(defaultValue, null, 2) : ''
    else values[name] = defaultValue ?? ''
  }

  // Load record values in edit mode
  if (isEdit.value && props.record) {
    for (const name of Object.keys(values)) {
      if (props.record[name] !== undefined) {
        const attr = props.modelMeta.attributes[name]
        if (attr?.type === 'json' && typeof props.record[name] === 'object') {
          values[name] = JSON.stringify(props.record[name], null, 2)
        } else if (attr?.encrypt) {
          values[name] = '' // Don't pre-fill encrypted fields
        } else {
          values[name] = props.record[name]
        }
      }
    }
  }

  formValues.value = values
})

// Editable fields
const editableFields = computed(() => {
  if (!props.modelMeta) return []
  const surface = isEdit.value ? props.modelMeta.edit : props.modelMeta.create

  return (surface || [])
    .map((name) => {
      const attribute = props.modelMeta.attributes[name]
      if (!attribute) return null
      const association = (props.modelMeta.associations || []).find(
        (candidate) => candidate.type === 'model' && candidate.alias === name
      )

      return {
        name,
        attr: association
          ? {
              ...attribute,
              isBelongsTo: true,
              relatedModel: association.model
            }
          : attribute,
        readOnly:
          attribute.field?.readOnly === true ||
          attribute.autoCreatedAt ||
          attribute.autoUpdatedAt
      }
    })
    .filter(Boolean)
})

function hasRequiredValue(field) {
  if (field.readOnly || !field.attr.required) return true

  const value = formValues.value[field.name]
  if (isEdit.value && field.attr.encrypt && value === '') return true
  if (inputType(field) === 'toggle') return typeof value === 'boolean'
  if (inputType(field) === 'number') {
    return (
      value !== '' &&
      value !== null &&
      value !== undefined &&
      Number.isFinite(Number(value))
    )
  }
  if (inputType(field) === 'json') {
    if (typeof value !== 'string' || value.trim() === '') return false
    try {
      JSON.parse(value)
      return true
    } catch {
      return false
    }
  }
  if (typeof value === 'string') return value.trim().length > 0
  return value !== null && value !== undefined
}

const isFormReady = computed(
  () =>
    editableFields.value.every(hasRequiredValue) &&
    editableFields.value.every((field) => !richTextSecurityError(field)) &&
    Object.keys(formErrors.value).length === 0
)

// Rich text field names (detect by name pattern)
const richTextPatterns = [
  'content',
  'body',
  'description',
  'bio',
  'about',
  'summary',
  'text',
  'html',
  'markdown',
  'notes'
]

function inputType(field) {
  const attr = field.attr
  const name = field.name.toLowerCase()

  if (attr.isBelongsTo) return 'belongsTo'
  if (
    [
      'text',
      'email',
      'password',
      'number',
      'select',
      'toggle',
      'json',
      'richtext'
    ].includes(attr.field?.type)
  ) {
    return attr.field.type
  }
  if (attr.encrypt) return 'password'
  if (attr.isEmail) return 'email'
  if (attr.isIn && attr.isIn.length > 0) return 'select'
  if (attr.type === 'boolean') return 'toggle'
  if (attr.type === 'json') return 'json'
  if (attr.type === 'number') return 'number'

  // Detect rich text / long text fields
  if (attr.type === 'string') {
    if (attr.columnType === 'text') return 'richtext'
    if (richTextPatterns.some((p) => name.includes(p))) return 'richtext'
  }

  return 'text'
}

function isMarkdownRichText(field) {
  return (
    inputType(field) === 'richtext' &&
    field.attr.field?.format?.toLowerCase() === 'markdown'
  )
}

function richTextEditorId(field) {
  return `bridge-${props.modelIdentity}-${field.name}`.replace(
    /[^a-zA-Z0-9_-]/g,
    '-'
  )
}

function richTextLabelId(field) {
  return `${richTextEditorId(field)}-label`
}

function richTextHelpId(field) {
  return fieldDescription(field) ? `${richTextEditorId(field)}-help` : undefined
}

function richTextErrorId(field) {
  return `${richTextEditorId(field)}-error`
}

function richTextDescribedBy(field) {
  return (
    [
      richTextHelpId(field),
      richTextSecurityError(field) && richTextErrorId(field)
    ]
      .filter(Boolean)
      .join(' ') || undefined
  )
}

function richTextSecurityError(field) {
  if (!isMarkdownRichText(field)) return ''
  if (!containsRawHtml(formValues.value[field.name] || '')) return ''
  return 'Raw HTML is not allowed in Bridge Markdown fields.'
}

function registerRichTextEditor(field, editor) {
  if (editor) richTextEditors.value[field.name] = editor
  else delete richTextEditors.value[field.name]
}

function updateRichTextMode(field, mode) {
  richTextModes.value[field.name] = mode
}

function updateRichTextCompatibility(field, compatibility) {
  richTextCompatibility.value[field.name] = compatibility
}

function toggleRichTextMode(field) {
  const nextMode =
    richTextModes.value[field.name] === 'source' ? 'visual' : 'source'
  richTextEditors.value[field.name]?.setMode(nextMode)
}

function canUseRichTextVisual(field) {
  return richTextCompatibility.value[field.name]?.supported !== false
}

// Get field description based on type/validations
function fieldDescription(field) {
  return field.attr.field?.help || ''
}

function fieldLabel(field) {
  return field.attr.label || field.name
}

function fieldPlaceholder(field, fallback = '') {
  return field.attr.field?.placeholder || fallback
}

function selectOptions(field) {
  return field.attr.field?.options || field.attr.isIn || []
}

// JSON validation
function validateJson(name) {
  const val = formValues.value[name]
  if (!val || val.trim() === '') {
    delete formErrors.value[name]
    return
  }
  try {
    JSON.parse(val)
    delete formErrors.value[name]
  } catch {
    formErrors.value[name] = 'Invalid JSON'
  }
}

function handleSubmit() {
  if (!isFormReady.value) {
    toast({ message: 'Complete the required fields first.', type: 'error' })
    return
  }

  if (Object.keys(formErrors.value).length > 0) {
    toast({ message: 'Please fix validation errors.', type: 'error' })
    return
  }

  // Prepare values
  const values = {}
  for (const field of editableFields.value) {
    if (field.readOnly) continue
    const name = field.name
    const attr = field.attr
    let val = formValues.value[name]

    // Type coercion
    if (attr.type === 'json' && typeof val === 'string' && val.trim()) {
      try {
        val = JSON.parse(val)
      } catch {
        /* send as string */
      }
    }
    if (attr.type === 'number' && val !== '' && val !== null) {
      val = Number(val)
    }
    if (attr.encrypt && val === '') continue

    if (val === '' && !attr.required && attr.type !== 'string') {
      val = null
    }

    values[name] = val
  }

  form.values = values
  const actionUrl = isEdit.value
    ? `/projects/${props.project.slug}/environments/${
        props.environment.slug
      }/bridge/${props.modelIdentity}/${encodePathSegment(
        props.recordId
      )}/update`
    : `/projects/${props.project.slug}/environments/${props.environment.slug}/bridge/${props.modelIdentity}/create`

  form.post(actionUrl, {
    onSuccess: () => {
      toast({
        message: isEdit.value ? 'Record updated.' : 'Record created.',
        type: 'success'
      })
    },
    onError: (errors) => {
      toast({ message: errors.error || 'Failed to save record', type: 'error' })
    }
  })
}

function bridgeUrl() {
  return `/projects/${props.project.slug}/environments/${props.environment.slug}/bridge`
}
function modelUrl() {
  return `/projects/${props.project.slug}/environments/${props.environment.slug}/bridge/${props.modelIdentity}`
}
function recordUrl() {
  return `/projects/${props.project.slug}/environments/${
    props.environment.slug
  }/bridge/${props.modelIdentity}/${encodePathSegment(props.recordId)}`
}
</script>

<template>
  <Head
    :title="`${isEdit ? 'Edit' : 'Create'} ${
      modelMeta?.singularLabel || modelIdentity
    } - Bridge | Slipway`"
  ></Head>
  <ToastContainer :toasts="toasts" @dismiss="dismiss" />

  <div class="flex h-full flex-col">
    <!-- Header -->
    <div
      class="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800 sm:px-6"
    >
      <div class="flex items-center space-x-3">
        <button
          @click="toggleMobileMenu"
          class="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white md:hidden"
        >
          <svg
            class="h-5 w-5"
            viewBox="-0.5 -0.5 16 16"
            fill="none"
            stroke="currentColor"
          >
            <path
              d="M12.777 14.285H2.223c-.833 0-1.508-.675-1.508-1.508V2.223c0-.833.675-1.508 1.508-1.508h10.554c.833 0 1.508.675 1.508 1.508v10.554c0 .833-.675 1.508-1.508 1.508Z"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1"
            />
            <path
              d="M5.615 14.285V.715"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1"
            />
            <path
              d="M2.6 5.992 3.919 7.5 2.6 9.008"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1"
            />
          </svg>
        </button>
        <button
          @click="toggleSidebar"
          class="hidden text-gray-400 dark:text-gray-500 md:block"
        >
          <svg
            v-if="sidebarCollapsed"
            class="h-5 w-5"
            viewBox="-0.5 -0.5 16 16"
            fill="none"
            stroke="currentColor"
          >
            <path
              d="M12.777 14.285H2.223c-.833 0-1.508-.675-1.508-1.508V2.223c0-.833.675-1.508 1.508-1.508h10.554c.833 0 1.508.675 1.508 1.508v10.554c0 .833-.675 1.508-1.508 1.508Z"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1"
            />
            <path
              d="M5.615 14.285V.715"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1"
            />
            <path
              d="M2.6 5.992 3.919 7.5 2.6 9.008"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1"
            />
          </svg>
          <svg
            v-else
            class="h-5 w-5"
            viewBox="-0.5 -0.5 16 16"
            fill="none"
            stroke="currentColor"
          >
            <path
              d="M12.777 14.285H2.223c-.833 0-1.508-.675-1.508-1.508V2.223c0-.833.675-1.508 1.508-1.508h10.554c.833 0 1.508.675 1.508 1.508v10.554c0 .833-.675 1.508-1.508 1.508Z"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1"
            />
            <path
              d="M5.615 14.285V.715"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1"
            />
            <path
              d="M3.919 5.992 2.6 7.5l1.319 1.508"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1"
            />
          </svg>
        </button>
        <nav class="flex items-center space-x-2 text-sm sm:hidden">
          <Link :href="modelUrl()" class="text-gray-500 dark:text-gray-400">{{
            modelMeta?.label || modelIdentity
          }}</Link>
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <span class="font-medium text-gray-900 dark:text-white">{{
            isEdit ? 'edit' : 'new'
          }}</span>
        </nav>
        <nav class="hidden items-center space-x-2 text-sm sm:flex">
          <Link
            href="/"
            class="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
            >projects</Link
          >
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <Link
            :href="`/projects/${project.slug}`"
            class="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >
            {{ project.name.toLowerCase() }}
          </Link>
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <Link
            :href="bridgeUrl()"
            class="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
            >bridge</Link
          >
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <Link
            :href="modelUrl()"
            class="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
            >{{ modelMeta?.label || modelIdentity }}</Link
          >
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <span class="font-medium text-gray-900 dark:text-white">{{
            isEdit ? displayIdentifier(recordId) : 'new'
          }}</span>
        </nav>
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
      <!-- Error -->
      <div v-if="error" class="flex h-full items-center justify-center">
        <div class="text-center">
          <div
            class="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50 dark:bg-red-950/30"
          >
            <svg
              class="h-8 w-8 text-red-500 dark:text-red-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.5"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <p class="mt-4 text-sm text-red-600 dark:text-red-400">{{ error }}</p>
        </div>
      </div>

      <!-- Form -->
      <div v-else-if="modelMeta" class="mx-auto max-w-xl">
        <!-- Description -->
        <div class="mb-6">
          <h1 class="text-xl font-semibold text-gray-900 dark:text-white">
            {{ isEdit ? 'Edit' : 'Create' }}
            {{ modelMeta.singularLabel || modelIdentity }}
          </h1>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {{
              isEdit
                ? `Update this ${(
                    modelMeta.singularLabel || modelIdentity
                  ).toLowerCase()}`
                : `Add a new ${(
                    modelMeta.singularLabel || modelIdentity
                  ).toLowerCase()}`
            }}
          </p>
        </div>

        <form @submit.prevent="handleSubmit" class="space-y-7">
          <div class="space-y-7">
            <div v-for="field in editableFields" :key="field.name">
              <!-- Simple fields (text, email, password, number, select) -->
              <div
                v-if="
                  [
                    'text',
                    'email',
                    'password',
                    'number',
                    'select',
                    'belongsTo'
                  ].includes(inputType(field))
                "
                class="space-y-2"
              >
                <label
                  :for="field.name"
                  class="block text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  {{ fieldLabel(field) }}
                  <span v-if="field.attr.required" class="text-red-500">*</span>
                </label>
                <div class="flex-1">
                  <!-- Text -->
                  <input
                    v-if="inputType(field) === 'text'"
                    :id="field.name"
                    v-model="formValues[field.name]"
                    type="text"
                    :disabled="field.readOnly"
                    :required="field.attr.required"
                    :maxlength="field.attr.maxLength || undefined"
                    :placeholder="
                      fieldPlaceholder(
                        field,
                        field.attr.defaultsTo !== undefined
                          ? String(field.attr.defaultsTo)
                          : ''
                      )
                    "
                    class="focus:border-brand h-11 w-full border-b border-dashed border-gray-200 bg-transparent px-1 text-sm text-gray-900 placeholder-gray-400 focus:outline-none disabled:cursor-not-allowed disabled:text-gray-400 dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
                  />
                  <!-- Email -->
                  <input
                    v-else-if="inputType(field) === 'email'"
                    :id="field.name"
                    v-model="formValues[field.name]"
                    type="email"
                    :disabled="field.readOnly"
                    :required="field.attr.required"
                    :placeholder="fieldPlaceholder(field, 'email@example.com')"
                    class="focus:border-brand h-11 w-full border-b border-dashed border-gray-200 bg-transparent px-1 text-sm text-gray-900 placeholder-gray-400 focus:outline-none disabled:cursor-not-allowed disabled:text-gray-400 dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
                  />
                  <!-- Password -->
                  <input
                    v-else-if="inputType(field) === 'password'"
                    :id="field.name"
                    v-model="formValues[field.name]"
                    type="password"
                    :disabled="field.readOnly"
                    :placeholder="
                      fieldPlaceholder(
                        field,
                        isEdit ? 'Leave blank to keep current' : ''
                      )
                    "
                    class="focus:border-brand h-11 w-full border-b border-dashed border-gray-200 bg-transparent px-1 text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
                  />
                  <!-- Number -->
                  <input
                    v-else-if="inputType(field) === 'number'"
                    :id="field.name"
                    v-model.number="formValues[field.name]"
                    type="number"
                    :disabled="field.readOnly"
                    :required="field.attr.required"
                    :placeholder="fieldPlaceholder(field, '0')"
                    class="focus:border-brand h-11 w-full border-b border-dashed border-gray-200 bg-transparent px-1 text-sm text-gray-900 placeholder-gray-400 focus:outline-none disabled:cursor-not-allowed disabled:text-gray-400 dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
                  />
                  <!-- Select (isIn) -->
                  <select
                    v-else-if="inputType(field) === 'select'"
                    :id="field.name"
                    v-model="formValues[field.name]"
                    :disabled="field.readOnly"
                    :required="field.attr.required"
                    class="focus:border-brand h-11 w-full border-b border-dashed border-gray-200 bg-transparent px-1 text-sm text-gray-900 focus:outline-none disabled:cursor-not-allowed disabled:text-gray-400 dark:border-gray-700 dark:text-white"
                  >
                    <option value="">Select...</option>
                    <option
                      v-for="opt in selectOptions(field)"
                      :key="opt"
                      :value="opt"
                    >
                      {{ opt }}
                    </option>
                  </select>
                  <!-- BelongsTo -->
                  <select
                    v-else-if="inputType(field) === 'belongsTo'"
                    :id="field.name"
                    v-model="formValues[field.name]"
                    :disabled="field.readOnly"
                    class="focus:border-brand h-11 w-full border-b border-dashed border-gray-200 bg-transparent px-1 text-sm text-gray-900 focus:outline-none disabled:cursor-not-allowed disabled:text-gray-400 dark:border-gray-700 dark:text-white"
                  >
                    <option value="">None</option>
                    <option
                      v-for="opt in assocOptions[field.name] || []"
                      :key="opt.id"
                      :value="opt.id"
                    >
                      {{ opt.label }}
                    </option>
                  </select>
                  <p
                    v-if="fieldDescription(field)"
                    class="mt-1.5 text-xs text-gray-400 dark:text-gray-500"
                  >
                    {{ fieldDescription(field) }}
                  </p>
                </div>
              </div>

              <!-- Toggle (boolean) -->
              <div v-else-if="inputType(field) === 'toggle'" class="space-y-3">
                <label
                  :for="field.name"
                  class="block text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  {{ fieldLabel(field) }}
                </label>
                <div class="flex items-center gap-3">
                  <button
                    :id="field.name"
                    type="button"
                    role="switch"
                    :aria-checked="Boolean(formValues[field.name])"
                    :disabled="field.readOnly"
                    @click="formValues[field.name] = !formValues[field.name]"
                    :class="[
                      'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-gray-300 focus:ring-offset-2 dark:focus:ring-gray-600 dark:focus:ring-offset-gray-900',
                      formValues[field.name]
                        ? 'bg-gray-900 dark:bg-white'
                        : 'bg-gray-300 dark:bg-gray-600',
                      field.readOnly ? 'cursor-not-allowed opacity-50' : ''
                    ]"
                  >
                    <span
                      :class="[
                        'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out dark:bg-gray-900',
                        formValues[field.name]
                          ? 'translate-x-4'
                          : 'translate-x-0'
                      ]"
                    ></span>
                  </button>
                  <span class="text-sm text-gray-500 dark:text-gray-400">{{
                    formValues[field.name] ? 'Yes' : 'No'
                  }}</span>
                </div>
              </div>

              <!-- Markdown-backed rich text -->
              <div v-else-if="isMarkdownRichText(field)" class="space-y-2">
                <div class="flex items-center justify-between gap-3">
                  <span
                    :id="richTextLabelId(field)"
                    class="block text-sm font-medium text-gray-700 dark:text-gray-300"
                  >
                    {{ fieldLabel(field) }}
                    <span v-if="field.attr.required" class="text-red-500"
                      >*</span
                    >
                  </span>
                  <button
                    type="button"
                    :data-test="`${richTextEditorId(field)}-mode-toggle`"
                    :aria-label="`Edit ${fieldLabel(field)} as ${
                      richTextModes[field.name] === 'source'
                        ? 'Visual'
                        : 'Markdown'
                    }`"
                    :disabled="
                      richTextModes[field.name] === 'source' &&
                      !canUseRichTextVisual(field)
                    "
                    class="text-xs font-medium text-gray-400 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-500 dark:hover:text-white"
                    @click="toggleRichTextMode(field)"
                  >
                    {{
                      richTextModes[field.name] === 'source'
                        ? 'Visual'
                        : 'Markdown'
                    }}
                  </button>
                </div>
                <MarkdownEditor
                  :ref="(editor) => registerRichTextEditor(field, editor)"
                  v-model="formValues[field.name]"
                  variant="field"
                  :editor-id="richTextEditorId(field)"
                  :placeholder="
                    fieldPlaceholder(field, 'Write your content here...')
                  "
                  :aria-label="fieldLabel(field)"
                  :aria-labelledby="richTextLabelId(field)"
                  :aria-describedby="richTextDescribedBy(field)"
                  :required="field.attr.required"
                  deny-raw-html
                  @mode-change="updateRichTextMode(field, $event)"
                  @compatibility-change="
                    updateRichTextCompatibility(field, $event)
                  "
                />
                <p
                  v-if="richTextSecurityError(field)"
                  :id="richTextErrorId(field)"
                  class="text-xs text-red-600 dark:text-red-400"
                  role="alert"
                >
                  {{ richTextSecurityError(field) }}
                </p>
                <p
                  v-if="fieldDescription(field)"
                  :id="richTextHelpId(field)"
                  class="mt-1.5 text-xs text-gray-400 dark:text-gray-500"
                >
                  {{ fieldDescription(field) }}
                </p>
              </div>

              <!-- Long text -->
              <div
                v-else-if="inputType(field) === 'richtext'"
                class="space-y-2"
              >
                <label
                  :for="field.name"
                  class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  {{ fieldLabel(field) }}
                  <span v-if="field.attr.required" class="text-red-500">*</span>
                </label>
                <textarea
                  :id="field.name"
                  v-model="formValues[field.name]"
                  :disabled="field.readOnly"
                  :required="field.attr.required"
                  :placeholder="
                    fieldPlaceholder(field, 'Write your content here...')
                  "
                  class="focus:border-brand min-h-28 w-full resize-none border-b border-dashed border-gray-200 bg-transparent px-1 py-2 text-sm leading-6 text-gray-900 placeholder-gray-400 focus:outline-none disabled:cursor-not-allowed disabled:text-gray-400 dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
                  style="field-sizing: content"
                ></textarea>
                <p
                  v-if="fieldDescription(field)"
                  class="mt-1.5 text-xs text-gray-400 dark:text-gray-500"
                >
                  {{ fieldDescription(field) }}
                </p>
              </div>

              <!-- JSON -->
              <div v-else-if="inputType(field) === 'json'" class="space-y-2">
                <label
                  :for="field.name"
                  class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  {{ fieldLabel(field) }}
                  <span class="ml-1 text-xs font-normal text-gray-400"
                    >JSON</span
                  >
                </label>
                <textarea
                  :id="field.name"
                  v-model="formValues[field.name]"
                  :disabled="field.readOnly"
                  @blur="validateJson(field.name)"
                  :placeholder="fieldPlaceholder(field, '{}')"
                  class="focus:border-brand min-h-28 w-full resize-none border-b border-dashed border-gray-200 bg-transparent px-1 py-2 font-mono text-sm leading-6 text-gray-900 placeholder-gray-400 focus:outline-none disabled:cursor-not-allowed disabled:text-gray-400 dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
                  style="field-sizing: content"
                ></textarea>
                <p
                  v-if="formErrors[field.name]"
                  class="mt-1 text-xs text-red-600 dark:text-red-400"
                >
                  {{ formErrors[field.name] }}
                </p>
              </div>

              <!-- Fallback -->
              <div v-else class="space-y-2">
                <label
                  :for="field.name"
                  class="block text-sm font-medium text-gray-700 dark:text-gray-300"
                  >{{ fieldLabel(field) }}</label
                >
                <input
                  :id="field.name"
                  v-model="formValues[field.name]"
                  type="text"
                  :disabled="field.readOnly"
                  :placeholder="fieldPlaceholder(field)"
                  class="focus:border-brand h-11 w-full border-b border-dashed border-gray-200 bg-transparent px-1 text-sm text-gray-900 placeholder-gray-400 focus:outline-none disabled:cursor-not-allowed disabled:text-gray-400 dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
                />
              </div>
            </div>
          </div>

          <!-- Actions -->
          <div class="flex items-center justify-end gap-3 pt-1">
            <Link
              :href="isEdit ? recordUrl() : modelUrl()"
              class="rounded-md px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
            >
              Cancel
            </Link>
            <button
              type="submit"
              :disabled="form.processing || !isFormReady"
              :title="
                !isFormReady
                  ? isEdit
                    ? 'Complete the required fields to save this record'
                    : 'Complete the required fields to create this record'
                  : undefined
              "
              class="inline-flex items-center rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
            >
              <SlippyLoader
                v-if="form.processing"
                size="h-4 w-4"
                class="mr-2"
              />
              {{ isEdit ? 'Save changes' : 'Create record' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
