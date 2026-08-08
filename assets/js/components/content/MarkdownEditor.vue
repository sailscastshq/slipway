<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { EditorContent, useEditor } from '@tiptap/vue-3'
import { BubbleMenu } from '@tiptap/vue-3/menus'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import FileHandler from '@tiptap/extension-file-handler'
import Placeholder from '@tiptap/extension-placeholder'
import { Markdown } from '@tiptap/markdown'
import DOMPurify from 'dompurify'
import {
  inspectMarkdown,
  looksLikeImageUrl,
  normalizeImageUrl,
  normalizeLinkUrl,
  preserveMarkdownEnvelope,
  roundTripMatches
} from '@/lib/content/markdown.mjs'

const props = defineProps({
  modelValue: {
    type: String,
    default: ''
  },
  uploadsConfigured: Boolean,
  uploadUrl: {
    type: String,
    default: ''
  },
  uploadFieldName: {
    type: String,
    default: 'image'
  },
  uploadAccept: {
    type: Array,
    default: () => [
      'image/avif',
      'image/gif',
      'image/jpeg',
      'image/png',
      'image/webp'
    ]
  },
  maxUploadBytes: {
    type: Number,
    default: 5 * 1024 * 1024
  },
  uploadValues: {
    type: Object,
    default: () => ({})
  },
  showUploadControl: Boolean,
  variant: {
    type: String,
    default: 'document',
    validator: (value) => ['document', 'field'].includes(value)
  },
  editorId: {
    type: String,
    default: 'content'
  },
  placeholder: {
    type: String,
    default: 'Start writing…'
  },
  ariaLabel: {
    type: String,
    default: 'Document body'
  },
  ariaLabelledby: {
    type: String,
    default: ''
  },
  ariaDescribedby: {
    type: String,
    default: ''
  },
  required: {
    type: Boolean,
    default: false
  },
  denyRawHtml: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits([
  'update:modelValue',
  'mode-change',
  'compatibility-change'
])

const sourceValue = ref(props.modelValue)
const mode = ref('visual')
const compatibility = ref({
  supported: true,
  issues: [],
  message: ''
})
const syncing = ref(false)
const linkEditorOpen = ref(false)
const linkUrl = ref('')
const linkError = ref('')
const imageAlt = ref('')
const uploading = ref(false)
const uploadMessage = ref('')
const uploadKind = ref('status')
const uploadInput = ref(null)
let uploadMessageTimeout

const isField = computed(() => props.variant === 'field')
const uploadAcceptValue = computed(() => props.uploadAccept.join(','))
const sourcePlaceholder = computed(() =>
  isField.value
    ? 'Write Markdown…'
    : 'Write Markdown here. Visual mode becomes available when every construct can be preserved safely.'
)
const compatibilityTitle = computed(() =>
  isField.value
    ? 'This value is safest in Markdown'
    : 'This document is safest in Markdown'
)
const shouldShowCompatibilityWarning = computed(
  () =>
    compatibility.value.message &&
    !(
      props.denyRawHtml &&
      compatibility.value.issues.some(({ code }) =>
        ['html-comments', 'raw-html', 'mdx'].includes(code)
      )
    )
)

function elementId(suffix) {
  return `${props.editorId}-${suffix}`
}

function testHandle(suffix) {
  return `${props.editorId}-${suffix}`
}

const editor = useEditor({
  content: '',
  contentType: 'markdown',
  extensions: [
    StarterKit.configure({
      heading: {
        levels: [1, 2, 3, 4]
      },
      link: {
        autolink: true,
        defaultProtocol: 'https',
        enableClickSelection: true,
        linkOnPaste: true,
        openOnClick: false,
        isAllowedUri: (url, context) =>
          context.defaultValidate(url) && normalizeLinkUrl(url) !== null,
        HTMLAttributes: {
          rel: 'noopener noreferrer',
          target: null
        }
      }
    }),
    Image.configure({
      allowBase64: false,
      HTMLAttributes: {
        loading: 'lazy'
      }
    }),
    Placeholder.configure({
      placeholder: props.placeholder
    }),
    FileHandler.configure({
      allowedMimeTypes: props.uploadAccept,
      consumePasteEvent: true,
      onPaste: (currentEditor, files) => {
        void uploadImages(files, null, currentEditor)
      },
      onDrop: (currentEditor, files, position) => {
        void uploadImages(files, position, currentEditor)
      }
    }),
    Markdown.configure({
      markedOptions: {
        gfm: true
      }
    })
  ],
  editorProps: {
    attributes: {
      'aria-label': props.ariaLabelledby ? undefined : props.ariaLabel,
      'aria-labelledby': props.ariaLabelledby || undefined,
      'aria-describedby': props.ariaDescribedby || undefined,
      'aria-required': props.required ? 'true' : undefined,
      'data-test': testHandle('visual-editor'),
      spellcheck: 'true'
    },
    transformPastedHTML: (html) =>
      DOMPurify.sanitize(html, {
        ALLOWED_TAGS: [
          'a',
          'blockquote',
          'br',
          'code',
          'em',
          'h1',
          'h2',
          'h3',
          'h4',
          'hr',
          'li',
          'ol',
          'p',
          'pre',
          's',
          'strong',
          'ul'
        ],
        ALLOWED_ATTR: ['alt', 'href', 'src', 'title'],
        ALLOW_DATA_ATTR: false
      }),
    handleKeyDown: (_view, event) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === 'k' &&
        editor.value &&
        !editor.value.state.selection.empty
      ) {
        event.preventDefault()
        openLinkEditor()
        return true
      }

      return false
    },
    handlePaste: (_view, event) => {
      const text = event.clipboardData?.getData('text/plain')?.trim()
      if (!text || !looksLikeImageUrl(text) || !editor.value) return false

      event.preventDefault()
      editor.value.chain().focus().setImage({ src: text, alt: '' }).run()
      return true
    }
  },
  onCreate: ({ editor: currentEditor }) => {
    loadMarkdown(props.modelValue, currentEditor)
  },
  onUpdate: ({ editor: currentEditor }) => {
    if (syncing.value || mode.value !== 'visual') return

    const markdown = preserveMarkdownEnvelope(
      currentEditor.getMarkdown(),
      sourceValue.value
    )
    sourceValue.value = markdown
    emit('update:modelValue', markdown)
  },
  onSelectionUpdate: ({ editor: currentEditor }) => {
    if (currentEditor.isActive('image')) {
      imageAlt.value = currentEditor.getAttributes('image').alt || ''
    } else if (!linkEditorOpen.value) {
      linkUrl.value = currentEditor.getAttributes('link').href || ''
    }
  }
})

