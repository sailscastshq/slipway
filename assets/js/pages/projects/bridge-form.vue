<script setup>
import { Link, Head, useForm } from '@inertiajs/vue3'
import { inject, ref, computed, onMounted } from 'vue'
import BridgePageLayout from '@/layouts/BridgePageLayout.vue'
import ToastContainer from '@/components/ToastContainer.vue'
import { createToast } from '@/composables/toast'
import SlippyLoader from '@/components/SlippyLoader.vue'
import BridgeFieldInput from '@/components/bridge/BridgeFieldInput.vue'
import {
  prepareBridgeFieldSubmission,
  toBridgeFieldInputValue,
  validateBridgeFieldValue
} from '@/lib/bridge/fields.mjs'
import { containsRawHtml } from '@/lib/content/markdown.mjs'
import { usePrecognitionValidation } from '@/composables/precognition'
import BridgePageHeader from '@/components/bridge/BridgePageHeader.vue'

defineOptions({
  layout: BridgePageLayout
})

const props = defineProps({
  project: Object,
  environment: Object,
  app: Object,
  appScoped: Boolean,
  bridgeRequestBasePath: String,
  bridgeRequestApiBasePath: String,
  hostBridgeOrigin: Boolean,
  bridgeWorkspace: Object,
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
const bridgeBasePath = computed(
  () =>
    props.bridgeRequestBasePath ||
    (props.appScoped && props.app?.slug
      ? `/projects/${props.project.slug}/environments/${props.environment.slug}/apps/${props.app.slug}/bridge`
      : `/projects/${props.project.slug}/environments/${props.environment.slug}/bridge`)
)
const bridgeApiBasePath = computed(
  () =>
    props.bridgeRequestApiBasePath ||
    (props.appScoped && props.app?.slug
      ? `/api/v1/projects/${props.project.slug}/environments/${props.environment.slug}/apps/${props.app.slug}/bridge`
      : `/api/v1/projects/${props.project.slug}/environments/${props.environment.slug}/bridge`)
)

const isEdit = computed(() => props.mode === 'edit')
const actionUrl = computed(() =>
  isEdit.value
    ? `${bridgeBasePath.value}/${props.modelIdentity}/${encodePathSegment(
        props.recordId
      )}/update`
    : `${bridgeBasePath.value}/${props.modelIdentity}/create`
)

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
  .withPrecognition('post', () => actionUrl.value)
  .setValidationTimeout(350)
const { revalidateWhenInvalid } = usePrecognitionValidation(form)

// Initialize form values from props
onMounted(() => {
  if (!props.modelMeta) return

  const values = {}
  const surface = isEdit.value ? props.modelMeta.edit : props.modelMeta.create
  for (const name of surface || []) {
    const attr = props.modelMeta.attributes[name]
    if (!attr) continue
    values[name] = toBridgeFieldInputValue(attr, undefined)
  }

  // Load record values in edit mode
  if (isEdit.value && props.record) {
    for (const name of Object.keys(values)) {
      if (props.record[name] !== undefined) {
        const attr = props.modelMeta.attributes[name]
        values[name] = attr?.encrypt
          ? ''
          : toBridgeFieldInputValue(attr, props.record[name])
      }
    }
  }

  formValues.value = values
  form.values = values
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
  if (field.readOnly) return true
  return validateField(field) === ''
}

const hasBridgeFieldErrors = computed(() =>
  Object.keys(form.errors).some((field) => field.startsWith('values.'))
)
const isFormReady = computed(
  () =>
    editableFields.value.every(hasRequiredValue) &&
    Object.keys(formErrors.value).length === 0 &&
    !hasBridgeFieldErrors.value
)

function serverFieldName(field) {
  return `values.${field.name}`
}

function validateField(field) {
  const attr = field.attr
  const scopeError = relationshipScopeError(field)
  if (scopeError) return scopeError
  if (
    attr.field?.type === 'richtext' &&
    attr.field?.format?.toLowerCase() === 'markdown' &&
    containsRawHtml(String(formValues.value[field.name] || ''))
  ) {
    return 'Raw HTML is not allowed in Bridge Markdown fields.'
  }
  return validateBridgeFieldValue({
    attribute: attr,
    value: formValues.value[field.name],
    isEdit: isEdit.value
  })
}

function relationshipScopeError(field) {
  if (!field.attr.isBelongsTo) return ''
  const value = formValues.value[field.name]
  const selected = (props.assocOptions?.[field.name] || []).find(
    (option) => String(option.id) === String(value)
  )
  if (!selected?.outOfScope) return ''
  return `${field.attr.label || field.name} is outside the available choices.`
}

function validateAndRemember(field, validateOnServer = true) {
  const error = validateField(field)
  const fieldName = serverFieldName(field)
  if (error) {
    formErrors.value[field.name] = error
    form.clearErrors(fieldName)
    return
  }

  delete formErrors.value[field.name]
  if (validateOnServer) form.validate(fieldName)
}

function updateField(field, value) {
  const previous = formValues.value[field.name]
  formValues.value[field.name] = value
  if (!sameRelationshipValue(previous, value)) {
    clearDependentRelationshipValues(field.name)
  }
  if (formErrors.value[serverFieldName(field)]) {
    validateAndRemember(field, false)
  }
  revalidateWhenInvalid(serverFieldName(field))
}

function clearDependentRelationshipValues(sourceField) {
  const queue = [sourceField]
  const cleared = new Set()

  while (queue.length > 0) {
    const source = queue.shift()
    for (const candidate of editableFields.value) {
      if (
        cleared.has(candidate.name) ||
        !relationshipDependencyFields(candidate).includes(source)
      ) {
        continue
      }
      cleared.add(candidate.name)
      if (hasRelationshipValue(formValues.value[candidate.name])) {
        formValues.value[candidate.name] = ''
        clearFieldError(candidate)
      }
      queue.push(candidate.name)
    }
  }
}

function sameRelationshipValue(left, right) {
  if (!hasRelationshipValue(left) && !hasRelationshipValue(right)) return true
  return String(left) === String(right)
}

function hasRelationshipValue(value) {
  return value !== undefined && value !== null && value !== ''
}

function clearFieldError(field) {
  delete formErrors.value[serverFieldName(field)]
  form.clearErrors(serverFieldName(field))
}

function handleSubmit() {
  for (const field of editableFields.value) validateAndRemember(field, false)
  if (!isFormReady.value) {
    toast({ message: 'Complete the required fields first.', type: 'error' })
    return
  }

  const values = {}
  for (const field of editableFields.value) {
    if (field.readOnly) continue
    const prepared = prepareBridgeFieldSubmission({
      attribute: field.attr,
      value: formValues.value[field.name],
      isEdit: isEdit.value
    })
    if (prepared.include) values[field.name] = prepared.value
  }

  form.values = values
  form.post(actionUrl.value, {
    onSuccess: () => {
      toast({
        message: isEdit.value ? 'Record updated.' : 'Record created.',
        type: 'success'
      })
    },
    onError: (errors) => {
      if (errors.error) {
        toast({ message: errors.error, type: 'error' })
      }
    }
  })
}

function uploadUrl(field) {
  return `${bridgeBasePath.value}/${props.modelIdentity}/${field.name}/upload`
}

function relationshipSearchUrl(field) {
  if (!field.attr.isBelongsTo) return ''
  const dependencies = relationshipDependencyFields(field)
  const dependencyValues = {}
  for (const dependency of dependencies) {
    const value = formValues.value[dependency]
    if (!hasRelationshipValue(value)) return ''
    dependencyValues[dependency] = value
  }
  const params = new URLSearchParams({
    surface: isEdit.value ? 'edit' : 'create'
  })
  if (dependencies.length > 0) {
    params.set('dependencies', JSON.stringify(dependencyValues))
  }
  if (isEdit.value && props.recordId !== null) {
    params.set('recordId', String(props.recordId))
  }
  return `${bridgeApiBasePath.value}/${
    props.modelIdentity
  }/relationships/${encodePathSegment(field.name)}/options?${params.toString()}`
}

function relationshipDependencyFields(field) {
  return Object.values(field.attr.field?.relation?.where || {})
    .map((constraint) => constraint?.fromField)
    .filter(Boolean)
}

function relationshipDisabledReason(field) {
  const dependency = relationshipDependencyFields(field).find(
    (name) => !hasRelationshipValue(formValues.value[name])
  )
  if (!dependency) return ''
  const label = props.modelMeta?.attributes?.[dependency]?.label || dependency
  return `Choose ${label.toLowerCase()} first`
}

function relationshipSearchPlaceholder(field) {
  const dependency = relationshipDependencyFields(field)[0]
  if (!dependency) return ''
  const sourceLabel =
    props.modelMeta?.attributes?.[dependency]?.label || dependency
  return `Search ${(
    field.attr.label || field.name
  ).toLowerCase()} in this ${sourceLabel.toLowerCase()}…`
}

function relationshipEmptyText(field) {
  const dependency = relationshipDependencyFields(field)[0]
  if (!dependency) return ''
  const sourceLabel =
    props.modelMeta?.attributes?.[dependency]?.label || dependency
  return `No ${(
    field.attr.label || field.name
  ).toLowerCase()} available for this ${sourceLabel.toLowerCase()}`
}

function bridgeUrl() {
  return bridgeBasePath.value
}
function modelUrl() {
  return `${bridgeBasePath.value}/${props.modelIdentity}`
}
function recordUrl() {
  return `${bridgeBasePath.value}/${props.modelIdentity}/${encodePathSegment(
    props.recordId
  )}`
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
    <BridgePageHeader
      v-if="hostBridgeOrigin"
      :project="project"
      :environment="environment"
      :app="app"
      :host-bridge-origin="true"
      :breadcrumbs="[
        { label: 'bridge', href: bridgeUrl() },
        { label: modelMeta?.label || modelIdentity, href: modelUrl() },
        {
          label: isEdit ? displayIdentifier(recordId) : 'new',
          title: isEdit ? String(recordId) : 'New record'
        }
      ]"
    />

    <!-- Operator header -->
    <div
      v-else
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
          <template v-if="!hostBridgeOrigin">
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
          </template>
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
            <BridgeFieldInput
              v-for="field in editableFields"
              :key="field.name"
              :field="field"
              :model-value="formValues[field.name]"
              :error="
                relationshipScopeError(field) ||
                formErrors[serverFieldName(field)] ||
                form.errors[serverFieldName(field)] ||
                ''
              "
              :is-edit="isEdit"
              :model-identity="modelIdentity"
              :record-id="recordId"
              :association-options="assocOptions[field.name] || []"
              :association-search-url="relationshipSearchUrl(field)"
              :association-disabled-reason="relationshipDisabledReason(field)"
              :association-search-placeholder="
                relationshipSearchPlaceholder(field)
              "
              :association-empty-text="relationshipEmptyText(field)"
              :resource-relationships="modelMeta.relationships || {}"
              :upload-url="uploadUrl(field)"
              :upload-values="formValues"
              @update:model-value="updateField(field, $event)"
              @blur="validateAndRemember(field)"
              @clear-error="clearFieldError(field)"
            />
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
