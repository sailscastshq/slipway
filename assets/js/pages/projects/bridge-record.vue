<script setup>
import { Link, Head, useForm } from '@inertiajs/vue3'
import { inject, ref, computed } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import ToastContainer from '@/components/ToastContainer.vue'
import { createToast } from '@/composables/toast'
import BridgeFieldValue from '@/components/bridge/BridgeFieldValue.vue'
import BridgeCollectionManager from '@/components/bridge/BridgeCollectionManager.vue'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  project: Object,
  environment: Object,
  modelIdentity: String,
  recordId: String,
  appRunning: Boolean,
  modelMeta: Object,
  record: Object,
  relationships: Object,
  error: String
})

const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')
const { toasts, toast, dismiss } = createToast()

const deleteModal = ref({ show: false })
const deleteForm = useForm({})

function encodePathSegment(value) {
  return encodeURIComponent(String(value))
}

function displayIdentifier(value) {
  const identifier = String(value ?? '')
  if (identifier.length <= 24) return identifier
  return `${identifier.slice(0, 10)}…${identifier.slice(-6)}`
}

// Categorize attributes
const regularAttrs = computed(() => {
  if (!props.modelMeta) return []
  return (props.modelMeta.show || [])
    .map((name) => [name, props.modelMeta.attributes[name]])
    .filter(([, attr]) => attr && !attr.model)
})

const modelAssociations = computed(() => {
  return Object.values(props.relationships || {}).filter(
    (relationship) => relationship.type === 'model'
  )
})

const collectionAssociations = computed(() => {
  return Object.values(props.relationships || {}).filter(
    (relationship) => relationship.type === 'collection'
  )
})

function fieldLabel(name) {
  return props.modelMeta?.attributes[name]?.label || name
}

function confirmDelete() {
  deleteForm.post(
    `/projects/${props.project.slug}/environments/${
      props.environment.slug
    }/bridge/${props.modelIdentity}/${encodePathSegment(
      props.recordId
    )}/delete`,
    {
      onSuccess: () => {
        toast({ message: 'Record deleted.', type: 'success' })
      },
      onError: (errors) => {
        toast({
          message: errors.error || 'Failed to delete record',
          type: 'error'
        })
      }
    }
  )
}

function bridgeUrl() {
  return `/projects/${props.project.slug}/environments/${props.environment.slug}/bridge`
}
function modelUrl() {
  return `/projects/${props.project.slug}/environments/${props.environment.slug}/bridge/${props.modelIdentity}`
}
function editUrl() {
  return `/projects/${props.project.slug}/environments/${
    props.environment.slug
  }/bridge/${props.modelIdentity}/${encodePathSegment(props.recordId)}/edit`
}
function relatedRecordUrl(model, id) {
  return `/projects/${props.project.slug}/environments/${
    props.environment.slug
  }/bridge/${model}/${encodePathSegment(id)}`
}

function relationshipOptionsUrl(relationship) {
  const params = new URLSearchParams({
    surface: 'manage',
    recordId: String(props.recordId)
  })
  return `/api/v1/projects/${props.project.slug}/environments/${
    props.environment.slug
  }/bridge/${props.modelIdentity}/relationships/${encodePathSegment(
    relationship.alias
  )}/options?${params.toString()}`
}

function relationshipMutationBaseUrl(relationship) {
  return `/projects/${props.project.slug}/environments/${
    props.environment.slug
  }/bridge/${props.modelIdentity}/${encodePathSegment(
    props.recordId
  )}/relationships/${encodePathSegment(relationship.alias)}`
}
</script>