const issueLabels = computed(() => listIssueLabels(compatibility.value.issues))

function listIssueLabels(issues) {
  return issues.map(({ label }) => label).join(', ')
}

function loadMarkdown(markdown, currentEditor = editor.value) {
  sourceValue.value = markdown
  const inspection = inspectMarkdown(markdown)

  if (!inspection.supported) {
    setCompatibility({
      ...inspection,
      message: `Visual mode is unavailable because this file contains ${listIssueLabels(
        inspection.issues
      )}. Edit the Markdown source to preserve those constructs exactly.`
    })
    setModeValue('source')
    return false
  }

  if (!currentEditor) return false

  syncing.value = true
  try {
    currentEditor.commands.setContent(markdown, {
      contentType: 'markdown',
      emitUpdate: false
    })
  } catch {
    setCompatibility({
      supported: false,
      issues: [{ code: 'parse', label: 'syntax Visual mode cannot read' }],
      message:
        'Visual mode could not read this Markdown safely. Keep editing the source so the file remains unchanged.'
    })
    setModeValue('source')
    return false
  } finally {
    syncing.value = false
  }

  const serialized = preserveMarkdownEnvelope(
    currentEditor.getMarkdown(),
    markdown
  )
  if (
    !roundTripMatches(markdown, serialized, (value) =>
      currentEditor.markdown.parse(value)
    )
  ) {
    setCompatibility({
      supported: false,
      issues: [{ code: 'round-trip', label: 'syntax Visual mode cannot keep' }],
      message:
        'Visual mode would rewrite part of this file. Keep editing the Markdown source, or simplify the unsupported syntax before switching back.'
    })
    setModeValue('source')
    return false
  }

  setCompatibility({ supported: true, issues: [], message: '' })
  return true
}

function setMode(nextMode) {
  if (nextMode === 'source') {
    if (editor.value && mode.value === 'visual') {
      sourceValue.value = preserveMarkdownEnvelope(
        editor.value.getMarkdown(),
        sourceValue.value
      )
    }
    setModeValue('source')
    return true
  }

  if (!loadMarkdown(sourceValue.value)) return false
  setModeValue('visual')
  void nextTick(() => editor.value?.commands.focus('end'))
  return true
}

