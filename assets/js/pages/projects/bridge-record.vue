<script setup>
import { Link, Head, useForm } from '@inertiajs/vue3'
import { inject, ref, computed } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import ToastContainer from '@/components/ToastContainer.vue'
import { createToast } from '@/composables/toast'

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
  error: String
})

const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')
const { toasts, toast, dismiss } = createToast()

const deleteModal = ref({ show: false })
const deleteForm = useForm({})

// Categorize attributes
const regularAttrs = computed(() => {
  if (!props.modelMeta) return []
  return Object.entries(props.modelMeta.attributes).filter(
    ([, attr]) => !attr.model
  )
})

const modelAssociations = computed(() => {
  if (!props.modelMeta) return []
  return (props.modelMeta.associations || []).filter((a) => a.type === 'model')
})

const collectionAssociations = computed(() => {
  if (!props.modelMeta) return []
  return (props.modelMeta.associations || []).filter(
    (a) => a.type === 'collection'
  )
})

function formatValue(value, attr) {
  if (value === null || value === undefined)
    return { display: 'null', isNull: true }
  if (attr?.autoCreatedAt || attr?.autoUpdatedAt) {
    try {
      const d = new Date(value)
      return {
        display: d.toLocaleString(undefined, {
          dateStyle: 'long',
          timeStyle: 'medium'
        }),
        isNull: false
      }
    } catch {
      /* fall through */
    }
  }
  if (attr?.type === 'boolean')
    return { display: value, isBoolean: true, isNull: false }
  if (attr?.encrypt)
    return { display: '(encrypted)', isEncrypted: true, isNull: false }
  if (attr?.type === 'json' || typeof value === 'object') {
    return {
      display: JSON.stringify(value, null, 2),
      isJson: true,
      isNull: false
    }
  }
  return { display: String(value), isNull: false }
}

function collectionRecords(alias) {
  if (!props.record || !props.record[alias]) return []
  const data = props.record[alias]
  return Array.isArray(data) ? data.slice(0, 5) : []
}

function collectionCount(alias) {
  if (!props.record || !props.record[alias]) return 0
  const data = props.record[alias]
  return Array.isArray(data) ? data.length : 0
}

function confirmDelete() {
  deleteForm.post(
    `/projects/${props.project.slug}/environments/${props.environment.slug}/bridge/${props.modelIdentity}/${props.recordId}/delete`,
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
  return `/projects/${props.project.slug}/environments/${props.environment.slug}/bridge/${props.modelIdentity}/${props.recordId}/edit`
}
function relatedRecordUrl(model, id) {
  return `/projects/${props.project.slug}/environments/${props.environment.slug}/bridge/${model}/${id}`
}
</script>

<template>
  <Head :title="`${modelIdentity} #${recordId} - Bridge | Slipway`"></Head>
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
            modelIdentity
          }}</Link>
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <span class="font-medium text-gray-900 dark:text-white"
            >#{{ recordId }}</span
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
            >{{ modelIdentity }}</Link
          >
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <span class="font-medium text-gray-900 dark:text-white"
            >#{{ recordId }}</span
          >
        </nav>
      </div>
      <div v-if="record" class="flex items-center space-x-2">
        <Link
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
        <div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <!-- Left: Attributes -->
          <div class="lg:col-span-2">
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
                    {{ name }}
                  </dt>
                  <dd
                    class="min-w-0 flex-1 text-sm text-gray-900 dark:text-white"
                  >
                    <template v-if="formatValue(record[name], attr).isNull">
                      <span class="text-gray-300 dark:text-gray-600">null</span>
                    </template>
                    <template
                      v-else-if="formatValue(record[name], attr).isBoolean"
                    >
                      <span
                        :class="[
                          'inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
                          record[name]
                            ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400'
                            : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                        ]"
                      >
                        {{ record[name] }}
                      </span>
                    </template>
                    <template
                      v-else-if="formatValue(record[name], attr).isEncrypted"
                    >
                      <span
                        class="inline-flex rounded-full bg-yellow-50 px-2 py-0.5 text-xs font-medium text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400"
                      >
                        encrypted
                      </span>
                    </template>
                    <template
                      v-else-if="formatValue(record[name], attr).isJson"
                    >
                      <pre
                        class="max-h-40 overflow-auto rounded-lg bg-gray-50 p-2 font-mono text-xs dark:bg-gray-950"
                        >{{ formatValue(record[name], attr).display }}</pre
                      >
                    </template>
                    <template v-else>
                      <span class="break-all">{{
                        formatValue(record[name], attr).display
                      }}</span>
                    </template>
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
                    {{ assoc.alias }}
                    <span
                      class="block text-xs font-normal text-gray-400 dark:text-gray-500"
                      >→ {{ assoc.model }}</span
                    >
                  </dt>
                  <dd class="min-w-0 flex-1 text-sm">
                    <template
                      v-if="
                        record[assoc.alias] === null ||
                        record[assoc.alias] === undefined
                      "
                    >
                      <span class="text-gray-300 dark:text-gray-600">null</span>
                    </template>
                    <Link
                      v-else
                      :href="relatedRecordUrl(assoc.model, record[assoc.alias])"
                      class="font-medium text-gray-900 hover:underline dark:text-white"
                    >
                      {{ assoc.model }} #{{ record[assoc.alias] }}
                    </Link>
                  </dd>
                </div>
              </dl>
            </div>
          </div>

          <!-- Right: Collection associations -->
          <div class="space-y-4">
            <div
              v-for="assoc in collectionAssociations"
              :key="assoc.alias"
              class="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
            >
              <div
                class="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800"
              >
                <h3 class="text-sm font-semibold text-gray-900 dark:text-white">
                  {{ assoc.alias }}
                  <span
                    class="ml-1 text-xs font-normal text-gray-400 dark:text-gray-500"
                    >({{ collectionCount(assoc.alias) }})</span
                  >
                </h3>
                <Link
                  v-if="collectionCount(assoc.alias) > 0"
                  :href="`${bridgeUrl()}/${assoc.collection}`"
                  class="text-xs text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                >
                  View all
                </Link>
              </div>
              <div
                v-if="collectionRecords(assoc.alias).length === 0"
                class="px-4 py-6 text-center text-xs text-gray-400 dark:text-gray-500"
              >
                No related records
              </div>
              <ul v-else class="divide-y divide-gray-100 dark:divide-gray-800">
                <li
                  v-for="(related, i) in collectionRecords(assoc.alias)"
                  :key="i"
                  class="px-4 py-2"
                >
                  <Link
                    :href="
                      relatedRecordUrl(
                        assoc.collection,
                        related.id || related[Object.keys(related)[0]]
                      )
                    "
                    class="text-sm font-medium text-gray-900 hover:underline dark:text-white"
                  >
                    #{{ related.id || related[Object.keys(related)[0]] }}
                  </Link>
                  <span
                    v-if="related.name || related.title || related.email"
                    class="ml-2 text-xs text-gray-500 dark:text-gray-400"
                  >
                    {{ related.name || related.title || related.email }}
                  </span>
                </li>
              </ul>
            </div>

            <!-- Empty state for no associations -->
            <div
              v-if="collectionAssociations.length === 0"
              class="rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center dark:border-gray-800"
            >
              <p class="text-xs text-gray-400 dark:text-gray-500">
                No collection associations
              </p>
            </div>
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
