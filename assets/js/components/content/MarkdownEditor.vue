<script setup>
import { computed, ref, watch } from 'vue'
import { BubbleMenu } from '@tiptap/vue-3/menus'
import RichText from '@/components/ui/rich-text/RichText.vue'
import Alert from '@/components/ui/alert/Alert.vue'
import WarningTriangle from '@/components/ui/icons/WarningTriangle.vue'
import LinkIcon from '@/components/ui/icons/Link.vue'
import ImageIcon from '@/components/ui/icons/Image.vue'
import {
  inspectMarkdown,
  normalizeImageUrl
} from '@/components/ui/rich-text/rich-text.js'

defineOptions({ inheritAttrs: false })
const props = defineProps({
  modelValue: { type: String, default: '' },
  uploadsConfigured: Boolean,
  uploadUrl: { type: String, default: '' },
  uploadFieldName: { type: String, default: 'image' },
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
  maxUploadBytes: { type: Number, default: 5 * 1024 * 1024 },
  uploadValues: { type: Object, default: () => ({}) },
  showUploadControl: Boolean,
  variant: {
    type: String,
    default: 'document',
    validator: (value) => ['document', 'field'].includes(value)
  },
  editorId: { type: String, default: 'content' },
  placeholder: { type: String, default: 'Start writing…' },
  ariaLabel: { type: String, default: 'Document body' },
  ariaLabelledby: { type: String, default: '' },
  ariaDescribedby: { type: String, default: '' },
  required: Boolean,
  denyRawHtml: Boolean
})
const emit = defineEmits([
  'update:modelValue',
  'mode-change',
  'compatibility-change',
  'blur'
])
const richText = ref()
const mode = ref('visual')
const isField = computed(() => props.variant === 'field')
const compatibility = computed(() => {
  const inspection = inspectMarkdown(props.modelValue)
  return {
    ...inspection,
    message: inspection.supported
      ? ''
      : `Keep editing the source to preserve ${inspection.issues
          .map((issue) => issue.label)
          .join(', ')}.`
  }
})
const showCompatibilityWarning = computed(
  () =>
    compatibility.value.message &&
    !(
      props.denyRawHtml &&
      compatibility.value.issues.some(({ code }) =>
        ['html-comments', 'raw-html', 'mdx'].includes(code)
      )
    )
)
const imageUpload = computed(() =>
  props.uploadsConfigured && props.uploadUrl ? uploadImage : undefined
)

watch(compatibility, (value) => emit('compatibility-change', value), {
  immediate: true
})