function setModeValue(nextMode) {
  mode.value = nextMode
  emit('mode-change', nextMode)
}

function setCompatibility(nextCompatibility) {
  compatibility.value = nextCompatibility
  emit('compatibility-change', nextCompatibility)
}

function updateSource(event) {
  const markdown = event.target.value
  sourceValue.value = markdown
  emit('update:modelValue', markdown)

  const inspection = inspectMarkdown(markdown)
  setCompatibility(
    inspection.supported
      ? { supported: true, issues: [], message: '' }
      : {
          ...inspection,
          message: `Visual mode is unavailable because this file contains ${listIssueLabels(
            inspection.issues
          )}.`
        }
  )
}

function shouldShowTextMenu({ editor: currentEditor, from, to }) {
  return (
    mode.value === 'visual' &&
    currentEditor.isEditable &&
    from !== to &&
    !currentEditor.isActive('image')
  )
}

function shouldShowImageMenu({ editor: currentEditor }) {
  return mode.value === 'visual' && currentEditor.isActive('image')
}

function toggleMark(mark) {
  editor.value?.chain().focus()[mark]().run()
}

function openLinkEditor() {
  linkError.value = ''
  linkUrl.value = editor.value?.getAttributes('link').href || ''
  linkEditorOpen.value = true
  void nextTick(() => {
    document.querySelector(`[data-test="${testHandle('link-input')}"]`)?.focus()
  })
}

function applyLink() {
  const url = normalizeLinkUrl(linkUrl.value)
  if (!url) {
    linkError.value = 'Use a safe web, email, phone, or relative link.'
    return
  }

  editor.value
    ?.chain()
    .focus()
    .extendMarkRange('link')
    .setLink({ href: url })
    .run()
  linkEditorOpen.value = false
  linkError.value = ''
}

function removeLink() {
  editor.value?.chain().focus().extendMarkRange('link').unsetLink().run()
  linkEditorOpen.value = false
  linkError.value = ''
}

function updateImageAlt() {
  editor.value
    ?.chain()
    .focus()
    .updateAttributes('image', { alt: imageAlt.value.trim() })
    .run()
}

function showUploadMessage(message, { kind = 'status', timeout = 0 } = {}) {
  clearTimeout(uploadMessageTimeout)
  uploadMessage.value = message
  uploadKind.value = kind

  if (timeout) {
    uploadMessageTimeout = setTimeout(() => {
      uploadMessage.value = ''
    }, timeout)
  }
}

async function uploadImages(files, position, currentEditor) {
  const images = Array.from(files || []).filter(
    (file) =>
      file.type.startsWith('image/') &&
      (props.uploadAccept.length === 0 ||
        props.uploadAccept.includes(file.type))
  )
  if (images.length === 0) return

  if (!props.uploadsConfigured || !props.uploadUrl) {
    showUploadMessage(
      'Image uploads are not configured. Paste a public image URL or configure uploads in Settings.',
      { kind: 'alert', timeout: 5000 }
    )
    return
  }

  if (position !== null && position !== undefined) {
    currentEditor.chain().focus().setTextSelection(position).run()
  }

  uploading.value = true
  showUploadMessage('Uploading image…')

  try {
    for (const file of images) {
      if (file.size > props.maxUploadBytes) {
        throw new Error(
          `${file.name} is larger than ${formatUploadBytes(
            props.maxUploadBytes
          )}.`
        )
      }

      const formData = new FormData()
      formData.append(props.uploadFieldName, file)
      formData.append('values', JSON.stringify(props.uploadValues))
      const response = await fetch(props.uploadUrl, {
        method: 'POST',
        body: formData
      })
      const result = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(result.message || 'The image could not be uploaded.')
      }

      const imageUrl = normalizeImageUrl(result.imageUrl || result.url)
      if (!imageUrl) throw new Error('The upload returned an unsafe image URL.')

      currentEditor
        .chain()
        .focus()
        .setImage({ src: imageUrl, alt: file.name.replace(/\.[^.]+$/, '') })
        .run()
    }

    showUploadMessage(
      images.length === 1 ? 'Image added.' : `${images.length} images added.`,
      { timeout: 3000 }
    )
  } catch (error) {
    showUploadMessage(error.message || 'The image could not be uploaded.', {
      kind: 'alert',
      timeout: 5000
    })
  } finally {
    uploading.value = false
  }
}

