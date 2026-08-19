<script setup>
import { Link, Head, useForm } from '@inertiajs/vue3'
import { computed, inject, ref, watch } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import MarkdownEditor from '@/components/content/MarkdownEditor.vue'
import Tooltip from '@/components/ui/tooltip/Tooltip.vue'
import Menu from '@/components/ui/menu/Menu.vue'
import Breadcrumb from '@/components/ui/breadcrumb/Breadcrumb.vue'
import { usePrecognitionValidation } from '@/composables/precognition'

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
  app: Object,
  uploadsConfigured: Boolean
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
const editorMode = ref(fileType.value === 'markdown' ? 'visual' : 'source')
const markdownEditor = ref(null)
const editorCompatibility = ref({
  supported: true,
  issues: [],
  message: ''
})

// Forms
const saveForm = useForm({
  frontmatter: {},
  body: '',
  raw: '',
  deploy: false,
  appSlug: props.app.slug,
  sourceSha: props.content?.sourceSha || ''
})
  .withPrecognition('post', () => getActionPath('update'))
  .setValidationTimeout(350)
const { revalidateWhenInvalid } = usePrecognitionValidation(saveForm)
const hasContentErrors = computed(() =>
  Object.keys(saveForm.errors).some(
    (field) =>
      field === 'frontmatter' ||
      field.startsWith('frontmatter.') ||
      field === 'body' ||
      field === 'raw'
  )
)

const deleteForm = useForm({
  appSlug: props.app.slug,
  sourceSha: props.content?.sourceSha || ''
})

// Path helpers
const envPath = computed(() => {
  return props.environment.slug !== 'production'
    ? `/environments/${props.environment.slug}`
    : ''
})

function getContentManagerPath() {
  const path =
    props.environment.slug !== 'production'
      ? `/projects/${props.project.slug}/environments/${props.environment.slug}/content`
      : `/projects/${props.project.slug}/content`
  return `${path}?appSlug=${props.app.slug}`
}

const breadcrumbs = computed(() => [
  { label: 'projects', href: '/' },
  {
    label: props.project.name.toLowerCase(),
    href: `/projects/${props.project.slug}`
  },
  {
    label: props.environment.name.toLowerCase(),
    href: `/projects/${props.project.slug}/environments/${props.environment.slug}`
  },
  { label: 'content', href: getContentManagerPath() },
  { label: props.collection, title: props.collection },
  { label: props.file, title: props.file }
])

function getActionPath(action) {
  return `/projects/${props.project.slug}${envPath.value}/content/${props.collection}/${props.file}/${action}`
}

function getUploadPath() {
  return `/api/v1/projects/${props.project.slug}${envPath.value}/content/${props.collection}/${props.file}/images`
}

function syncSaveForm(triggerDeploy = saveForm.deploy) {
  if (fileType.value === 'json') {
    saveForm.raw = raw.value
    saveForm.frontmatter = {}
    saveForm.body = ''
  } else {
    saveForm.frontmatter = frontmatter.value
    saveForm.body = body.value
    saveForm.raw = ''
  }
  saveForm.deploy = triggerDeploy
}

function validateEditorField(field) {
  syncSaveForm()
  saveForm.validate(field)
}

function revalidateEditorField(field) {
  syncSaveForm()
  revalidateWhenInvalid(field)
}

