<script setup>
import Input from '@/components/ui/input/Input.vue'
import { Link, Head, router, useForm } from '@inertiajs/vue3'
import { inject, ref, onMounted, onUnmounted } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'
import Breadcrumb from '@/components/ui/breadcrumb/Breadcrumb.vue'
import ErrorState from '@/components/ui/error-state/ErrorState.vue'
import { usePrecognitionValidation } from '@/composables/precognition'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  project: Object,
  environment: Object,
  hasContentFeature: Boolean,
  contentFeature: Object,
  collections: Array,
  collectionsError: String,
  app: Object
})

const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')

// Modal state
const createModalOpen = ref(false)
const selectedCollection = ref(null)

// Create form
const createForm = useForm({
  contentSlug: '',
  title: '',
  appSlug: props.app.slug
})
  .withPrecognition('post', () => getCreatePath())
  .setValidationTimeout(350)
const { revalidateWhenInvalid, validateOnBlur } =
  usePrecognitionValidation(createForm)

function getCreatePath() {
  const envPath =
    props.environment.slug !== 'production'
      ? `/environments/${props.environment.slug}`
      : ''
  return `/projects/${props.project.slug}${envPath}/content/${selectedCollection.value?.slug}/create`
}

function openCreateModal(collection) {
  selectedCollection.value = collection
  createForm.resetAndClearErrors()
  createModalOpen.value = true
}

function createContent() {
  if (!createForm.contentSlug.trim()) return

  createForm.validate({
    only: ['contentSlug', 'title'],
    onPrecognitionSuccess: () => {
      createForm.post(getCreatePath(), {
        onSuccess: () => {
          createModalOpen.value = false
        }
      })
    }
  })
}

function closeCreateModal() {
  if (!createForm.processing) {
    createModalOpen.value = false
    selectedCollection.value = null
    createForm.resetAndClearErrors()
  }
}

// Handle escape key to close modal
function handleEscapeKey(e) {
  if (e.key === 'Escape') {
    closeCreateModal()
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleEscapeKey)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleEscapeKey)
})

function getEditorPath(collection, file) {
  const basePath =
    props.environment.slug !== 'production'
      ? `/projects/${props.project.slug}/environments/${props.environment.slug}/content`
      : `/projects/${props.project.slug}/content`
  return `${basePath}/${collection}/${file}?appSlug=${props.app.slug}`
}