function chooseImage() {
  uploadInput.value?.click()
}

async function uploadSelectedImages(event) {
  await uploadImages(event.target.files, null, editor.value)
  event.target.value = ''
}

function formatUploadBytes(bytes) {
  if (bytes >= 1024 * 1024) {
    return `${Math.round(bytes / (1024 * 1024))} MB`
  }
  return `${Math.round(bytes / 1024)} KB`
}

onBeforeUnmount(() => {
  clearTimeout(uploadMessageTimeout)
})

watch(
  () => props.modelValue,
  (markdown) => {
    if (markdown === sourceValue.value) return
    sourceValue.value = markdown
    if (mode.value === 'visual') loadMarkdown(markdown)
  }
)

defineExpose({
  setMode,
  getMode: () => mode.value,
  canUseVisual: () => compatibility.value.supported
})
</script>

<template>
  <section
    :class="[
      'relative flex flex-col',
      isField ? 'markdown-editor--field' : 'min-h-full'
    ]"
    :aria-label="isField ? undefined : 'Content editor'"
  >
    <div
      v-if="mode === 'source' && shouldShowCompatibilityWarning"
      :data-test="testHandle('source-warning')"
      role="note"
      :class="[
        'flex w-full gap-3 rounded-lg text-sm text-amber-950 dark:text-amber-100',
        isField
          ? 'mb-3 bg-amber-50 px-3 py-2 dark:bg-amber-950/40'
          : 'mx-auto mt-6 max-w-3xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/70 dark:bg-amber-950/40'
      ]"
    >
      <svg
        class="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        aria-hidden="true"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="1.75"
          d="M12 9v4m0 4h.01M10.3 3.9 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
        />
      </svg>
      <div>
        <p class="font-medium">{{ compatibilityTitle }}</p>
        <p class="mt-0.5 leading-5 text-amber-800 dark:text-amber-200">
          {{ compatibility.message }}
        </p>
        <p v-if="issueLabels" class="sr-only">
          Unsupported constructs: {{ issueLabels }}
        </p>
      </div>
    </div>

    <div
      v-show="mode === 'visual'"
      :class="[
        'flex w-full flex-1',
        isField
          ? 'focus-within:border-brand border-b border-dashed border-gray-200 px-1 py-2 dark:border-gray-700'
          : 'mx-auto max-w-3xl px-5 pb-28 pt-10 sm:px-8 sm:pt-14'
      ]"
    >
      <EditorContent
        :editor="editor"
        :class="[
          'content-editor-canvas w-full',
          isField ? 'min-h-40' : 'min-h-[34rem]'
        ]"
      />
    </div>

    <div
      v-if="mode === 'source'"
      :class="[
        'flex w-full flex-1',
        isField
          ? 'focus-within:border-brand border-b border-dashed border-gray-200 px-1 py-2 dark:border-gray-700'
          : 'mx-auto max-w-4xl px-4 pb-24 pt-6 sm:px-8'
      ]"
    >
      <label class="sr-only" :for="elementId('markdown-source')"
        >{{ ariaLabel }} Markdown source</label
      >
      <textarea
        :id="elementId('markdown-source')"
        :value="sourceValue"
        :data-test="testHandle('markdown-source')"
        :class="[
          'w-full resize-none bg-transparent px-1 font-mono text-[15px] leading-7 text-gray-800 outline-none placeholder:text-gray-400 focus-visible:ring-0 dark:text-gray-200 dark:placeholder:text-gray-600',
          isField ? 'min-h-40 py-2' : 'min-h-[34rem] py-4'
        ]"
        :placeholder="sourcePlaceholder"
        :required="required"
        :aria-labelledby="ariaLabelledby || undefined"
        :aria-describedby="ariaDescribedby || undefined"
        spellcheck="false"
        @input="updateSource"
      ></textarea>
    </div>

    <div
      v-if="mode === 'visual' && showUploadControl && uploadsConfigured"
      class="min-h-9 mt-2 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400"
    >
      <input
        ref="uploadInput"
        :data-test="testHandle('image-input')"
        type="file"
        :accept="uploadAcceptValue"
        multiple
        class="sr-only"
        @change="uploadSelectedImages"
      />
      <button
        type="button"
        :disabled="uploading"
        class="min-h-9 inline-flex items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-gray-700 transition hover:bg-gray-100 disabled:cursor-wait disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-900"
        @click="chooseImage"
      >
        <svg
          class="size-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            d="M4 16.5 8.5 12l3 3 2-2 6.5 6.5M7.5 8.5h.01M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.5"
          />
        </svg>
        {{ uploading ? 'Uploading…' : 'Add image' }}
      </button>
      <span>or paste and drop</span>
    </div>

    <BubbleMenu
      v-if="editor"
      :editor="editor"
      :should-show="shouldShowTextMenu"
      :options="{ placement: 'top', offset: 10 }"
      :plugin-key="elementId('text-menu')"
    >
      <div
        :data-test="testHandle('format-menu')"
        class="flex items-center gap-0.5 rounded-lg bg-gray-900 p-1 text-white shadow-xl ring-1 ring-black/10 dark:bg-white dark:text-gray-900 dark:ring-white/10"
        role="toolbar"
        aria-label="Text formatting"
      >
        <template v-if="!linkEditorOpen">
          <button
            type="button"
            aria-label="Bold"
            title="Bold"
            :aria-pressed="editor.isActive('bold')"
            :class="[
              'min-w-8 h-8 rounded-md px-2 text-sm font-bold transition-colors',
              editor.isActive('bold')
                ? 'bg-white/20 dark:bg-gray-900/10'
                : 'hover:bg-white/10 dark:hover:bg-gray-900/5'
            ]"
            @mousedown.prevent="toggleMark('toggleBold')"
          >
            B
          </button>
          <button
            type="button"
            aria-label="Italic"
            title="Italic"
            :aria-pressed="editor.isActive('italic')"
            :class="[
              'min-w-8 h-8 rounded-md px-2 font-serif text-sm italic transition-colors',
              editor.isActive('italic')
                ? 'bg-white/20 dark:bg-gray-900/10'
                : 'hover:bg-white/10 dark:hover:bg-gray-900/5'
            ]"
            @mousedown.prevent="toggleMark('toggleItalic')"
          >
            I
          </button>
          <button
            type="button"
            aria-label="Add link"
            title="Add link"
            :aria-pressed="editor.isActive('link')"
            :class="[
              'grid h-8 w-8 place-items-center rounded-md transition-colors',
              editor.isActive('link')
                ? 'bg-white/20 dark:bg-gray-900/10'
                : 'hover:bg-white/10 dark:hover:bg-gray-900/5'
            ]"
            @mousedown.prevent="openLinkEditor"
          >
            <svg
              class="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.75"
                d="m10.5 13.5 3-3m-5.1 5.1-1.5 1.5a3 3 0 0 1-4.2-4.2l3-3a3 3 0 0 1 4.2 0m5.7-1.5 1.5-1.5a3 3 0 0 1 4.2 4.2l-3 3a3 3 0 0 1-4.2 0"
              />
            </svg>
          </button>
          <button
            type="button"
            aria-label="Strikethrough"
            title="Strikethrough"
            :aria-pressed="editor.isActive('strike')"
            :class="[
              'min-w-8 h-8 rounded-md px-2 text-sm line-through transition-colors',
              editor.isActive('strike')
                ? 'bg-white/20 dark:bg-gray-900/10'
                : 'hover:bg-white/10 dark:hover:bg-gray-900/5'
            ]"
            @mousedown.prevent="toggleMark('toggleStrike')"
          >
            S
          </button>
          <button
            type="button"
            aria-label="Inline code"
            title="Inline code"
            :aria-pressed="editor.isActive('code')"
            :class="[
              'min-w-8 h-8 rounded-md px-2 font-mono text-xs transition-colors',
              editor.isActive('code')
                ? 'bg-white/20 dark:bg-gray-900/10'
                : 'hover:bg-white/10 dark:hover:bg-gray-900/5'
            ]"
            @mousedown.prevent="toggleMark('toggleCode')"
          >
            &lt;/&gt;
          </button>
        </template>

        <form
          v-else
          class="flex items-center gap-1"
          @submit.prevent="applyLink"
        >
          <label class="sr-only" :for="elementId('link-url')">Link URL</label>
          <input
            :id="elementId('link-url')"
            v-model="linkUrl"
            :data-test="testHandle('link-input')"
            type="text"
            inputmode="url"
            autocomplete="off"
            placeholder="https://"
            class="h-8 w-48 rounded-md border-0 bg-white/10 px-2 text-sm text-white outline-none placeholder:text-gray-400 focus:ring-1 focus:ring-white/50 dark:bg-gray-900/5 dark:text-gray-900 dark:placeholder:text-gray-500 dark:focus:ring-gray-900/30"
            :aria-invalid="Boolean(linkError)"
            :aria-describedby="linkError ? elementId('link-error') : undefined"
          />
          <button
            type="submit"
            class="h-8 rounded-md bg-white px-2.5 text-xs font-medium text-gray-900 hover:bg-gray-100 dark:bg-gray-900 dark:text-white dark:hover:bg-gray-800"
          >
            Apply
          </button>
          <button
            v-if="editor.isActive('link')"
            type="button"
            class="h-8 rounded-md px-2 text-xs text-red-300 hover:bg-white/10 dark:text-red-600 dark:hover:bg-gray-900/5"
            @mousedown.prevent="removeLink"
          >
            Remove
          </button>
          <p
            v-if="linkError"
            :id="elementId('link-error')"
            class="sr-only"
            role="alert"
          >
            {{ linkError }}
          </p>
        </form>
      </div>
    </BubbleMenu>

    <BubbleMenu
      v-if="editor"
      :editor="editor"
      :should-show="shouldShowImageMenu"
      :options="{ placement: 'top', offset: 10 }"
      :plugin-key="elementId('image-menu')"
    >
      <form
        :data-test="testHandle('image-menu')"
        class="flex items-center gap-1 rounded-lg bg-gray-900 p-1 text-white shadow-xl ring-1 ring-black/10 dark:bg-white dark:text-gray-900 dark:ring-white/10"
        @submit.prevent="updateImageAlt"
      >
        <label class="sr-only" :for="elementId('image-alt')"
          >Image alt text</label
        >
        <input
          :id="elementId('image-alt')"
          v-model="imageAlt"
          type="text"
          placeholder="Describe this image"
          class="h-8 w-56 rounded-md border-0 bg-white/10 px-2 text-sm text-white outline-none placeholder:text-gray-400 focus:ring-1 focus:ring-white/50 dark:bg-gray-900/5 dark:text-gray-900 dark:placeholder:text-gray-500 dark:focus:ring-gray-900/30"
        />
        <button
          type="submit"
          class="h-8 rounded-md bg-white px-2.5 text-xs font-medium text-gray-900 hover:bg-gray-100 dark:bg-gray-900 dark:text-white dark:hover:bg-gray-800"
        >
          Save alt
        </button>
      </form>
    </BubbleMenu>

    <p
      v-if="uploadMessage"
      class="pointer-events-none fixed bottom-5 left-1/2 z-20 -translate-x-1/2 rounded-full bg-gray-900 px-3 py-1.5 text-xs font-medium text-white shadow-lg dark:bg-white dark:text-gray-900"
      :role="uploadKind"
      :aria-live="uploadKind === 'alert' ? 'assertive' : 'polite'"
    >
      {{ uploadMessage }}
    </p>
  </section>