async function uploadImage(file, { signal }) {
  if (!props.uploadsConfigured || !props.uploadUrl) {
    throw new Error('Image uploads are not configured.')
  }
  if (!props.uploadAccept.includes(file.type)) {
    throw new Error('That image type is not accepted.')
  }
  if (file.size > props.maxUploadBytes) {
    throw new Error(
      `${file.name} is larger than ${Math.round(
        props.maxUploadBytes / 1024 / 1024
      )} MB.`
    )
  }
  const formData = new FormData()
  formData.append(props.uploadFieldName, file)
  formData.append('values', JSON.stringify(props.uploadValues))
  const response = await fetch(props.uploadUrl, {
    method: 'POST',
    body: formData,
    signal
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(result.message || 'The image could not be uploaded.')
  }
  const src = normalizeImageUrl(result.imageUrl || result.url)
  if (!src) throw new Error('The upload returned an unsafe image URL.')
  return { src, alt: file.name.replace(/\.[^.]+$/, '') }
}

function updateMode(value) {
  mode.value = value
  emit('mode-change', value)
}

function shouldShowTextMenu({ editor }) {
  return (
    mode.value === 'visual' &&
    !editor.state.selection.empty &&
    !editor.isActive('image')
  )
}

function shouldShowImageMenu({ editor }) {
  return mode.value === 'visual' && editor.isActive('image')
}

function toggleMark(editor, command) {
  editor.chain().focus()[command]().run()
}

defineExpose({
  setMode: (value) => richText.value?.setMode(value),
  getMode: () => richText.value?.getMode() || mode.value
})
</script>

<template>
  <section
    :data-test="`${editorId}-editor`"
    :class="[
      'relative flex flex-col',
      isField ? 'markdown-editor--field' : 'min-h-full'
    ]"
    :aria-label="isField ? undefined : 'Content editor'"
  >
    <Alert
      v-if="mode === 'source' && showCompatibilityWarning"
      :data-test="`${editorId}-source-warning`"
      role="note"
      :class="[
        'flex w-full gap-3 rounded-lg text-sm text-amber-950 dark:text-amber-100',
        isField
          ? 'mb-3 bg-amber-50 px-3 py-2 dark:bg-amber-950/40'
          : 'mx-auto mt-6 max-w-3xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/70 dark:bg-amber-950/40'
      ]"
    >
      <WarningTriangle
        class="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
        stroke-width="1.75"
      />
      <div>
        <p class="font-medium">
          {{
            isField
              ? 'This value is safest in Markdown'
              : 'This document is safest in Markdown'
          }}
        </p>
        <p class="mt-0.5 leading-5 text-amber-800 dark:text-amber-200">
          {{ compatibility.message }}
        </p>
      </div>
    </Alert>

    <RichText
      ref="richText"
      v-bind="$attrs"
      :model-value="modelValue"
      :data-test="`${editorId}-visual-editor`"
      format="markdown"
      :placeholder="placeholder"
      :required="required"
      :aria-label="ariaLabelledby ? undefined : ariaLabel"
      :aria-labelledby="ariaLabelledby || undefined"
      :aria-describedby="ariaDescribedby || $attrs['aria-describedby']"
      :upload="imageUpload"
      :class="[
        'markdown-editor-klean border-0 bg-transparent shadow-none focus-within:border-transparent focus-within:outline-none dark:border-0 dark:bg-transparent',
        isField
          ? 'rounded-none border-b border-dashed border-gray-200 dark:border-gray-700'
          : 'mx-auto max-w-3xl rounded-none'
      ]"
      @update:model-value="emit('update:modelValue', $event)"
      @mode-change="updateMode"
      @blur="emit('blur', $event)"
    >
      <template
        #toolbar="{ editor, mode: currentMode, setMode, openLink, openImage }"
      >
        <div v-if="isField" class="flex items-center justify-end gap-1 py-1">
          <button
            type="button"
            :data-test="`${editorId}-visual-mode`"
            :aria-pressed="currentMode === 'visual'"
            class="rounded px-2 py-1 text-xs text-gray-500 hover:text-gray-900 aria-pressed:text-gray-900 dark:text-gray-400 dark:hover:text-white dark:aria-pressed:text-white"
            @click="setMode('visual')"
          >
            Write
          </button>
          <button
            type="button"
            :data-test="`${editorId}-source-mode`"
            :aria-pressed="currentMode === 'source'"
            class="rounded px-2 py-1 text-xs text-gray-500 hover:text-gray-900 aria-pressed:text-gray-900 dark:text-gray-400 dark:hover:text-white dark:aria-pressed:text-white"
            @click="setMode('source')"
          >
            Source
          </button>
          <button
            v-if="showUploadControl && uploadsConfigured"
            type="button"
            :data-test="`${editorId}-image-button`"
            aria-label="Add image"
            class="rounded p-1 text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
            @click="openImage"
          >
            <ImageIcon class="size-4" />
          </button>
        </div>
        <BubbleMenu
          v-if="editor"
          :editor="editor"
          :should-show="shouldShowTextMenu"
          :options="{ placement: 'top', offset: 10 }"
          :plugin-key="`${editorId}-text-menu`"
        >
          <div
            :data-test="`${editorId}-format-menu`"
            class="flex items-center gap-0.5 rounded-lg bg-gray-900 p-1 text-white shadow-xl ring-1 ring-black/10 dark:bg-white dark:text-gray-900"
            role="toolbar"
            aria-label="Text formatting"
          >
            <button
              v-for="tool in [
                {
                  name: 'Bold',
                  text: 'B',
                  command: 'toggleBold',
                  class: 'font-bold'
                },
                {
                  name: 'Italic',
                  text: 'I',
                  command: 'toggleItalic',
                  class: 'italic font-serif'
                },
                {
                  name: 'Strikethrough',
                  text: 'S',
                  command: 'toggleStrike',
                  class: 'line-through'
                },
                {
                  name: 'Inline code',
                  text: '</>',
                  command: 'toggleCode',
                  class: 'font-mono text-xs'
                }
              ]"
              :key="tool.name"
              type="button"
              :aria-label="tool.name"
              :aria-pressed="
                editor.isActive(
                  tool.command.replace('toggle', '').toLowerCase()
                )
              "
              :class="[
                'min-w-8 h-8 rounded-md px-2 hover:bg-white/10 dark:hover:bg-gray-900/10',
                tool.class
              ]"
              @mousedown.prevent="toggleMark(editor, tool.command)"
            >
              {{ tool.text }}
            </button>
            <button
              type="button"
              aria-label="Add link"
              class="grid h-8 w-8 place-items-center rounded-md hover:bg-white/10 dark:hover:bg-gray-900/10"
              @mousedown.prevent
              @click="openLink"
            >
              <LinkIcon class="h-4 w-4" />
            </button>
          </div>
        </BubbleMenu>
        <BubbleMenu
          v-if="editor"
          :editor="editor"
          :should-show="shouldShowImageMenu"
          :options="{ placement: 'top', offset: 10 }"
          :plugin-key="`${editorId}-image-menu`"
        >
          <button
            type="button"
            aria-label="Edit image"
            class="rounded-lg bg-gray-900 p-2 text-xs text-white shadow-xl dark:bg-white dark:text-gray-900"
            @mousedown.prevent
            @click="openImage"
          >
            Edit image
          </button>
        </BubbleMenu>
      </template>
    </RichText>
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
  display: block;
  max-width: 100%;
  max-height: none;
  height: auto;
  border-radius: 0.65rem;
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