function submitContent() {
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

// Save content
function saveContent(triggerDeploy = false) {
  if (saveForm.processing || saveForm.validating) return

  syncSaveForm(triggerDeploy)
  saveForm.clearErrors()
  saveForm.validate({
    only:
      fileType.value === 'json'
        ? ['raw']
        : [
            'frontmatter',
            ...Object.keys(frontmatter.value).map(
              (key) => `frontmatter.${key}`
            ),
            'body'
          ],
    onPrecognitionSuccess: submitContent,
    onValidationError: () => {
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

// Delete content
function openDeleteModal() {
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
  [frontmatter, body, raw],
  () => {
    hasChanges.value = true
  },
  { deep: true }
)

function setEditorMode(nextMode) {
  if (fileType.value !== 'markdown') return
  markdownEditor.value?.setMode(nextMode)
}

function updateEditorMode(nextMode) {
  editorMode.value = nextMode
}

function updateEditorCompatibility(nextCompatibility) {
  editorCompatibility.value = nextCompatibility
}

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
      <div class="flex min-w-0 flex-1 items-center gap-2">
        <button
          type="button"
          aria-label="Open navigation"
          @click="toggleMobileMenu"
          class="shrink-0 rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white md:hidden"
        >
          <svg
            class="h-5 w-5"
            viewBox="-0.5 -0.5 16 16"
            fill="none"
            stroke="currentColor"
            aria-hidden="true"
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
          type="button"
          :aria-label="sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
          @click="toggleSidebar"
          class="hidden text-gray-400 dark:text-gray-500 md:block"
        >
          <svg
            v-if="sidebarCollapsed"
            class="h-5 w-5"
            viewBox="-0.5 -0.5 16 16"
            fill="none"
            stroke="currentColor"
            aria-hidden="true"
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
            aria-hidden="true"
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
        <Link
          :href="getContentManagerPath()"
          aria-label="Back to content manager"
          class="shrink-0 rounded-sm text-gray-400 hover:text-gray-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-950 dark:text-gray-500 dark:hover:text-gray-300 dark:focus-visible:outline-white sm:hidden"
        >
          <svg
            class="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </Link>
        <Breadcrumb
          :items="breadcrumbs"
          current-only-on-mobile
          class="sm:[&_[data-slot=current]]:min-h-11 flex-1 [&_[data-slot=current]]:min-h-0 [&_[data-slot=current]]:px-0 sm:[&_[data-slot=current]]:px-1"
        />
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
        >
          <span class="sr-only">Unsaved changes</span>
        </span>

        <!-- Markdown mode toggle -->
        <div
          v-if="fileType === 'markdown'"
          class="flex rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800"
          role="group"
          aria-label="Editor mode"
        >
          <button
            data-test="content-visual-mode"
            type="button"
            :aria-pressed="editorMode === 'visual'"
            :disabled="!editorCompatibility.supported"
            @click="setEditorMode('visual')"
            :class="[
              'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
              editorMode === 'visual'
                ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
                : 'text-gray-500 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-400 dark:hover:text-white'
            ]"
          >
            Visual
          </button>
          <button
            data-test="content-source-mode"
            type="button"
            :aria-pressed="editorMode === 'source'"
            @click="setEditorMode('source')"
            :class="[
              'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
              editorMode === 'source'
                ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
                : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
            ]"
          >
            Markdown
          </button>
        </div>

        <!-- Delete (hidden on mobile) -->
        <Tooltip text="Delete">
          <button
            type="button"
            aria-label="Delete content"
            @click="openDeleteModal"
            class="hidden rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400 sm:block"
          >
            <svg
              class="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
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
            type="button"
            @click="saveContent(false)"
            :disabled="
              saveForm.processing ||
              saveForm.validating ||
              !hasChanges ||
              hasContentErrors
            "
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
            type="button"
            aria-label="Open save options"
            popovertarget="content-save-menu"
            :disabled="saveForm.processing || saveForm.validating"
            class="rounded-r-md border-l border-gray-700 bg-gray-900 px-2 py-1.5 text-white hover:bg-gray-800 disabled:opacity-50 dark:border-gray-300 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
          >
            <svg
              class="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>
          <!-- Dropdown -->
          <Menu
            v-model:open="showSaveMenu"
            id="content-save-menu"
            data-test="content-save-menu"
            aria-label="Save options"
            placement="bottom-end"
            :offset="4"
            class="w-64 rounded-md border-gray-200 bg-white px-0 py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800"
          >
            <button
              type="button"
              @click="saveOnlyAndCloseMenu"
              :disabled="!hasChanges"
              class="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              Save
              <span class="text-xs text-gray-400">⌘S</span>
            </button>
            <button
              type="button"
              @click="saveAndDeployAndCloseMenu"
              class="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              Save & Deploy
            </button>
            <p
              v-if="
                saveForm.errors.content ||
                saveForm.errors.deploy ||
                saveForm.errors.appSlug
              "
              role="alert"
              class="border-t border-gray-100 px-3 py-2 text-xs leading-5 text-red-600 dark:border-gray-700 dark:text-red-400"
            >
              {{
                saveForm.errors.content ||
                saveForm.errors.deploy ||
                saveForm.errors.appSlug
              }}
            </p>
          </Menu>
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

      <!-- JSON source editor -->
      <div
        v-else-if="fileType === 'json'"
        class="flex flex-1 flex-col overflow-hidden bg-gray-50 dark:bg-gray-950"
      >
        <label class="sr-only" for="content-json-source">JSON source</label>
        <textarea
          id="content-json-source"
          v-model="raw"
          data-test="content-json-source"
          class="flex-1 resize-none bg-transparent p-5 font-mono text-sm leading-7 text-gray-900 outline-none dark:text-white"
          spellcheck="false"
          :aria-invalid="saveForm.invalid('raw')"
          :aria-describedby="saveForm.errors.raw ? 'content-raw-error' : null"
          @blur="validateEditorField('raw')"
          @input="revalidateEditorField('raw')"
        ></textarea>
        <p
          v-if="saveForm.errors.raw"
          id="content-raw-error"
          class="px-5 pb-3 text-xs text-red-600 dark:text-red-400"
        >
          {{ saveForm.errors.raw }}
        </p>
      </div>

      <!-- Markdown document workspace -->
      <main
        v-else
        class="flex-1 overflow-y-auto bg-white dark:bg-gray-950"
        aria-label="Markdown document"
      >
        <details
          v-if="Object.keys(frontmatter).length > 0"
          class="group mx-auto w-full max-w-3xl px-5 pt-6 sm:px-8"
        >
          <summary
            class="flex list-none items-center gap-2 text-xs font-medium text-gray-500 marker:hidden hover:text-gray-900 dark:text-gray-500 dark:hover:text-gray-200"
          >
            <svg
              class="h-3.5 w-3.5 transition-transform group-open:rotate-90"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.75"
                d="m9 18 6-6-6-6"
              />
            </svg>
            Metadata
            <span class="font-normal text-gray-400 dark:text-gray-600">
              {{ Object.keys(frontmatter).length }}
              {{ Object.keys(frontmatter).length === 1 ? 'field' : 'fields' }}
            </span>
          </summary>
          <dl
            class="mt-4 grid gap-x-6 gap-y-4 rounded-lg bg-gray-50 px-4 py-4 dark:bg-gray-900/60 sm:grid-cols-2"
          >
            <div v-for="(_value, key) in frontmatter" :key="key">
              <dt>
                <label
                  :for="`content-metadata-${key}`"
                  class="text-xs font-medium text-gray-500 dark:text-gray-400"
                  >{{ key }}</label
                >
              </dt>
              <dd class="mt-1">
                <input
                  :id="`content-metadata-${key}`"
                  v-model="frontmatter[key]"
                  type="text"
                  :aria-invalid="saveForm.invalid(`frontmatter.${key}`)"
                  :aria-describedby="
                    saveForm.errors[`frontmatter.${key}`]
                      ? `content-metadata-${key}-error`
                      : null
                  "
                  class="focus:border-brand dark:focus:border-brand-400 w-full border-0 border-b border-gray-200 bg-transparent px-0 py-1.5 text-sm text-gray-900 outline-none transition-colors dark:border-gray-700 dark:text-white"
                  @blur="validateEditorField(`frontmatter.${key}`)"
                  @input="revalidateEditorField(`frontmatter.${key}`)"
                />
                <p
                  v-if="saveForm.errors[`frontmatter.${key}`]"
                  :id="`content-metadata-${key}-error`"
                  class="mt-1 text-xs text-red-600 dark:text-red-400"
                >
                  {{ saveForm.errors[`frontmatter.${key}`] }}
                </p>
              </dd>
            </div>
          </dl>
          <p
            v-if="saveForm.errors.frontmatter"
            class="mt-2 text-xs text-red-600 dark:text-red-400"
          >
            {{ saveForm.errors.frontmatter }}
          </p>
        </details>

        <p
          v-if="saveForm.errors.body"
          id="content-body-error"
          class="mx-auto w-full max-w-3xl px-5 pt-4 text-xs text-red-600 dark:text-red-400 sm:px-8"
        >
          {{ saveForm.errors.body }}
        </p>

        <MarkdownEditor
          ref="markdownEditor"
          v-model="body"
          :uploads-configured="uploadsConfigured"
          :upload-url="getUploadPath()"
          :aria-invalid="saveForm.invalid('body')"
          :aria-describedby="saveForm.errors.body ? 'content-body-error' : null"
          @blur="validateEditorField('body')"
          @update:model-value="revalidateEditorField('body')"
          @mode-change="updateEditorMode"
          @compatibility-change="updateEditorCompatibility"
        />
      </main>
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
