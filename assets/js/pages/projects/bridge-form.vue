<script setup>
import { Link, Head, router } from '@inertiajs/vue3'
import { inject, ref, computed, onMounted, watch } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'
import ToastContainer from '@/components/ToastContainer.vue'
import { createToast } from '@/composables/toast'
import { useBridge } from '@/composables/bridge'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  project: Object,
  environment: Object,
  mode: String, // 'create' or 'edit'
  modelIdentity: String,
  recordId: String,
  appRunning: Boolean
})

const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')
const { toasts, toast, dismiss } = createToast()
const { fetchModels, fetchRecord, fetchRecords, createRecord, updateRecord } = useBridge()

const isEdit = computed(() => props.mode === 'edit')

// Model metadata
const modelMeta = ref(null)
const loading = ref(true)
const error = ref(null)

// Form state
const formValues = ref({})
const saving = ref(false)
const formErrors = ref({})

// Association options (for model: belongsTo selects)
const assocOptions = ref({}) // { alias: [{ id, label }] }

// Editable fields
const editableFields = computed(() => {
  if (!modelMeta.value) return []
  const fields = []

  for (const [name, attr] of Object.entries(modelMeta.value.attributes)) {
    // Skip auto-increment (always hidden)
    if (attr.autoIncrement) continue

    // Skip collections (not shown in forms)
    // (collections are in associations, not attributes)

    // In create mode, hide timestamps
    if (!isEdit.value && (attr.autoCreatedAt || attr.autoUpdatedAt)) continue

    fields.push({ name, attr, readOnly: attr.autoCreatedAt || attr.autoUpdatedAt })
  }

  // Add model associations (belongsTo)
  for (const assoc of (modelMeta.value.associations || [])) {
    if (assoc.type !== 'model') continue
    const attr = modelMeta.value.attributes[assoc.alias]
    fields.push({
      name: assoc.alias,
      attr: { ...attr, isBelongsTo: true, relatedModel: assoc.model },
      readOnly: false
    })
  }

  return fields
})