</template>

<style scoped>
:deep(.tiptap) {
  min-height: 34rem;
  color: var(--color-gray-800);
  font-size: 1.0625rem;
  line-height: 1.8;
  outline: none;
}

:deep(.tiptap > :first-child) {
  margin-top: 0;
}

:deep(.tiptap p) {
  margin: 1.1em 0;
}

:deep(.tiptap h1),
:deep(.tiptap h2),
:deep(.tiptap h3),
:deep(.tiptap h4) {
  color: var(--color-gray-950);
  font-weight: 700;
  letter-spacing: -0.025em;
  line-height: 1.2;
  text-wrap: balance;
}

:deep(.tiptap h1) {
  margin: 0.75em 0 0.45em;
  font-size: clamp(2rem, 4vw, 2.75rem);
}

:deep(.tiptap h2) {
  margin: 1.8em 0 0.55em;
  font-size: 1.75rem;
}

:deep(.tiptap h3) {
  margin: 1.6em 0 0.5em;
  font-size: 1.35rem;
}

:deep(.tiptap h4) {
  margin: 1.5em 0 0.45em;
  font-size: 1.1rem;
}

:deep(.tiptap strong) {
  color: var(--color-gray-950);
  font-weight: 650;
}

:deep(.tiptap a) {
  color: var(--color-brand-700);
  text-decoration: underline;
  text-decoration-color: var(--color-brand-300);
  text-decoration-thickness: 1px;
  text-underline-offset: 0.2em;
}

