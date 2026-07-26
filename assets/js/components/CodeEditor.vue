<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab
} from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import { sql } from '@codemirror/lang-sql'
import {
  HighlightStyle,
  StreamLanguage,
  bracketMatching,
  indentOnInput,
  syntaxHighlighting
} from '@codemirror/language'
import { Compartment, EditorState } from '@codemirror/state'
import {
  EditorView,
  drawSelection,
  keymap,
  placeholder as editorPlaceholder
} from '@codemirror/view'
import { tags } from '@lezer/highlight'

const props = defineProps({
  modelValue: { type: String, default: '' },
  language: {
    type: String,
    default: 'plain',
    validator: (value) => ['plain', 'javascript', 'sql', 'env'].includes(value)
  },
  placeholder: { type: String, default: '' },
  ariaLabel: { type: String, default: 'Code editor' },
  testId: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  submitOnModEnter: { type: Boolean, default: false },
  height: {
    type: String,
    default: 'content',
    validator: (value) => ['content', 'fill'].includes(value)
  },
  minHeight: { type: String, default: '5.25rem' },
  maxHeight: { type: String, default: '' },
  padding: {
    type: String,
    default: 'normal',
    validator: (value) => ['normal', 'compact'].includes(value)
  }
})

const emit = defineEmits(['update:modelValue', 'submit'])

const editorHost = ref(null)
const languageCompartment = new Compartment()
const appearanceCompartment = new Compartment()
const editableCompartment = new Compartment()
let view
let darkModeQuery
let applyingExternalValue = false

const editorStyle = computed(() => ({
  '--code-editor-min-height': props.minHeight,
  '--code-editor-max-height': props.maxHeight || 'none',
  '--code-editor-padding': props.padding === 'compact' ? '0.75rem' : '1rem'
}))

const envLanguage = StreamLanguage.define({
  startState: () => ({ beforeEquals: true }),
  token(stream, state) {
    if (stream.sol()) state.beforeEquals = true
    if (stream.eatSpace()) return null

    if (state.beforeEquals && stream.peek() === '#') {
      stream.skipToEnd()
      return 'comment'
    }

    if (
      state.beforeEquals &&
      stream.match(/[A-Za-z_][A-Za-z0-9_.-]*(?=\s*=)/)
    ) {
      return 'propertyName'
    }

    if (state.beforeEquals && stream.eat('=')) {
      state.beforeEquals = false
      return 'operator'
    }

    stream.skipToEnd()
    return state.beforeEquals ? null : 'string'
  }
})

function languageExtension(language) {
  if (language === 'sql') return sql()
  if (language === 'javascript') return javascript()
  if (language === 'env') return envLanguage
  return []
}

function editorTheme(isDark) {
  const palette = isDark
    ? {
        text: '#f5f5f5',
        caret: '#f5f5f5',
        placeholder: '#525252',
        selection: '#075985',
        matchingBracket: '#404040'
      }
    : {
        text: '#171717',
        caret: '#171717',
        placeholder: '#a3a3a3',
        selection: '#bae6fd',
        matchingBracket: '#e5e5e5'
      }

  return EditorView.theme(
    {
      '&': {
        height: props.height === 'fill' ? '100%' : 'auto',
        color: palette.text,
        backgroundColor: 'transparent',
        fontSize: '0.875rem'
      },
      '&.cm-focused': {
        outline: 'none'
      },
      '.cm-scroller': {
        minHeight: 'inherit',
        maxHeight: 'inherit',
        fontFamily:
          'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
        lineHeight: '1.5rem'
      },
      '.cm-content': {
        minHeight: 'inherit',
        padding: 'var(--code-editor-padding) 0',
        caretColor: palette.caret
      },
      '.cm-line': {
        padding: '0 var(--code-editor-padding)'
      },
      '.cm-cursor, .cm-dropCursor': {
        borderLeftColor: palette.caret
      },
      '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection':
        {
          backgroundColor: `${palette.selection} !important`
        },
      '.cm-placeholder': {
        color: palette.placeholder,
        fontStyle: 'normal'
      },
      '.cm-matchingBracket': {
        backgroundColor: palette.matchingBracket,
        outline: 'none'
      }
    },
    { dark: isDark }
  )
}