function inputType(attr) {
  if (attr.isBelongsTo) return 'belongsTo'
  if (attr.encrypt) return 'password'
  if (attr.isEmail) return 'email'
  if (attr.isIn && attr.isIn.length > 0) return 'select'
  if (attr.type === 'string' && attr.columnType === 'text') return 'textarea'
  if (attr.type === 'string') return 'text'
  if (attr.type === 'number') return 'number'
  if (attr.type === 'boolean') return 'toggle'
  if (attr.type === 'json') return 'json'
  return 'text'
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

async function loadMeta() {
  loading.value = true
  error.value = null
  try {
    const data = await fetchModels()
    const model = (data.models || {})[props.modelIdentity]
    if (!model) {
      error.value = `Model "${props.modelIdentity}" not found.`
      return
    }
    modelMeta.value = model

    // Initialize form values
    const values = {}
    for (const [name, attr] of Object.entries(model.attributes)) {
      if (attr.autoIncrement) continue
      if (attr.type === 'boolean') values[name] = attr.defaultsTo ?? false
      else if (attr.type === 'json') values[name] = attr.defaultsTo !== undefined ? JSON.stringify(attr.defaultsTo, null, 2) : ''
      else values[name] = attr.defaultsTo ?? ''
    }
    formValues.value = values

    // Load existing record values in edit mode
    if (isEdit.value && props.recordId) {
      const recordData = await fetchRecord(props.modelIdentity, props.recordId)
      const record = recordData.record
      if (record) {
        for (const name of Object.keys(values)) {
          if (record[name] !== undefined) {
            const attr = model.attributes[name]
            if (attr?.type === 'json' && typeof record[name] === 'object') {
              values[name] = JSON.stringify(record[name], null, 2)
            } else if (attr?.encrypt) {
              values[name] = '' // Don't pre-fill encrypted fields
            } else {
              values[name] = record[name]
            }
          }
        }
        formValues.value = values
      }
    }

    // Load association options for belongsTo
    const modelAssocs = (model.associations || []).filter(a => a.type === 'model')
    for (const assoc of modelAssocs) {
      try {
        const data = await fetchRecords(assoc.model, { perPage: 100 })
        const records = data.records || []
        assocOptions.value[assoc.alias] = records.map(r => ({
          id: r.id,
          label: r.name || r.title || r.email || `#${r.id}`
        }))
      } catch {
        assocOptions.value[assoc.alias] = []
      }
    }
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

async function handleSubmit() {
  // Check for JSON validation errors
  if (Object.keys(formErrors.value).length > 0) {
    toast({ message: 'Please fix validation errors.', type: 'error' })
    return
  }

  saving.value = true
  try {
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
      if (attr.encrypt && val === '') continue // Don't send empty encrypted fields on edit

      // Skip empty strings for non-required fields (to allow null)
      if (val === '' && !attr.required && attr.type !== 'string') {
        val = null
      }

      values[name] = val
    }

    if (isEdit.value) {
      await updateRecord(props.modelIdentity, props.recordId, values)
      toast({ message: 'Record updated.', type: 'success' })
      router.visit(recordUrl())
    } else {
      const result = await createRecord(props.modelIdentity, values)
      toast({ message: 'Record created.', type: 'success' })
      const pk = modelMeta.value.primaryKey
      const newId = result.record?.[pk]
      if (newId) {
        router.visit(`${modelUrl()}/${newId}`)
      } else {
        router.visit(modelUrl())
      }
    }
  } catch (e) {
    toast({ message: e.message, type: 'error' })
  } finally {
    saving.value = false
  }
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

onMounted(loadMeta)
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
    <div class="flex-1 overflow-y-auto">
      <!-- Loading -->
      <div v-if="loading" class="flex h-full items-center justify-center">
        <svg class="h-6 w-6 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>

      <!-- Error -->
      <div v-else-if="error" class="flex h-full items-center justify-center">
        <p class="text-sm text-red-600 dark:text-red-400">{{ error }}</p>
      </div>

      <!-- Form -->
      <div v-else class="mx-auto max-w-2xl p-4 sm:p-6">
        <form @submit.prevent="handleSubmit" class="space-y-5">
          <div v-for="field in editableFields" :key="field.name">
            <label class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {{ field.name }}
              <span v-if="field.attr.required" class="text-red-500">*</span>
              <span v-if="field.readOnly" class="ml-1 text-xs font-normal text-gray-400">(read-only)</span>
            </label>

            <!-- Text input -->
            <input
              v-if="inputType(field.attr) === 'text'"
              v-model="formValues[field.name]"
              type="text"
              :disabled="field.readOnly"
              :required="field.attr.required"
              :maxlength="field.attr.maxLength || undefined"
              :placeholder="field.attr.defaultsTo !== undefined ? `Default: ${field.attr.defaultsTo}` : ''"
              class="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-gray-300 focus:outline-none focus:ring-1 focus:ring-gray-300 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:placeholder-gray-500 dark:focus:border-gray-600 dark:focus:ring-gray-600 dark:disabled:bg-gray-800 dark:disabled:text-gray-400"
            />

            <!-- Email input -->
            <input
              v-else-if="inputType(field.attr) === 'email'"
              v-model="formValues[field.name]"
              type="email"
              :disabled="field.readOnly"
              :required="field.attr.required"
              class="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-gray-300 focus:outline-none focus:ring-1 focus:ring-gray-300 disabled:cursor-not-allowed disabled:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:placeholder-gray-500 dark:focus:border-gray-600 dark:focus:ring-gray-600"
            />

            <!-- Password input -->
            <input
              v-else-if="inputType(field.attr) === 'password'"
              v-model="formValues[field.name]"
              type="password"
              :disabled="field.readOnly"
              :placeholder="isEdit ? 'Leave blank to keep current value' : ''"
              class="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-gray-300 focus:outline-none focus:ring-1 focus:ring-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:placeholder-gray-500 dark:focus:border-gray-600 dark:focus:ring-gray-600"
            />

            <!-- Number input -->
            <input
              v-else-if="inputType(field.attr) === 'number'"
              v-model.number="formValues[field.name]"
              type="number"
              :disabled="field.readOnly"
              :required="field.attr.required"
              class="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-gray-300 focus:outline-none focus:ring-1 focus:ring-gray-300 disabled:cursor-not-allowed disabled:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:placeholder-gray-500 dark:focus:border-gray-600 dark:focus:ring-gray-600 dark:disabled:bg-gray-800"
            />

            <!-- Textarea -->
            <textarea
              v-else-if="inputType(field.attr) === 'textarea'"
              v-model="formValues[field.name]"
              :disabled="field.readOnly"
              :required="field.attr.required"
              rows="4"
              class="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-gray-300 focus:outline-none focus:ring-1 focus:ring-gray-300 disabled:cursor-not-allowed disabled:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:placeholder-gray-500 dark:focus:border-gray-600 dark:focus:ring-gray-600"
            ></textarea>

            <!-- Select (isIn) -->
            <select
              v-else-if="inputType(field.attr) === 'select'"
              v-model="formValues[field.name]"
              :disabled="field.readOnly"
              :required="field.attr.required"
              class="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-300 focus:outline-none focus:ring-1 focus:ring-gray-300 disabled:cursor-not-allowed disabled:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:focus:border-gray-600 dark:focus:ring-gray-600"
            >
              <option value="">-- Select --</option>
              <option v-for="opt in field.attr.isIn" :key="opt" :value="opt">{{ opt }}</option>
            </select>

            <!-- Toggle (boolean) -->
            <div v-else-if="inputType(field.attr) === 'toggle'" class="flex items-center">
              <button
                type="button"
                :disabled="field.readOnly"
                @click="formValues[field.name] = !formValues[field.name]"
                :class="[
                  'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-gray-300 focus:ring-offset-2 dark:focus:ring-gray-600 dark:focus:ring-offset-gray-900',
                  formValues[field.name] ? 'bg-gray-900 dark:bg-white' : 'bg-gray-200 dark:bg-gray-700',
                  field.readOnly ? 'cursor-not-allowed opacity-50' : ''
                ]"
              >
                <span
                  :class="[
                    'pointer-events-none inline-block h-4 w-4 transform rounded-full shadow ring-0 transition duration-200 ease-in-out',
                    formValues[field.name] ? 'translate-x-4 bg-white dark:bg-gray-900' : 'translate-x-0 bg-white dark:bg-gray-400'
                  ]"
                ></span>
              </button>
              <span class="ml-2 text-sm text-gray-700 dark:text-gray-300">{{ formValues[field.name] ? 'true' : 'false' }}</span>
            </div>

            <!-- JSON textarea -->
            <div v-else-if="inputType(field.attr) === 'json'">
              <textarea
                v-model="formValues[field.name]"
                :disabled="field.readOnly"
                rows="6"
                @blur="validateJson(field.name)"
                class="w-full rounded-md border border-gray-200 bg-white px-3 py-2 font-mono text-sm text-gray-900 placeholder-gray-400 focus:border-gray-300 focus:outline-none focus:ring-1 focus:ring-gray-300 disabled:cursor-not-allowed disabled:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:placeholder-gray-500 dark:focus:border-gray-600 dark:focus:ring-gray-600"
                placeholder="{}"
              ></textarea>
              <p v-if="formErrors[field.name]" class="mt-1 text-xs text-red-600 dark:text-red-400">
                {{ formErrors[field.name] }}
              </p>
            </div>

            <!-- BelongsTo select -->
            <select
              v-else-if="inputType(field.attr) === 'belongsTo'"
              v-model="formValues[field.name]"
              :disabled="field.readOnly"
              class="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-300 focus:outline-none focus:ring-1 focus:ring-gray-300 disabled:cursor-not-allowed disabled:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:focus:border-gray-600 dark:focus:ring-gray-600"
            >
              <option value="">-- None --</option>
              <option
                v-for="opt in (assocOptions[field.name] || [])"
                :key="opt.id"
                :value="opt.id"
              >
                {{ opt.label }}
              </option>
            </select>

            <!-- Fallback text -->
            <input
              v-else
              v-model="formValues[field.name]"
              type="text"
              :disabled="field.readOnly"
              class="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-gray-300 focus:outline-none focus:ring-1 focus:ring-gray-300 disabled:cursor-not-allowed disabled:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:placeholder-gray-500 dark:focus:border-gray-600 dark:focus:ring-gray-600"
            />
          </div>

          <!-- Actions -->
          <div class="flex items-center justify-end space-x-3 border-t border-gray-200 pt-5 dark:border-gray-800">
            <Link
              :href="isEdit ? recordUrl() : modelUrl()"
              class="rounded-md border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              Cancel
            </Link>
            <button
              type="submit"
              :disabled="saving"
              class="inline-flex items-center rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
            >
              <svg v-if="saving" class="mr-2 h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              {{ isEdit ? 'Save changes' : 'Create record' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