:deep(.tiptap a:hover) {
  text-decoration-color: currentColor;
}

:deep(.tiptap ul),
:deep(.tiptap ol) {
  margin: 1.25em 0;
  padding-left: 1.5em;
}

:deep(.tiptap ul) {
  list-style: disc;
}

:deep(.tiptap ol) {
  list-style: decimal;
}

:deep(.tiptap li) {
  margin: 0.35em 0;
  padding-left: 0.25em;
}

:deep(.tiptap blockquote) {
  margin: 1.6em 0;
  border-left: 2px solid var(--color-brand-500);
  padding-left: 1.15em;
  color: var(--color-gray-600);
  font-style: italic;
}

:deep(.tiptap code) {
  border-radius: 0.3rem;
  background: var(--color-gray-100);
  padding: 0.12em 0.35em;
  color: var(--color-gray-800);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.86em;
}

:deep(.tiptap pre) {
  margin: 1.6em 0;
  overflow-x: auto;
  border-radius: 0.6rem;
  background: var(--color-gray-950);
  padding: 1.1rem 1.2rem;
  color: var(--color-gray-100);
  font-size: 0.9rem;
  line-height: 1.65;
}

:deep(.tiptap pre code) {
  background: transparent;
  padding: 0;
  color: inherit;
  font-size: inherit;
}