function refresh() {
  router.reload({ only: ['collections', 'collectionsError'] })
}
</script>
<template>
  <Head :title="`Content - ${project.name} | Slipway`"></Head>
  <div class="flex h-full flex-col">
    <!-- Header -->
    <div
      class="flex items-center justify-between border-b border-gray-200 py-4 pl-4 pr-4 dark:border-gray-800 sm:pl-4 sm:pr-8"
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
        <!-- Desktop sidebar toggle -->
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
        <Breadcrumb
          :items="[
            { label: 'projects', href: '/' },
            {
              label: project.name.toLowerCase(),
              href: `/projects/${project.slug}`
            },
            {
              label: environment.name.toLowerCase(),
              href: `/projects/${project.slug}/environments/${environment.slug}`
            },
            { label: 'content' }
          ]"
        />
      </div>
      <div class="flex items-center space-x-4">
        <a
          href="https://docs.sailscasts.com/slipway/content"
          target="_blank"
          class="flex items-center space-x-1 text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
        >
          <span>Docs</span>
          <svg
            class="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
            />
          </svg>
        </a>
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
      <div class="mx-auto max-w-4xl">
        <!-- Header -->
        <div class="mb-8">
          <h1 class="text-xl font-semibold text-gray-900 dark:text-white">
            Content
          </h1>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Edit markdown content files. Changes require a redeploy to take
            effect.
          </p>
        </div>

        <!-- Feature not available -->
        <div
          v-if="!hasContentFeature"
          class="rounded-lg border border-dashed border-gray-300 px-6 py-12 text-center dark:border-gray-700"
        >
          <svg
            class="mx-auto h-10 w-10 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.5"
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <h3 class="mt-4 text-sm font-medium text-gray-900 dark:text-white">
            sails-content not detected
          </h3>
          <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Deploy your app with
            <code
              class="rounded bg-gray-100 px-1.5 py-0.5 text-xs dark:bg-gray-800"
              >sails-content</code
            >
            installed to enable the Content.
          </p>
          <a
            href="https://docs.sailscasts.com/sails-content"
            target="_blank"
            class="mt-4 inline-flex items-center space-x-1 text-sm text-violet-600 hover:text-violet-500 dark:text-violet-400"
          >
            <span>Learn more</span>
            <svg
              class="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
              />
            </svg>
          </a>
        </div>

        <!-- Error -->
        <ErrorState
          v-else-if="collectionsError"
          as="section"
          aria-labelledby="content-collections-error-title"
          data-test="content-collections-error"
          class="min-h-0 items-start gap-0 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-left dark:border-red-900/50 dark:bg-red-950/20"
        >
          <h2 id="content-collections-error-title" class="sr-only">
            Content collections could not load
          </h2>
          <p class="text-sm text-red-700 dark:text-red-400">
            {{ collectionsError }}
          </p>
          <button
            type="button"
            class="mt-2 cursor-pointer text-sm text-red-600 underline hover:text-red-500 dark:text-red-400"
            @click="refresh"
          >
            Try again
          </button>
        </ErrorState>

        <!-- Collections -->
        <div v-else-if="collections.length > 0" class="space-y-6">
          <div
            v-for="collection in collections"
            :key="collection.slug"
            class="rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950"
          >
            <!-- Collection header -->
            <div
              class="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800"
            >
              <div class="flex items-center space-x-3">
                <svg
                  class="h-5 w-5 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                  />
                </svg>
                <h2 class="text-sm font-medium text-gray-900 dark:text-white">
                  {{ collection.name }}
                </h2>
                <span
                  class="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                >
                  {{ collection.count }}
                  {{ collection.count === 1 ? 'file' : 'files' }}
                </span>
              </div>
              <button
                data-test="content-new-button"
                @click="openCreateModal(collection)"
                class="flex items-center space-x-1 rounded-md px-2 py-1 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
              >
                <svg
                  class="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M12 4v16m8-8H4"
                  />
                </svg>
                <span>New</span>
              </button>
            </div>

            <!-- Files list -->
            <div
              v-if="collection.files.length > 0"
              class="divide-y divide-gray-200 dark:divide-gray-800"
            >
              <Link
                v-for="file in collection.files"
                :key="file.slug"
                :href="getEditorPath(collection.slug, file.slug)"
                class="flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-900/50"
              >
                <div class="flex items-center space-x-3">
                  <svg
                    class="h-4 w-4 text-gray-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                  <span class="text-sm text-gray-900 dark:text-white">{{
                    file.slug
                  }}</span>
                  <span class="text-xs text-gray-400 dark:text-gray-500">{{
                    file.name
                  }}</span>
                </div>
                <svg
                  class="h-4 w-4 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </Link>
            </div>
            <div
              v-else
              class="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400"
            >
              No files in this collection yet.
            </div>
          </div>
        </div>

        <!-- Empty state -->
        <div
          v-else
          class="rounded-lg border border-dashed border-gray-300 px-6 py-12 text-center dark:border-gray-700"
        >
          <svg
            class="mx-auto h-10 w-10 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.5"
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <h3 class="mt-4 text-sm font-medium text-gray-900 dark:text-white">
            No content collections found
          </h3>
          <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Create a
            <code
              class="rounded bg-gray-100 px-1.5 py-0.5 text-xs dark:bg-gray-800"
              >content/</code
            >
            directory with subdirectories for each collection.
          </p>
        </div>
      </div>
    </div>

    <!-- Create Modal -->
    <div
      v-if="createModalOpen"
      class="fixed inset-0 z-50 flex items-center justify-center px-4"
    >
      <div class="fixed inset-0 bg-black/50" @click="closeCreateModal" />
      <div
        data-test="content-create-modal"
        class="relative w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-gray-900"
      >
        <h3 class="text-lg font-semibold text-gray-900 dark:text-white">
          Create new content in {{ selectedCollection?.name }}
        </h3>
        <form @submit.prevent="createContent" class="mt-4 space-y-4">
          <div>
            <label
              class="block text-sm font-medium text-gray-700 dark:text-gray-300"
              >Slug</label
            >
            <Input
              v-model="createForm.contentSlug"
              id="contentSlug"
              type="text"
              placeholder="my-new-post"
              :aria-invalid="createForm.invalid('contentSlug')"
              :aria-describedby="
                createForm.errors.contentSlug
                  ? 'content-create-slug-error'
                  : 'content-create-slug-help'
              "
              class="focus:border-brand mt-1 block w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
              @blur="validateOnBlur('contentSlug', $event)"
              @input="revalidateWhenInvalid('contentSlug')"
            />
            <p
              id="content-create-slug-help"
              class="mt-1 text-xs text-gray-500 dark:text-gray-400"
            >
              Will be used as the filename
            </p>
            <p
              v-if="createForm.errors.contentSlug"
              id="content-create-slug-error"
              class="mt-1 text-xs text-red-600 dark:text-red-400"
            >
              {{ createForm.errors.contentSlug }}
            </p>
          </div>
          <div>
            <label
              class="block text-sm font-medium text-gray-700 dark:text-gray-300"
              >Title (optional)</label
            >
            <Input
              v-model="createForm.title"
              id="contentTitle"
              type="text"
              placeholder="My New Post"
              :aria-invalid="createForm.invalid('title')"
              :aria-describedby="
                createForm.errors.title ? 'content-create-title-error' : null
              "
              class="focus:border-brand mt-1 block w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
              @blur="validateOnBlur('title', $event)"
              @input="revalidateWhenInvalid('title')"
            />
            <p
              v-if="createForm.errors.title"
              id="content-create-title-error"
              class="mt-1 text-xs text-red-600 dark:text-red-400"
            >
              {{ createForm.errors.title }}
            </p>
          </div>
          <div class="flex items-center justify-end space-x-3 pt-2">
            <button
              type="button"
              @click="closeCreateModal"
              class="rounded-md px-4 py-2 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              :disabled="
                !createForm.contentSlug.trim() ||
                createForm.processing ||
                createForm.validating ||
                createForm.hasErrors
              "
              class="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
            >
              {{ createForm.processing ? 'Creating...' : 'Create' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
