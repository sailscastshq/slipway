<script setup>
import { Link, Head, useForm } from '@inertiajs/vue3'
import { inject, ref, computed, watch, onMounted, onUnmounted } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import Tooltip from '@/components/Tooltip.vue'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  project: Object,
  environment: Object,
  collection: String,
  file: String,
  contentFeature: Object,
  content: Object,
  contentError: String,
  selectedAppSlug: String,
  apps: Array
})

const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')

// State
const deleteModalOpen = ref(false)
const showSaveMenu = ref(false)

// Content (initialized from props)
const fileType = ref(props.content?.fileType || 'markdown')
const frontmatter = ref(props.content?.frontmatter || {})
const body = ref(props.content?.body || '')
const raw = ref(props.content?.raw || '')
const updatedAt = ref(props.content?.updatedAt || '')
const hasChanges = ref(false)

// Editor mode
const editorMode = ref('split') // 'edit', 'preview', 'split'
const editingRaw = ref(false)

// Forms
const saveForm = useForm({
  frontmatter: {},
  body: '',
  raw: '',
  deploy: false,
  appSlug:
    props.selectedAppSlug ||
    (props.apps?.length === 1 ? props.apps[0].slug : ''),
  sourceSha: props.content?.sourceSha || ''
})

const deleteForm = useForm({
  appSlug:
    props.selectedAppSlug ||
    (props.apps?.length === 1 ? props.apps[0].slug : ''),
  sourceSha: props.content?.sourceSha || ''
})

