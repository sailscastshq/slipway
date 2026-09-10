<script setup>
import ExternalLink from '@/components/ui/icons/ExternalLink.vue'
import { computed } from 'vue'
import {
  bridgeFieldType,
  formatBridgeFieldValue
} from '@/lib/bridge/fields.mjs'
import { resolveBridgeFieldComponent } from '@/lib/bridge/field-components.mjs'
import {
  renderBridgeMarkdown,
  bridgeMarkdownPreview
} from '@/lib/bridge/markdown.mjs'
import Badge from '@/components/ui/badge/Badge.vue'

const props = defineProps({
  name: {
    type: String,
    required: true
  },
  attribute: {
    type: Object,
    required: true
  },
  value: {
    default: null
  },
  context: {
    type: String,
    default: 'show',
    validator: (value) => ['list', 'show'].includes(value)
  }
})

const formatted = computed(() =>
  formatBridgeFieldValue(props.value, props.attribute, props.context)
)
const customComponent = computed(() =>
  resolveBridgeFieldComponent(props.attribute.field?.component, props.context)
)
const isCompact = computed(() => props.context === 'list')
const fieldType = computed(() => bridgeFieldType(props.attribute))
const markdownHtml = computed(() =>
  formatted.value.kind === 'markdown' ? renderBridgeMarkdown(props.value) : ''
)
const markdownPreview = computed(() =>
  isCompact.value && formatted.value.kind === 'markdown'
    ? bridgeMarkdownPreview(markdownHtml.value)
    : ''
)
</script>

<template>
  <component
    :is="customComponent"
    v-if="customComponent"
    :name="name"
    :attribute="attribute"
    :value="value"
    :context="context"
  />

  <span
    v-else-if="formatted.kind === 'null'"
    class="text-gray-300 dark:text-gray-600"
  >
    null
  </span>

  <span
    v-else-if="formatted.kind === 'boolean' && isCompact"
    class="inline-flex items-center gap-2"
  >
    <span
      :class="[
        'h-2 w-2 rounded-full',
        formatted.value ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'
      ]"
      aria-hidden="true"
    ></span>
    <span class="sr-only">{{ formatted.display }}</span>
  </span>

  <Badge
    v-else-if="formatted.kind === 'boolean'"
    :class="[
      'px-2 py-0.5 text-xs',
      formatted.value
        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400'
        : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
    ]"
  >
    {{ formatted.display }}
  </Badge>

  <a
    v-else-if="formatted.kind === 'image' && formatted.url"
    :href="formatted.url"
    target="_blank"
    rel="noreferrer"
    :class="[
      'inline-flex overflow-hidden bg-gray-100 dark:bg-gray-800',
      isCompact ? 'h-8 w-12 rounded-md' : 'max-h-48 max-w-xs rounded-lg'
    ]"
  >
    <img
      :src="formatted.url"
      :alt="`${attribute.label || name} preview`"
      :class="
        isCompact
          ? 'h-full w-full object-cover'
          : 'h-auto w-auto object-contain'
      "
      loading="lazy"
    />
  </a>

  <a
    v-else-if="['file', 'url'].includes(formatted.kind) && formatted.url"
    :href="formatted.url"
    target="_blank"
    rel="noreferrer"
    :title="formatted.kind === 'url' ? formatted.display : undefined"
    class="inline-flex max-w-full items-center gap-1.5 text-gray-900 hover:underline dark:text-white"
  >
    <span :class="isCompact ? 'max-w-52 truncate' : 'break-all'">
      {{ formatted.display }}
    </span>
    <ExternalLink class="h-3.5 w-3.5 shrink-0 text-gray-400" />
  </a>

  <a
    v-else-if="formatted.kind === 'email'"
    :href="`mailto:${formatted.email}`"
    class="break-all text-gray-900 hover:underline dark:text-white"
  >
    {{ formatted.display }}
  </a>

  <pre
    v-else-if="formatted.kind === 'json' && !isCompact"
    class="max-h-56 overflow-auto rounded-lg bg-gray-50 p-3 font-mono text-xs leading-5 text-gray-700 dark:bg-gray-950 dark:text-gray-300"
    >{{ formatted.display }}</pre
  >

  <span
    v-else-if="formatted.kind === 'markdown' && isCompact"
    class="max-w-72 block truncate"
    >{{ markdownPreview }}</span
  >
  <div
    v-else-if="formatted.kind === 'markdown'"
    class="bridge-markdown min-w-0 max-w-full break-words text-sm leading-6"
    v-html="markdownHtml"
  />

  <span
    v-else
    :class="[
      fieldType === 'currency' ? 'tabular-nums' : '',
      formatted.kind === 'longtext' && !isCompact
        ? 'whitespace-pre-wrap break-words leading-6'
        : isCompact
        ? 'max-w-72 block truncate'
        : 'break-all'
    ]"
    :title="isCompact ? String(value ?? '') : undefined"
  >
    {{ formatted.display }}
  </span>
</template>

<style scoped>
.bridge-markdown :deep(p) {
  margin: 0.5em 0;
}
.bridge-markdown :deep(:first-child) {
  margin-top: 0;
}
.bridge-markdown :deep(h1),
.bridge-markdown :deep(h2),
.bridge-markdown :deep(h3),
.bridge-markdown :deep(h4) {
  margin: 1em 0 0.5em;
  font-weight: 600;
  font-size: 1.1em;
}
.bridge-markdown :deep(ul) {
  list-style: disc;
  padding-left: 1.5em;
}
.bridge-markdown :deep(ol) {
  list-style: decimal;
  padding-left: 1.5em;
}
.bridge-markdown :deep(li) {
  margin: 0.25em 0;
}
.bridge-markdown :deep(a) {
  color: var(--color-brand);
  text-decoration: underline;
}
.bridge-markdown :deep(pre) {
  max-width: 100%;
  overflow-x: auto;
  padding: 0.75rem;
  background: var(--color-gray-100);
  border-radius: 0.375rem;
  margin: 0.75em 0;
}
.bridge-markdown :deep(code) {
  font-family: monospace;
  font-size: 0.9em;
}
.bridge-markdown :deep(blockquote) {
  border-left: 2px solid var(--color-gray-300);
  padding-left: 1em;
}
@media (prefers-color-scheme: dark) {
  .bridge-markdown :deep(pre) {
    background: var(--color-gray-900);
  }
}
</style>