:deep(.tiptap hr) {
  margin: 2.5rem auto;
  width: 4rem;
  border: 0;
  border-top: 1px solid var(--color-gray-300);
}

:deep(.tiptap img) {
  margin: 2rem 0;
  max-height: 36rem;
  width: 100%;
  border-radius: 0.65rem;
  object-fit: cover;
}

:deep(.tiptap img.ProseMirror-selectednode) {
  outline: 2px solid var(--color-brand);
  outline-offset: 3px;
}

:deep(.tiptap p.is-editor-empty:first-child::before) {
  pointer-events: none;
  float: left;
  height: 0;
  color: var(--color-gray-400);
  content: attr(data-placeholder);
}

.markdown-editor--field :deep(.tiptap) {
  min-height: 10rem;
  font-size: 0.9375rem;
  line-height: 1.7;
}

.markdown-editor--field :deep(.tiptap p) {
  margin: 0.65em 0;
}

.markdown-editor--field :deep(.tiptap h1) {
  margin: 0.7em 0 0.4em;
  font-size: 1.5rem;
}

.markdown-editor--field :deep(.tiptap h2) {
  margin: 1.1em 0 0.45em;
  font-size: 1.25rem;
}

.markdown-editor--field :deep(.tiptap h3) {
  margin: 1em 0 0.4em;
  font-size: 1.125rem;
}

.markdown-editor--field :deep(.tiptap h4) {
  margin: 0.9em 0 0.35em;
  font-size: 1rem;
}

.markdown-editor--field :deep(.tiptap ul),
.markdown-editor--field :deep(.tiptap ol),
.markdown-editor--field :deep(.tiptap blockquote),
.markdown-editor--field :deep(.tiptap pre) {
  margin: 0.9em 0;
}

.markdown-editor--field :deep(.tiptap hr) {
  margin: 1.5rem auto;
}

@media (prefers-color-scheme: dark) {
  :deep(.tiptap) {
    color: var(--color-gray-300);
  }

  :deep(.tiptap h1),
  :deep(.tiptap h2),
  :deep(.tiptap h3),
  :deep(.tiptap h4),
  :deep(.tiptap strong) {
    color: var(--color-gray-50);
  }

  :deep(.tiptap a) {
    color: var(--color-brand-300);
    text-decoration-color: var(--color-brand-700);
  }

  :deep(.tiptap blockquote) {
    color: var(--color-gray-400);
  }

  :deep(.tiptap code) {
    background: var(--color-gray-800);
    color: var(--color-gray-200);
  }

  :deep(.tiptap pre) {
    background: #050505;
  }

  :deep(.tiptap hr) {
    border-color: var(--color-gray-700);
  }
}

@media (max-width: 639px) {
  :deep(.tiptap) {
    min-height: 28rem;
    font-size: 1rem;
    line-height: 1.75;
  }

  :deep(.tiptap h1) {
    font-size: 2rem;
  }
}
</style>
