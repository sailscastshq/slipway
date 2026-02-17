<script setup>
import { Link, Head, useForm } from '@inertiajs/vue3'
import { inject, ref, computed, onMounted } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'
import ToastContainer from '@/components/ToastContainer.vue'
import { createToast } from '@/composables/toast'
import SlippyLoader from '@/components/SlippyLoader.vue'

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

// Form state
const formValues = ref({})
const formErrors = ref({})
const form = useForm({ values: {} })

// Initialize form values from props
onMounted(() => {
  if (!props.modelMeta) return

  const values = {}
  for (const [name, attr] of Object.entries(props.modelMeta.attributes)) {
    if (attr.autoIncrement) continue
    if (attr.type === 'boolean') values[name] = attr.defaultsTo ?? false
    else if (attr.type === 'json') values[name] = attr.defaultsTo !== undefined ? JSON.stringify(attr.defaultsTo, null, 2) : ''
    else values[name] = attr.defaultsTo ?? ''
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
  const fields = []

  for (const [name, attr] of Object.entries(props.modelMeta.attributes)) {
    // Skip auto-generated fields
    if (attr.autoIncrement) continue
    if (name === 'id') continue // Primary key
    if (!isEdit.value && (attr.autoCreatedAt || attr.autoUpdatedAt)) continue

    fields.push({ name, attr, readOnly: attr.autoCreatedAt || attr.autoUpdatedAt })
  }

  // Add model associations (belongsTo)
  for (const assoc of (props.modelMeta.associations || [])) {
    if (assoc.type !== 'model') continue
    const attr = props.modelMeta.attributes[assoc.alias]
    fields.push({
      name: assoc.alias,
      attr: { ...attr, isBelongsTo: true, relatedModel: assoc.model },
      readOnly: false
    })
  }

  return fields
})

// Rich text field names (detect by name pattern)
const richTextPatterns = ['content', 'body', 'description', 'bio', 'about', 'summary', 'text', 'html', 'markdown', 'notes']

function inputType(field) {
  const attr = field.attr
  const name = field.name.toLowerCase()

  if (attr.isBelongsTo) return 'belongsTo'
  if (attr.encrypt) return 'password'
  if (attr.isEmail) return 'email'
  if (attr.isIn && attr.isIn.length > 0) return 'select'
  if (attr.type === 'boolean') return 'toggle'
  if (attr.type === 'json') return 'json'
  if (attr.type === 'number') return 'number'

  // Detect rich text / long text fields
  if (attr.type === 'string') {
    if (attr.columnType === 'text') return 'richtext'
    if (richTextPatterns.some(p => name.includes(p))) return 'richtext'
  }

  return 'text'
}

// Get field description based on type/validations
function fieldDescription(field) {
  const attr = field.attr
  const parts = []

  if (attr.type) parts.push(attr.type)
  if (attr.columnType && attr.columnType !== attr.type) parts.push(attr.columnType)
  if (attr.encrypt) parts.push('encrypted')
  if (attr.unique) parts.push('unique')
  if (attr.maxLength) parts.push(`max ${attr.maxLength} chars`)
  if (attr.isBelongsTo) parts.push(`belongs to ${attr.relatedModel}`)
  if (attr.isIn) parts.push(`options: ${attr.isIn.join(', ')}`)

  return parts.join(' \u00b7 ')
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
      try { val = JSON.parse(val) } catch { /* send as string */ }
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
    ? `/projects/${props.project.slug}/environments/${props.environment.slug}/bridge/${props.modelIdentity}/${props.recordId}/update`
    : `/projects/${props.project.slug}/environments/${props.environment.slug}/bridge/${props.modelIdentity}/create`

  form.post(actionUrl, {
    onSuccess: () => {
      toast({ message: isEdit.value ? 'Record updated.' : 'Record created.', type: 'success' })
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
  return `/projects/${props.project.slug}/environments/${props.environment.slug}/bridge/${props.modelIdentity}/${props.recordId}`
}
</script>

<template>
  <Head :title="`${isEdit ? 'Edit' : 'Create'} ${modelIdentity} - Bridge | Slipway`"></Head>
  <ToastContainer :toasts="toasts" @dismiss="dismiss" />

  <div class="flex h-full flex-col">
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800 sm:px-6">
      <div class="flex items-center space-x-3">
        <button
          @click="toggleMobileMenu"
          class="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white md:hidden"
        >
          <svg class="h-5 w-5" viewBox="-0.5 -0.5 16 16" fill="none" stroke="currentColor">
            <path d="M12.777 14.285H2.223c-.833 0-1.508-.675-1.508-1.508V2.223c0-.833.675-1.508 1.508-1.508h10.554c.833 0 1.508.675 1.508 1.508v10.554c0 .833-.675 1.508-1.508 1.508Z" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" />
            <path d="M5.615 14.285V.715" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" />
            <path d="M2.6 5.992 3.919 7.5 2.6 9.008" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" />
          </svg>
        </button>
        <button
          @click="toggleSidebar"
          class="hidden text-gray-400 dark:text-gray-500 md:block"
        >
          <svg v-if="sidebarCollapsed" class="h-5 w-5" viewBox="-0.5 -0.5 16 16" fill="none" stroke="currentColor">
            <path d="M12.777 14.285H2.223c-.833 0-1.508-.675-1.508-1.508V2.223c0-.833.675-1.508 1.508-1.508h10.554c.833 0 1.508.675 1.508 1.508v10.554c0 .833-.675 1.508-1.508 1.508Z" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" />
            <path d="M5.615 14.285V.715" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" />
            <path d="M2.6 5.992 3.919 7.5 2.6 9.008" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" />
          </svg>
          <svg v-else class="h-5 w-5" viewBox="-0.5 -0.5 16 16" fill="none" stroke="currentColor">
            <path d="M12.777 14.285H2.223c-.833 0-1.508-.675-1.508-1.508V2.223c0-.833.675-1.508 1.508-1.508h10.554c.833 0 1.508.675 1.508 1.508v10.554c0 .833-.675 1.508-1.508 1.508Z" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" />
            <path d="M5.615 14.285V.715" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" />
            <path d="M3.919 5.992 2.6 7.5l1.319 1.508" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" />
          </svg>
        </button>
        <nav class="flex items-center space-x-2 text-sm sm:hidden">
          <Link :href="modelUrl()" class="text-gray-500 dark:text-gray-400">{{ modelIdentity }}</Link>
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <span class="font-medium text-gray-900 dark:text-white">{{ isEdit ? 'edit' : 'new' }}</span>
        </nav>
        <nav class="hidden items-center space-x-2 text-sm sm:flex">
          <Link href="/" class="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">projects</Link>
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <Link :href="`/projects/${project.slug}`" class="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">
            {{ project.name.toLowerCase() }}
          </Link>
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <Link :href="bridgeUrl()" class="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">bridge</Link>
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <Link :href="modelUrl()" class="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">{{ modelIdentity }}</Link>
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <span class="font-medium text-gray-900 dark:text-white">{{ isEdit ? `#${recordId}` : 'new' }}</span>
        </nav>
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
      <!-- Error -->
      <div v-if="error" class="flex h-full items-center justify-center">
        <div class="text-center">
          <div class="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50 dark:bg-red-950/30">
            <svg class="h-8 w-8 text-red-500 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <p class="mt-4 text-sm text-red-600 dark:text-red-400">{{ error }}</p>
        </div>
      </div>

      <!-- Form -->
      <div v-else-if="modelMeta" class="mx-auto max-w-2xl">
        <!-- Description -->
        <div class="mb-6">
          <h1 class="text-xl font-semibold text-gray-900 dark:text-white">
            {{ isEdit ? 'Edit' : 'Create' }} {{ modelMeta.globalId || modelIdentity }}
          </h1>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {{ isEdit ? `Editing record #${recordId}` : `Add a new record to ${modelMeta.tableName || modelIdentity}` }}
          </p>
        </div>

        <form @submit.prevent="handleSubmit">
          <div class="rounded-lg border border-gray-200 dark:border-gray-800">
            <div v-for="(field, index) in editableFields" :key="field.name" :class="index > 0 ? 'border-t border-gray-200 dark:border-gray-800' : ''">
              <!-- Simple fields (text, email, password, number, select) -->
              <div v-if="['text', 'email', 'password', 'number', 'select', 'belongsTo'].includes(inputType(field))" class="flex items-center gap-4 px-4 py-3">
                <label :for="field.name" class="w-40 shrink-0 text-sm font-medium text-gray-700 dark:text-gray-300">
                  {{ field.name }}
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
                    :placeholder="field.attr.defaultsTo !== undefined ? String(field.attr.defaultsTo) : ''"
                    class="w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none disabled:cursor-not-allowed disabled:text-gray-400 dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
                  />
                  <!-- Email -->
                  <input
                    v-else-if="inputType(field) === 'email'"
                    :id="field.name"
                    v-model="formValues[field.name]"
                    type="email"
                    :disabled="field.readOnly"
                    :required="field.attr.required"
                    placeholder="email@example.com"
                    class="w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none disabled:cursor-not-allowed disabled:text-gray-400 dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
                  />
                  <!-- Password -->
                  <input
                    v-else-if="inputType(field) === 'password'"
                    :id="field.name"
                    v-model="formValues[field.name]"
                    type="password"
                    :disabled="field.readOnly"
                    :placeholder="isEdit ? 'Leave blank to keep current' : ''"
                    class="w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
                  />
                  <!-- Number -->
                  <input
                    v-else-if="inputType(field) === 'number'"
                    :id="field.name"
                    v-model.number="formValues[field.name]"
                    type="number"
                    :disabled="field.readOnly"
                    :required="field.attr.required"
                    placeholder="0"
                    class="w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none disabled:cursor-not-allowed disabled:text-gray-400 dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
                  />
                  <!-- Select (isIn) -->
                  <select
                    v-else-if="inputType(field) === 'select'"
                    :id="field.name"
                    v-model="formValues[field.name]"
                    :disabled="field.readOnly"
                    :required="field.attr.required"
                    class="w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 focus:border-brand focus:outline-none disabled:cursor-not-allowed disabled:text-gray-400 dark:border-gray-700 dark:text-white"
                  >
                    <option value="">Select...</option>
                    <option v-for="opt in field.attr.isIn" :key="opt" :value="opt">{{ opt }}</option>
                  </select>
                  <!-- BelongsTo -->
                  <select
                    v-else-if="inputType(field) === 'belongsTo'"
                    :id="field.name"
                    v-model="formValues[field.name]"
                    :disabled="field.readOnly"
                    class="w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 focus:border-brand focus:outline-none disabled:cursor-not-allowed disabled:text-gray-400 dark:border-gray-700 dark:text-white"
                  >
                    <option value="">None</option>
                    <option v-for="opt in (assocOptions[field.name] || [])" :key="opt.id" :value="opt.id">{{ opt.label }}</option>
                  </select>
                </div>
              </div>

              <!-- Toggle (boolean) -->
              <div v-else-if="inputType(field) === 'toggle'" class="flex items-center gap-4 px-4 py-3">
                <label :for="field.name" class="w-40 shrink-0 text-sm font-medium text-gray-700 dark:text-gray-300">
                  {{ field.name }}
                </label>
                <div class="flex items-center gap-3">
                  <button
                    type="button"
                    :disabled="field.readOnly"
                    @click="formValues[field.name] = !formValues[field.name]"
                    :class="[
                      'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-gray-300 focus:ring-offset-2 dark:focus:ring-gray-600 dark:focus:ring-offset-gray-900',
                      formValues[field.name] ? 'bg-gray-900 dark:bg-white' : 'bg-gray-300 dark:bg-gray-600',
                      field.readOnly ? 'cursor-not-allowed opacity-50' : ''
                    ]"
                  >
                    <span :class="['pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out dark:bg-gray-900', formValues[field.name] ? 'translate-x-4' : 'translate-x-0']"></span>
                  </button>
                  <span class="text-sm text-gray-500 dark:text-gray-400">{{ formValues[field.name] ? 'Yes' : 'No' }}</span>
                </div>
              </div>

              <!-- Rich text / Long text -->
              <div v-else-if="inputType(field) === 'richtext'" class="px-4 py-3">
                <label :for="field.name" class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {{ field.name }}
                  <span v-if="field.attr.required" class="text-red-500">*</span>
                </label>
                <textarea
                  :id="field.name"
                  v-model="formValues[field.name]"
                  :disabled="field.readOnly"
                  :required="field.attr.required"
                  placeholder="Write your content here..."
                  class="w-full resize-none border-b border-dashed border-gray-200 bg-transparent px-1 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none disabled:cursor-not-allowed disabled:text-gray-400 dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
                  style="field-sizing: content"
                ></textarea>
              </div>

              <!-- JSON -->
              <div v-else-if="inputType(field) === 'json'" class="px-4 py-3">
                <label :for="field.name" class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {{ field.name }}
                  <span class="ml-1 text-xs font-normal text-gray-400">JSON</span>
                </label>
                <textarea
                  :id="field.name"
                  v-model="formValues[field.name]"
                  :disabled="field.readOnly"
                  @blur="validateJson(field.name)"
                  placeholder="{}"
                  class="w-full resize-none border-b border-dashed border-gray-200 bg-transparent px-1 py-2 font-mono text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none disabled:cursor-not-allowed disabled:text-gray-400 dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
                  style="field-sizing: content"
                ></textarea>
                <p v-if="formErrors[field.name]" class="mt-1 text-xs text-red-600 dark:text-red-400">{{ formErrors[field.name] }}</p>
              </div>

              <!-- Fallback -->
              <div v-else class="flex items-center gap-4 px-4 py-3">
                <label :for="field.name" class="w-40 shrink-0 text-sm font-medium text-gray-700 dark:text-gray-300">{{ field.name }}</label>
                <input
                  :id="field.name"
                  v-model="formValues[field.name]"
                  type="text"
                  :disabled="field.readOnly"
                  class="w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none disabled:cursor-not-allowed disabled:text-gray-400 dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
                />
              </div>
            </div>
          </div>

          <!-- Actions -->
          <div class="mt-6 flex items-center justify-end gap-3">
            <Link
              :href="isEdit ? recordUrl() : modelUrl()"
              class="rounded-md px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
            >
              Cancel
            </Link>
            <button
              type="submit"
              :disabled="form.processing"
              class="inline-flex items-center rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
            >
              <SlippyLoader v-if="form.processing" size="h-4 w-4" class="mr-2" />
              {{ isEdit ? 'Save changes' : 'Create record' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
