<script setup>
import { Link, Head, router } from '@inertiajs/vue3'
import { inject, ref, computed } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  project: Object,
  environment: Object,
  hasContentFeature: Boolean,
  contentFeature: Object
})

const toggleMobileMenu = inject('toggleMobileMenu')

// State
const collections = ref([])
const loading = ref(true)
const error = ref(null)
const createModalOpen = ref(false)
const selectedCollection = ref(null)

// New content form
const newContentSlug = ref('')
const newContentTitle = ref('')
const creating = ref(false)

// Fetch collections on mount
async function fetchCollections() {
  loading.value = true
  error.value = null
  try {
    const envPath = props.environment.slug !== 'production'
      ? `/environments/${props.environment.slug}`
      : ''
    const res = await fetch(`/api/v1/projects/${props.project.slug}${envPath}/content/collections`)
    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.message || 'Failed to load collections')
    }
    const data = await res.json()
    collections.value = data.collections || []
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

// Create new content
function openCreateModal(collection) {
  selectedCollection.value = collection
  newContentSlug.value = ''
  newContentTitle.value = ''
  createModalOpen.value = true
}

async function createContent() {
  if (!newContentSlug.value.trim() || creating.value) return
  creating.value = true
  try {
    const envPath = props.environment.slug !== 'production'
      ? `/environments/${props.environment.slug}`
      : ''
    const res = await fetch(`/api/v1/projects/${props.project.slug}${envPath}/content/${selectedCollection.value.slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug: newContentSlug.value.trim(),
        title: newContentTitle.value.trim() || newContentSlug.value.trim()
      })
    })
    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.message || 'Failed to create content')
    }
    const data = await res.json()
    createModalOpen.value = false
    // Navigate to the editor
    const basePath = props.environment.slug !== 'production'
      ? `/projects/${props.project.slug}/environments/${props.environment.slug}/content`
      : `/projects/${props.project.slug}/content`
    router.visit(`${basePath}/${selectedCollection.value.slug}/${data.file}`)
  } catch (e) {
    error.value = e.message
  } finally {
    creating.value = false
  }
}

function closeCreateModal() {
  createModalOpen.value = false
  selectedCollection.value = null
}

function getEditorPath(collection, file) {
  const basePath = props.environment.slug !== 'production'
    ? `/projects/${props.project.slug}/environments/${props.environment.slug}/content`
    : `/projects/${props.project.slug}/content`
  return `${basePath}/${collection}/${file}`
}

// Initialize
fetchCollections()
</script>
<template>
  <Head :title="`Content - ${project.name} | Slipway`"></Head>
  <div class="flex h-full flex-col">
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-gray-200 px-4 py-4 dark:border-gray-800 sm:px-8">
      <div class="flex items-center space-x-3">
        <button
          @click="toggleMobileMenu"
          class="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white md:hidden"
        >
          <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <nav class="flex items-center space-x-2 text-sm">
          <Link href="/" class="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">
            projects
          </Link>
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <Link
            :href="`/projects/${project.slug}`"
            class="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >
            {{ project.name.toLowerCase() }}
          </Link>
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <Link
            :href="`/projects/${project.slug}/environments/${environment.slug}`"
            class="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >
            {{ environment.name.toLowerCase() }}
          </Link>
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <span class="font-medium text-gray-900 dark:text-white">content</span>
        </nav>
      </div>
      <div class="flex items-center space-x-3">
        <a
          href="https://docs.sailscasts.com/slipway/content"
          target="_blank"
          class="flex items-center space-x-1 text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
        >
          <span>Docs</span>
          <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
      <div class="mx-auto max-w-4xl">
        <!-- Header -->
        <div class="mb-8">
          <div class="flex items-center space-x-3">
            <h1 class="text-xl font-semibold text-gray-900 dark:text-white">Content</h1>
            <span class="inline-flex rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-900/30 dark:text-violet-400">
              sails-content
            </span>
          </div>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Edit markdown content files. Changes require a redeploy to take effect.
          </p>
        </div>

        <!-- Feature not available -->
        <div v-if="!hasContentFeature" class="rounded-lg border border-dashed border-gray-300 px-6 py-12 text-center dark:border-gray-700">
          <svg class="mx-auto h-10 w-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <h3 class="mt-4 text-sm font-medium text-gray-900 dark:text-white">sails-content not detected</h3>
          <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Deploy your app with <code class="rounded bg-gray-100 px-1.5 py-0.5 text-xs dark:bg-gray-800">sails-content</code> installed to enable the Content.
          </p>
          <a
            href="https://docs.sailscasts.com/sails-content"
            target="_blank"
            class="mt-4 inline-flex items-center space-x-1 text-sm text-violet-600 hover:text-violet-500 dark:text-violet-400"
          >
            <span>Learn more</span>
            <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        </div>

        <!-- Loading -->
        <div v-else-if="loading" class="flex items-center justify-center py-12">
          <svg class="h-6 w-6 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        </div>

        <!-- Error -->
        <div v-else-if="error" class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-900/50 dark:bg-red-950/20">
          <p class="text-sm text-red-700 dark:text-red-400">{{ error }}</p>
          <button @click="fetchCollections" class="mt-2 text-sm text-red-600 underline hover:text-red-500 dark:text-red-400">
            Try again
          </button>
        </div>

        <!-- Collections -->
        <div v-else-if="collections.length > 0" class="space-y-6">
          <div
            v-for="collection in collections"
            :key="collection.slug"
            class="rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950"
          >
            <!-- Collection header -->
            <div class="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800">
              <div class="flex items-center space-x-3">
                <svg class="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
                <h2 class="text-sm font-medium text-gray-900 dark:text-white">{{ collection.name }}</h2>
                <span class="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                  {{ collection.count }} {{ collection.count === 1 ? 'file' : 'files' }}
                </span>
              </div>
              <button
                @click="openCreateModal(collection)"
                class="flex items-center space-x-1 rounded-md px-2 py-1 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
              >
                <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
                </svg>
                <span>New</span>
              </button>
            </div>

            <!-- Files list -->
            <div v-if="collection.files.length > 0" class="divide-y divide-gray-200 dark:divide-gray-800">
              <Link
                v-for="file in collection.files"
                :key="file.slug"
                :href="getEditorPath(collection.slug, file.slug)"
                class="flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-900/50"
              >
                <div class="flex items-center space-x-3">
                  <svg class="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span class="text-sm text-gray-900 dark:text-white">{{ file.slug }}</span>
                  <span class="text-xs text-gray-400 dark:text-gray-500">{{ file.name }}</span>
                </div>
                <svg class="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
            <div v-else class="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
              No files in this collection yet.
            </div>
          </div>
        </div>

        <!-- Empty state -->
        <div v-else class="rounded-lg border border-dashed border-gray-300 px-6 py-12 text-center dark:border-gray-700">
          <svg class="mx-auto h-10 w-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <h3 class="mt-4 text-sm font-medium text-gray-900 dark:text-white">No content collections found</h3>
          <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Create a <code class="rounded bg-gray-100 px-1.5 py-0.5 text-xs dark:bg-gray-800">content/</code> directory with subdirectories for each collection.
          </p>
        </div>
      </div>
    </div>

    <!-- Create Modal -->
    <div v-if="createModalOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div class="w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-gray-900">
        <h3 class="text-lg font-semibold text-gray-900 dark:text-white">
          Create new content in {{ selectedCollection?.name }}
        </h3>
        <div class="mt-4 space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">Slug</label>
            <input
              v-model="newContentSlug"
              type="text"
              placeholder="my-new-post"
              class="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500"
              @keydown.enter="createContent"
            />
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">Will be used as the filename</p>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">Title (optional)</label>
            <input
              v-model="newContentTitle"
              type="text"
              placeholder="My New Post"
              class="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500"
              @keydown.enter="createContent"
            />
          </div>
        </div>
        <div class="mt-6 flex items-center justify-end space-x-3">
          <button
            @click="closeCreateModal"
            class="rounded-md px-4 py-2 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >
            Cancel
          </button>
          <button
            @click="createContent"
            :disabled="!newContentSlug.trim() || creating"
            class="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
          >
            {{ creating ? 'Creating...' : 'Create' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