// Preview
const previewHtml = computed(() => {
  // Simple markdown to HTML conversion for preview
  // In production, use a proper markdown parser
  let html = body.value
    // Headers
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    // Bold and italic
    .replace(/\*\*\*(.*?)\*\*\*/gim, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/gim, '<em>$1</em>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/gim, '<a href="$2">$1</a>')
    // Code blocks
    .replace(/```([^`]+)```/gim, '<pre><code>$1</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/gim, '<code>$1</code>')
    // Lists
    .replace(/^\s*-\s+(.*$)/gim, '<li>$1</li>')
    // Paragraphs
    .replace(/\n\n/gim, '</p><p>')

  return `<p>${html}</p>`
})

// Path helpers
const envPath = computed(() => {
  return props.environment.slug !== 'production'
    ? `/environments/${props.environment.slug}`
    : ''
})

function getContentManagerPath() {
  return props.environment.slug !== 'production'
    ? `/projects/${props.project.slug}/environments/${props.environment.slug}/content`
    : `/projects/${props.project.slug}/content`
}

function getActionPath(action) {
  return `/projects/${props.project.slug}${envPath.value}/content/${props.collection}/${props.file}/${action}`
}

// Save content
function saveContent(triggerDeploy = false) {
  if (saveForm.processing) return

  if (props.apps?.length > 1 && !saveForm.appSlug) {
    saveForm.setError('appSlug', 'Choose which app owns this content.')
    showSaveMenu.value = true
    return
  }

  if (editingRaw.value) {
    saveForm.raw = raw.value
    saveForm.frontmatter = {}
    saveForm.body = ''
  } else {
    saveForm.frontmatter = frontmatter.value
    saveForm.body = body.value
    saveForm.raw = ''
  }
  saveForm.deploy = triggerDeploy
  saveForm.clearErrors()

  saveForm.post(getActionPath('update'), {
    preserveScroll: true,
    onSuccess: (page) => {
      hasChanges.value = false
      // Update updatedAt from refreshed props
      if (page.props.content) {
        updatedAt.value = page.props.content.updatedAt
        saveForm.sourceSha = page.props.content.sourceSha
      }
    },
    onError: () => {
      showSaveMenu.value = true
    }
  })
}

function saveOnlyAndCloseMenu() {
  showSaveMenu.value = false
  saveContent(false)
}

function saveAndDeployAndCloseMenu() {
  showSaveMenu.value = false
  saveContent(true)
}

function selectTargetApp() {
  saveForm.clearErrors('appSlug')

  const url = new URL(window.location.href)
  if (saveForm.appSlug) {
    url.searchParams.set('appSlug', saveForm.appSlug)
  } else {
    url.searchParams.delete('appSlug')
  }
  window.history.replaceState({}, '', url)
}

// Delete content
function openDeleteModal() {
  if (props.apps?.length > 1 && !saveForm.appSlug) {
    saveForm.setError('appSlug', 'Choose which app owns this content.')
    showSaveMenu.value = true
    return
  }

  deleteModalOpen.value = true
}

function deleteContent() {
  deleteForm.appSlug = saveForm.appSlug
  deleteForm.sourceSha = saveForm.sourceSha
  deleteForm.post(getActionPath('delete'), {
    onSuccess: () => {
      deleteModalOpen.value = false
    },
    onError: (errors) => {
      deleteModalOpen.value = false
      for (const [field, message] of Object.entries(errors)) {
        saveForm.setError(field, message)
      }
      showSaveMenu.value = true
    }
  })
}

// Track changes
watch(
  [frontmatter, body],
  () => {
    hasChanges.value = true
  },
  { deep: true }
)

// Update raw when frontmatter/body change (for raw mode toggle)
watch(
  [frontmatter, body],
  () => {
    if (!editingRaw.value) {
      let content = '---\n'
      for (const [key, value] of Object.entries(frontmatter.value)) {
        if (
          typeof value === 'string' &&
          (value.includes(':') || value.includes('#'))
        ) {
          content += `${key}: '${value}'\n`
        } else {
          content += `${key}: ${value}\n`
        }
      }
      content += '---\n\n'
      content += body.value
      raw.value = content
    }
  },
  { deep: true }
)

// Click outside handler
function handleClickOutside(e) {
  if (showSaveMenu.value && !e.target.closest('.relative.flex')) {
    showSaveMenu.value = false
  }
}

// Initialize
onMounted(() => {
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})

// Keyboard shortcuts
function handleKeydown(e) {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault()
    saveContent(false)
  }
  if (e.key === 'Escape') {
    showSaveMenu.value = false
  }
}
</script>
<template>
  <Head :title="`${file} - ${collection} | ${project.name}`"></Head>
  <div class="flex h-full flex-col" @keydown="handleKeydown">
    <!-- Header -->
    <div
      class="flex items-center justify-between gap-2 border-b border-gray-200 px-3 py-2 dark:border-gray-800 sm:px-6 sm:py-3"
    >
      <div class="flex min-w-0 items-center gap-2">
        <button
          @click="toggleMobileMenu"
          class="shrink-0 rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white md:hidden"
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
        <!-- Mobile: condensed breadcrumb -->
        <nav class="flex min-w-0 items-center gap-1.5 text-sm sm:hidden">
          <Link
            :href="getContentManagerPath()"
            class="shrink-0 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
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
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </Link>
          <span class="truncate font-medium text-gray-900 dark:text-white">{{
            file
          }}</span>
        </nav>

        <!-- Desktop: full breadcrumb -->
        <nav class="hidden items-center gap-2 text-sm sm:flex">
          <Link
            href="/"
            class="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >
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
          <Link
            :href="getContentManagerPath()"
            class="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >
            content
          </Link>
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <span class="text-gray-500 dark:text-gray-400">{{ collection }}</span>
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <span class="font-medium text-gray-900 dark:text-white">{{
            file
          }}</span>
        </nav>
      </div>

      <div class="flex shrink-0 items-center gap-1 sm:gap-2">
        <!-- Unsaved indicator -->
        <span
          v-if="hasChanges"
          class="hidden text-xs text-amber-600 dark:text-amber-400 sm:inline"
          >Unsaved changes</span
        >
        <span
          v-if="hasChanges"
          class="h-2 w-2 rounded-full bg-amber-500 sm:hidden"
        ></span>

        <!-- View mode toggle -->
        <div
          class="hidden rounded-lg border border-gray-200 p-0.5 dark:border-gray-700 sm:flex"
        >
          <button
            @click="editorMode = 'edit'"
            :class="[
              'rounded-md px-2 py-1 text-xs font-medium transition-colors',
              editorMode === 'edit'
                ? 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-white'
                : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
            ]"
          >
            Edit
          </button>
          <button
            @click="editorMode = 'split'"
            :class="[
              'rounded-md px-2 py-1 text-xs font-medium transition-colors',
              editorMode === 'split'
                ? 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-white'
                : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
            ]"
          >
            Split
          </button>
          <button
            @click="editorMode = 'preview'"
            :class="[
              'rounded-md px-2 py-1 text-xs font-medium transition-colors',
              editorMode === 'preview'
                ? 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-white'
                : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
            ]"
          >
            Preview
          </button>
        </div>

        <!-- Raw mode toggle -->
        <Tooltip text="Raw mode">
          <button
            @click="editingRaw = !editingRaw"
            :class="[
              'rounded-md p-1.5 transition-colors',
              editingRaw
                ? 'bg-gray-200 text-gray-900 dark:bg-gray-700 dark:text-white'
                : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200'
            ]"
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
                d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
              />
            </svg>
          </button>
        </Tooltip>

        <!-- Delete (hidden on mobile) -->
        <Tooltip text="Delete">
          <button
            @click="openDeleteModal"
            class="hidden rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400 sm:block"
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
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>
        </Tooltip>

        <!-- Split Save Button -->
        <div class="relative flex">
          <button
            @click="saveContent(false)"
            :disabled="saveForm.processing || !hasChanges"
            class="rounded-l-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
          >
            {{
              saveForm.processing
                ? saveForm.deploy
                  ? 'Deploying...'
                  : 'Saving...'
                : 'Save'
            }}
          </button>
          <button
            data-test="content-save-menu-toggle"
            @click="showSaveMenu = !showSaveMenu"
            :disabled="saveForm.processing"
            class="rounded-r-md border-l border-gray-700 bg-gray-900 px-2 py-1.5 text-white hover:bg-gray-800 disabled:opacity-50 dark:border-gray-300 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
          >
            <svg
              class="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>
          <!-- Dropdown -->
          <div
            v-if="showSaveMenu"
            data-test="content-save-menu"
            class="absolute right-0 top-full z-10 mt-1 w-64 rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800"
          >
            <div
              v-if="apps?.length > 1"
              class="border-b border-gray-100 px-3 py-2 dark:border-gray-700"
            >
              <label
                for="content-target-app"
                class="block text-xs font-medium text-gray-500 dark:text-gray-400"
              >
                Target app
              </label>
              <select
                id="content-target-app"
                data-test="content-target-app"
                v-model="saveForm.appSlug"
                :aria-invalid="Boolean(saveForm.errors.appSlug)"
                :aria-describedby="
                  saveForm.errors.appSlug ? 'content-target-app-error' : null
                "
                class="mt-1 block w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-gray-400 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                @change="selectTargetApp"
              >
                <option value="" disabled>Choose an app</option>
                <option v-for="app in apps" :key="app.id" :value="app.slug">
                  {{ app.name }}
                </option>
              </select>
              <p
                v-if="saveForm.errors.appSlug"
                id="content-target-app-error"
                class="mt-1 text-xs text-red-600 dark:text-red-400"
              >
                {{ saveForm.errors.appSlug }}
              </p>
            </div>
            <button
              @click="saveOnlyAndCloseMenu"
              :disabled="!hasChanges"
              class="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              Save
              <span class="text-xs text-gray-400">⌘S</span>
            </button>
            <button
              @click="saveAndDeployAndCloseMenu"
              class="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              Save & Deploy
            </button>
            <p
              v-if="saveForm.errors.content || saveForm.errors.deploy"
              role="alert"
              class="border-t border-gray-100 px-3 py-2 text-xs leading-5 text-red-600 dark:border-gray-700 dark:text-red-400"
            >
              {{ saveForm.errors.content || saveForm.errors.deploy }}
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- Content -->
    <div class="flex flex-1 overflow-hidden">
      <!-- Error -->
      <div v-if="contentError" class="flex flex-1 items-center justify-center">
        <div class="text-center">
          <p class="text-sm text-red-600 dark:text-red-400">
            {{ contentError }}
          </p>
          <Link
            :href="getContentManagerPath()"
            class="mt-2 inline-block text-sm text-gray-500 underline hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >
            Back to content manager
          </Link>
        </div>
      </div>

      <!-- Raw mode editor -->
      <template v-else-if="editingRaw">
        <div class="flex flex-1 flex-col overflow-hidden">
          <textarea
            v-model="raw"
            class="flex-1 resize-none bg-gray-50 p-4 font-mono text-sm text-gray-900 focus:outline-none dark:bg-gray-950 dark:text-white"
            spellcheck="false"
            @input="hasChanges = true"
          />
        </div>
      </template>

      <!-- Split/Edit/Preview mode -->
      <template v-else>
        <!-- Editor pane -->
        <div
          v-show="editorMode !== 'preview'"
          :class="[
            'flex flex-col overflow-hidden border-r border-gray-200 dark:border-gray-800',
            editorMode === 'split' ? 'w-1/2' : 'flex-1'
          ]"
        >
          <!-- Frontmatter -->
          <div class="space-y-1 px-4 py-3">
            <input
              v-for="(value, key) in frontmatter"
              :key="key"
              v-model="frontmatter[key]"
              type="text"
              :placeholder="key"
              class="block w-full border-0 border-b border-dashed border-gray-200 bg-transparent px-0 py-1 text-sm text-gray-900 placeholder-gray-300 focus:border-gray-400 focus:outline-none focus:ring-0 dark:border-gray-700 dark:text-white dark:placeholder-gray-600 dark:focus:border-gray-500"
            />
          </div>

          <!-- Body editor -->
          <textarea
            v-model="body"
            data-test="content-body"
            class="flex-1 resize-none bg-white p-4 font-mono text-sm text-gray-900 focus:outline-none dark:bg-gray-950 dark:text-white"
            placeholder="Write your markdown content here..."
            spellcheck="false"
          />
        </div>

        <!-- Preview pane -->
        <div
          v-show="editorMode !== 'edit'"
          :class="[
            'overflow-y-auto bg-white p-6 dark:bg-gray-950',
            editorMode === 'split' ? 'w-1/2' : 'flex-1'
          ]"
        >
          <div class="mx-auto max-w-2xl">
            <!-- Frontmatter display -->
            <div
              v-if="Object.keys(frontmatter).length > 0"
              class="mb-8 space-y-1 border-b border-dashed border-gray-200 pb-6 dark:border-gray-700"
            >
              <p
                v-for="(value, key) in frontmatter"
                :key="key"
                class="text-sm text-gray-900 dark:text-white"
              >
                {{ value }}
              </p>
            </div>

            <!-- Body preview -->
            <article
              v-html="previewHtml"
              class="prose prose-headings:font-bold prose-headings:text-gray-900 dark:prose-headings:text-white prose-p:text-gray-700 dark:prose-p:text-gray-300 prose-strong:text-gray-900 dark:prose-strong:text-white prose-a:font-semibold prose-a:text-gray-900 dark:prose-a:text-white prose-a:no-underline hover:prose-a:underline prose-code:rounded-md prose-code:bg-gray-100 dark:prose-code:bg-gray-800 prose-code:text-gray-800 dark:prose-code:text-gray-200 prose-code:px-1.5 prose-code:py-0.5 prose-code:font-medium prose-li:text-gray-700 dark:prose-li:text-gray-300 prose-ul:text-gray-700 dark:prose-ul:text-gray-300 prose-ol:text-gray-700 dark:prose-ol:text-gray-300 max-w-none text-gray-700 dark:text-gray-300"
            ></article>
          </div>
        </div>
      </template>
    </div>

    <!-- Footer -->
    <div
      class="flex items-center justify-between border-t border-gray-200 px-4 py-2 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400"
    >
      <span>{{ fileType === 'markdown' ? 'Markdown' : 'JSON' }}</span>
      <span v-if="updatedAt"
        >Last updated: {{ new Date(updatedAt).toLocaleString() }}</span
      >
    </div>

    <!-- Delete Confirmation Modal -->
    <ConfirmModal
      :show="deleteModalOpen"
      title="Delete content"
      :message="`Are you sure you want to delete '${file}' from ${collection}? This action cannot be undone.`"
      confirm-label="Delete"
      :destructive="true"
      :loading="deleteForm.processing"
      @confirm="deleteContent"
      @cancel="deleteModalOpen = false"
    />
  </div>
</template>