function highlightStyle(language, isDark) {
  const colors = isDark
    ? {
        text: '#f5f5f5',
        comment: '#737373',
        keyword: language === 'sql' ? '#f472b6' : '#c084fc',
        string:
          language === 'sql'
            ? '#fbbf24'
            : language === 'env'
            ? '#d4d4d4'
            : '#4ade80',
        number: language === 'sql' ? '#c084fc' : '#fb923c',
        name: language === 'env' ? '#fbbf24' : '#22d3ee',
        punctuation: '#a3a3a3',
        operator: language === 'env' ? '#525252' : '#a3a3a3'
      }
    : {
        text: '#171717',
        comment: '#a3a3a3',
        keyword: language === 'sql' ? '#db2777' : '#9333ea',
        string:
          language === 'sql'
            ? '#d97706'
            : language === 'env'
            ? '#404040'
            : '#16a34a',
        number: language === 'sql' ? '#9333ea' : '#ea580c',
        name: language === 'env' ? '#d97706' : '#0891b2',
        punctuation: '#737373',
        operator: language === 'env' ? '#a3a3a3' : '#737373'
      }

  return HighlightStyle.define([
    { tag: tags.comment, color: colors.comment },
    { tag: tags.keyword, color: colors.keyword },
    { tag: [tags.string, tags.special(tags.string)], color: colors.string },
    { tag: [tags.number, tags.bool, tags.null], color: colors.number },
    {
      tag: [
        tags.propertyName,
        tags.function(tags.variableName),
        tags.standard(tags.name),
        tags.typeName
      ],
      color: colors.name
    },
    { tag: [tags.operator, tags.definitionOperator], color: colors.operator },
    {
      tag: [tags.punctuation, tags.bracket, tags.separator],
      color: colors.punctuation
    },
    { tag: tags.content, color: colors.text }
  ])
}

function appearanceExtension() {
  const isDark = darkModeQuery?.matches ?? false
  return [
    editorTheme(isDark),
    syntaxHighlighting(highlightStyle(props.language, isDark))
  ]
}

function editableExtension() {
  const attributes = {
    'aria-label': props.ariaLabel,
    'aria-disabled': String(props.disabled),
    'aria-multiline': 'true',
    autocapitalize: 'off',
    autocomplete: 'off',
    spellcheck: 'false'
  }
  if (props.testId) attributes['data-test'] = props.testId

  return [
    EditorState.readOnly.of(props.disabled),
    EditorView.editable.of(!props.disabled),
    EditorView.contentAttributes.of(attributes)
  ]
}

function submitKeymap() {
  if (!props.submitOnModEnter) return []
  return [
    {
      key: 'Mod-Enter',
      run() {
        emit('submit')
        return true
      }
    }
  ]
}

function handleColorSchemeChange() {
  if (!view) return
  view.dispatch({
    effects: appearanceCompartment.reconfigure(appearanceExtension())
  })
}

onMounted(() => {
  darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)')
  darkModeQuery.addEventListener('change', handleColorSchemeChange)

  view = new EditorView({
    parent: editorHost.value,
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        EditorView.lineWrapping,
        keymap.of([
          ...submitKeymap(),
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap
        ]),
        props.placeholder ? editorPlaceholder(props.placeholder) : [],
        languageCompartment.of(languageExtension(props.language)),
        appearanceCompartment.of(appearanceExtension()),
        editableCompartment.of(editableExtension()),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged || applyingExternalValue) return
          emit('update:modelValue', update.state.doc.toString())
        })
      ]
    })
  })
})

watch(
  () => props.modelValue,
  (value) => {
    if (!view || value === view.state.doc.toString()) return
    applyingExternalValue = true
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value }
    })
    applyingExternalValue = false
  }
)

watch(
  () => props.language,
  (language) => {
    if (!view) return
    view.dispatch({
      effects: [
        languageCompartment.reconfigure(languageExtension(language)),
        appearanceCompartment.reconfigure(appearanceExtension())
      ]
    })
  }
)

watch(
  () => [props.disabled, props.ariaLabel, props.testId],
  () => {
    if (!view) return
    view.dispatch({
      effects: editableCompartment.reconfigure(editableExtension())
    })
  }
)

onBeforeUnmount(() => {
  darkModeQuery?.removeEventListener('change', handleColorSchemeChange)
  view?.destroy()
})
</script>

<template>
  <div
    ref="editorHost"
    data-code-editor
    :data-test="testId ? `${testId}-container` : undefined"
    :class="[
      'code-editor min-w-0',
      height === 'fill' ? 'code-editor--fill h-full' : 'code-editor--content'
    ]"
    :style="editorStyle"
  ></div>
</template>

<style scoped>
.code-editor--fill :deep(.cm-editor),
.code-editor--fill :deep(.cm-scroller) {
  height: 100%;
}

.code-editor--content :deep(.cm-editor),
.code-editor--content :deep(.cm-scroller),
.code-editor--content :deep(.cm-content) {
  min-height: var(--code-editor-min-height);
}

.code-editor--content :deep(.cm-scroller) {
  max-height: var(--code-editor-max-height);
  overflow: auto;
}

.code-editor :deep(.cm-editor.cm-focused) {
  outline: 1px solid var(--color-brand-200);
  outline-offset: -1px;
}

.code-editor :deep(.cm-content:focus-visible) {
  outline: none;
}

@media (prefers-color-scheme: dark) {
  .code-editor :deep(.cm-editor.cm-focused) {
    outline-color: var(--color-brand-800);
  }
}
</style>