<template>
  <Head
    :title="`${
      modelMeta?.singularLabel || modelIdentity
    } ${recordId} - Bridge | Slipway`"
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
          <span
            class="max-w-40 truncate font-medium text-gray-900 dark:text-white"
            :title="String(recordId)"
            >{{ displayIdentifier(recordId) }}</span
          >
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
          <span
            class="max-w-48 truncate font-medium text-gray-900 dark:text-white"
            :title="String(recordId)"
            >{{ displayIdentifier(recordId) }}</span
          >
        </nav>
      </div>
      <div v-if="record" class="flex items-center space-x-2">
        <Link
          v-if="modelMeta?.actions?.update !== false"
          :href="editUrl()"
          class="inline-flex items-center rounded-md border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          <svg
            class="mr-1.5 h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
            />
          </svg>
          Edit
        </Link>
        <button
          v-if="modelMeta?.actions?.delete !== false"
          @click="deleteModal.show = true"
          class="inline-flex items-center rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
        >
          <svg
            class="mr-1.5 h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
          </svg>
          Delete
        </button>
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-950">
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

      <!-- Record detail -->
      <div v-else-if="record && modelMeta" class="p-4 sm:p-6">
        <div
          :class="[
            'mx-auto grid max-w-6xl grid-cols-1 gap-6',
            collectionAssociations.length > 0 ? 'lg:grid-cols-3' : ''
          ]"
        >
          <!-- Left: Attributes -->
          <div
            :class="collectionAssociations.length > 0 ? 'lg:col-span-2' : ''"
          >
            <div
              class="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
            >
              <div
                class="border-b border-gray-200 px-4 py-3 dark:border-gray-800"
              >
                <h2 class="text-sm font-semibold text-gray-900 dark:text-white">
                  Attributes
                </h2>
              </div>
              <dl class="divide-y divide-gray-100 dark:divide-gray-800">
                <!-- Regular attributes -->
                <div
                  v-for="[name, attr] in regularAttrs"
                  :key="name"
                  class="flex px-4 py-3"
                >
                  <dt
                    class="w-40 shrink-0 text-sm font-medium text-gray-500 dark:text-gray-400"
                  >
                    {{ fieldLabel(name) }}
                  </dt>
                  <dd
                    class="min-w-0 flex-1 text-sm text-gray-900 dark:text-white"
                  >
                    <BridgeFieldValue
                      :name="name"
                      :attribute="attr"
                      :value="record[name]"
                      context="show"
                    />
                  </dd>
                </div>

                <!-- Model associations (belongs-to) -->
                <div
                  v-for="assoc in modelAssociations"
                  :key="assoc.alias"
                  class="flex px-4 py-3"
                >
                  <dt
                    class="w-40 shrink-0 text-sm font-medium text-gray-500 dark:text-gray-400"
                  >
                    {{ assoc.label }}
                  </dt>
                  <dd class="min-w-0 flex-1 text-sm">
                    <template v-if="!assoc.record">
                      <span class="text-gray-300 dark:text-gray-600">null</span>
                    </template>
                    <Link
                      v-else
                      :href="relatedRecordUrl(assoc.resource, assoc.record.id)"
                      :title="String(assoc.record.id)"
                      class="font-medium text-gray-900 hover:underline dark:text-white"
                    >
                      {{ assoc.record.label }}
                    </Link>
                  </dd>
                </div>
              </dl>
            </div>
          </div>

          <!-- Right: Collection associations -->
          <div
            v-if="collectionAssociations.length > 0"
            class="self-start overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
          >
            <div class="px-4 py-3">
              <h2 class="text-sm font-semibold text-gray-900 dark:text-white">
                Relationships
              </h2>
            </div>
            <section
              v-for="assoc in collectionAssociations"
              :key="assoc.alias"
              class="border-t border-gray-100 dark:border-gray-800"
            >
              <div
                class="flex items-center justify-between gap-3 px-4 pb-2 pt-3"
              >
                <h3 class="text-sm font-medium text-gray-900 dark:text-white">
                  {{ assoc.label }}
                  <span
                    class="ml-1 text-xs font-normal text-gray-400 dark:text-gray-500"
                    >{{ assoc.records.length
                    }}{{ assoc.hasMore ? '+' : '' }}</span
                  >
                </h3>
                <BridgeCollectionManager
                  :relationship="assoc"
                  :options-url="relationshipOptionsUrl(assoc)"
                  :mutation-base-url="relationshipMutationBaseUrl(assoc)"
                />
              </div>
              <div
                v-if="assoc.records.length === 0"
                class="px-4 pb-4 text-xs text-gray-400 dark:text-gray-500"
              >
                No related records
              </div>
              <ul v-else class="pb-2">
                <li
                  v-for="related in assoc.records"
                  :key="String(related.id)"
                  class="px-4 py-1.5"
                >
                  <Link
                    :href="relatedRecordUrl(assoc.identity, related.id)"
                    :title="String(related.id)"
                    class="block min-w-0"
                  >
                    <span
                      class="block truncate text-sm font-medium text-gray-900 hover:underline dark:text-white"
                      >{{ related.label }}</span
                    >
                    <span
                      class="block truncate font-mono text-[11px] text-gray-400 dark:text-gray-500"
                      >{{ displayIdentifier(related.id) }}</span
                    >
                  </Link>
                </li>
              </ul>
            </section>
          </div>
        </div>
      </div>
    </div>
  </div>

  <ConfirmModal
    :show="deleteModal.show"
    title="Delete record"
    message="Are you sure? This action cannot be undone."
    confirm-label="Delete"
    :destructive="true"
    :loading="deleteForm.processing"
    @confirm="confirmDelete"
    @cancel="deleteModal = { show: false }"
  />
</template>
