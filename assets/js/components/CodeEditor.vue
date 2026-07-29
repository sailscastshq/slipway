<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab
} from '@codemirror/commands'
import { autocompletion, completionKeymap } from '@codemirror/autocomplete'
import { javascript } from '@codemirror/lang-javascript'
import { sql } from '@codemirror/lang-sql'
import {
  HighlightStyle,
  StreamLanguage,
  bracketMatching,
  indentOnInput,
  syntaxHighlighting
} from '@codemirror/language'
import { setDiagnostics } from '@codemirror/lint'
import {
  Compartment,
  EditorState,
  StateEffect,
  StateField
} from '@codemirror/state'
import {
  Decoration,
  EditorView,
  WidgetType,
  drawSelection,
  keymap,
  placeholder as editorPlaceholder
} from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { createHelmCompletionSource } from '@/lib/helmCompletions.mjs'

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
  completionMetadata: { type: Object, default: null },
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

const emit = defineEmits(['update:modelValue', 'submit', 'selection-change'])

const editorHost = ref(null)
const languageCompartment = new Compartment()
const appearanceCompartment = new Compartment()
const editableCompartment = new Compartment()
const completionCompartment = new Compartment()
const setExecutedRange = StateEffect.define()
const setInlineDiagnostic = StateEffect.define()
const executedRangeMark = Decoration.mark({ class: 'cm-executed-range' })

class InlineDiagnosticWidget extends WidgetType {
  constructor(message) {
    super()
    this.message = message
  }

  eq(other) {
    return other.message === this.message
  }

  toDOM() {
    const label = document.createElement('span')
    label.className = 'cm-inline-diagnostic'
    label.textContent = this.message
    label.title = this.message
    label.setAttribute('aria-hidden', 'true')
    return label
  }

  ignoreEvent() {
    return true
  }
}

const executedRangeField = StateField.define({
  create() {
    return Decoration.none
  },
  update(decorations, transaction) {
    let nextDecorations = decorations.map(transaction.changes)

    for (const effect of transaction.effects) {
      if (!effect.is(setExecutedRange)) continue
      const range = effect.value
      nextDecorations =
        range && range.from < range.to
          ? Decoration.set([executedRangeMark.range(range.from, range.to)])
          : Decoration.none
    }

    return nextDecorations
  },
  provide(field) {
    return EditorView.decorations.from(field)
  }
})
const inlineDiagnosticField = StateField.define({
  create() {
    return Decoration.none
  },
  update(decorations, transaction) {
    let nextDecorations = transaction.docChanged
      ? Decoration.none
      : decorations.map(transaction.changes)

    for (const effect of transaction.effects) {
      if (!effect.is(setInlineDiagnostic)) continue
      const diagnostic = effect.value
      nextDecorations = diagnostic
        ? Decoration.set([
            Decoration.widget({
              widget: new InlineDiagnosticWidget(diagnostic.message),
              side: 1
            }).range(diagnostic.position)
          ])
        : Decoration.none
    }

    return nextDecorations
  },
  provide(field) {
    return EditorView.decorations.from(field)
  }
})
let view
let darkModeQuery
let applyingExternalValue = false
let executedRangeTimer

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
        matchingBracket: '#404040',
        completionBackground: '#171717',
        completionBorder: '#404040',
        completionSelected: '#262626',
        completionDetail: '#a3a3a3',
        completionMuted: '#737373'
      }
    : {
        text: '#171717',
        caret: '#171717',
        placeholder: '#a3a3a3',
        selection: '#bae6fd',
        matchingBracket: '#e5e5e5',
        completionBackground: '#ffffff',
        completionBorder: '#e5e5e5',
        completionSelected: '#f5f5f5',
        completionDetail: '#737373',
        completionMuted: '#a3a3a3'
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
      },
      '.cm-tooltip.cm-tooltip-autocomplete': {
        overflow: 'hidden',
        border: `1px solid ${palette.completionBorder}`,
        borderRadius: '0.5rem',
        backgroundColor: palette.completionBackground,
        boxShadow:
          '0 12px 32px -12px rgb(0 0 0 / 0.28), 0 4px 12px -6px rgb(0 0 0 / 0.18)'
      },
      '.cm-tooltip.cm-tooltip-autocomplete > ul': {
        maxHeight: '18rem',
        padding: '0.25rem'
      },
      '.cm-tooltip.cm-tooltip-autocomplete > ul > li': {
        minWidth: '18rem',
        padding: '0.375rem 0.5rem',
        borderRadius: '0.375rem',
        lineHeight: '1.25rem'
      },
      '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
        color: palette.text,
        backgroundColor: palette.completionSelected
      },
      '.cm-completionLabel': {
        fontWeight: '500'
      },
      '.cm-completionDetail': {
        color: palette.completionDetail,
        fontStyle: 'normal',
        marginLeft: '1rem'
      },
      '.cm-completionIcon': {
        color: palette.completionMuted,
        opacity: '1'
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

function completionExtension() {
  if (
    props.language !== 'javascript' ||
    !props.completionMetadata ||
    !Array.isArray(props.completionMetadata.models)
  ) {
    return []
  }

  return autocompletion({
    activateOnTyping: true,
    maxRenderedOptions: 80,
    override: [createHelmCompletionSource(props.completionMetadata)]
  })
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

function getExecutionSnapshot(state = view?.state) {
  if (!state) return null

  const selection = state.selection.main
  const hasSelection = !selection.empty
  const from = hasSelection ? selection.from : 0
  const to = hasSelection ? selection.to : state.doc.length
  const source = state.sliceDoc(from, to)
  const startLine = hasSelection ? state.doc.lineAt(from) : state.doc.line(1)

  return {
    source,
    from,
    to,
    hasSelection,
    hasExecutableSource: Boolean(source.trim()),
    startLine: startLine.number,
    startColumn: hasSelection ? from - startLine.from + 1 : 1
  }
}

function emitSelectionChange(state) {
  const snapshot = getExecutionSnapshot(state)
  if (!snapshot) return

  emit('selection-change', {
    hasSelection: snapshot.hasSelection,
    hasExecutableSelection:
      snapshot.hasSelection && snapshot.hasExecutableSource,
    source: snapshot.source
  })
}

function highlightExecution(snapshot = getExecutionSnapshot()) {
  if (!view || !snapshot) return

  window.clearTimeout(executedRangeTimer)
  view.dispatch({
    effects: setExecutedRange.of({
      from: snapshot.from,
      to: snapshot.to
    })
  })
  executedRangeTimer = window.setTimeout(() => {
    if (!view) return
    view.dispatch({ effects: setExecutedRange.of(null) })
  }, 700)
}

function showDiagnostic(diagnostic) {
  if (!view) return

  const range = resolveDiagnosticRange(view.state, diagnostic)
  if (!range) {
    clearDiagnostics()
    return
  }

  const message = String(diagnostic.message || 'Execution failed')
  view.dispatch(
    setDiagnostics(view.state, [
      {
        from: range.from,
        to: range.to,
        severity: 'error',
        source: diagnostic.source || 'Helm',
        message
      }
    ]),
    {
      effects: [
        setInlineDiagnostic.of({
          position: range.lineTo,
          message
        }),
        EditorView.scrollIntoView(range.from, { y: 'center' })
      ]
    }
  )
}

function clearDiagnostics() {
  if (!view) return
  view.dispatch(setDiagnostics(view.state, []), {
    effects: setInlineDiagnostic.of(null)
  })
}

function resolveDiagnosticRange(state, diagnostic) {
  const lineNumber = Number(diagnostic?.line)
  const columnNumber = Number(diagnostic?.column)
  if (
    !Number.isSafeInteger(lineNumber) ||
    !Number.isSafeInteger(columnNumber) ||
    lineNumber < 1 ||
    lineNumber > state.doc.lines ||
    columnNumber < 1
  ) {
    return null
  }

  let line = state.doc.line(lineNumber)
  let from = Math.min(line.to, line.from + columnNumber - 1)

  if (from === line.to) {
    const lastCodeOffset = line.text.search(/\s*$/) - 1
    if (lastCodeOffset >= 0) {
      from = line.from + lastCodeOffset
    } else {
      for (
        let previousLine = lineNumber - 1;
        previousLine >= 1;
        previousLine--
      ) {
        const candidate = state.doc.line(previousLine)
        const candidateOffset = candidate.text.search(/\s*$/) - 1
        if (candidateOffset < 0) continue
        line = candidate
        from = candidate.from + candidateOffset
        break
      }
    }
  }

  let to = Math.min(line.to, from + 1)
  if (/[\w$]/.test(state.sliceDoc(from, to))) {
    while (from > line.from && /[\w$]/.test(state.sliceDoc(from - 1, from))) {
      from--
    }
    while (to < line.to && /[\w$]/.test(state.sliceDoc(to, to + 1))) {
      to++
    }
  }

  return {
    from,
    to,
    lineTo: line.to
  }
}

function focus() {
  view?.focus()
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
        executedRangeField,
        inlineDiagnosticField,
        indentOnInput(),
        bracketMatching(),
        EditorView.lineWrapping,
        keymap.of([
          ...submitKeymap(),
          ...completionKeymap,
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap
        ]),
        props.placeholder ? editorPlaceholder(props.placeholder) : [],
        languageCompartment.of(languageExtension(props.language)),
        appearanceCompartment.of(appearanceExtension()),
        editableCompartment.of(editableExtension()),
        completionCompartment.of(completionExtension()),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !applyingExternalValue) {
            emit('update:modelValue', update.state.doc.toString())
          }
          if (update.docChanged || update.selectionSet) {
            emitSelectionChange(update.state)
          }
        })
      ]
    })
  })
  emitSelectionChange(view.state)
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
        appearanceCompartment.reconfigure(appearanceExtension()),
        completionCompartment.reconfigure(completionExtension())
      ]
    })
  }
)

watch(
  () => props.completionMetadata,
  () => {
    if (!view) return
    view.dispatch({
      effects: completionCompartment.reconfigure(completionExtension())
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
  window.clearTimeout(executedRangeTimer)
  view?.destroy()
})

defineExpose({
  clearDiagnostics,
  focus,
  getExecutionSnapshot,
  highlightExecution,
  showDiagnostic
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

.code-editor :deep(.cm-executed-range) {
  background: color-mix(in srgb, var(--color-brand-500) 14%, transparent);
  box-shadow: inset 0 -1px color-mix(in srgb, var(--color-brand-500) 45%, transparent);
}

.code-editor :deep(.cm-lintRange-error) {
  background-image: none;
  text-decoration: underline wavy var(--color-red-500);
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;
}

.code-editor :deep(.cm-inline-diagnostic) {
  display: inline-block;
  max-width: min(24rem, 45vw);
  margin-left: 0.75rem;
  overflow: hidden;
  color: var(--color-red-600);
  font-family: ui-sans-serif, system-ui, sans-serif, 'Apple Color Emoji',
    'Segoe UI Emoji';
  font-size: 0.75rem;
  font-weight: 500;
  line-height: 1rem;
  text-overflow: ellipsis;
  vertical-align: middle;
  white-space: nowrap;
}

@media (prefers-color-scheme: dark) {
  .code-editor :deep(.cm-editor.cm-focused) {
    outline-color: var(--color-brand-800);
  }

  .code-editor :deep(.cm-inline-diagnostic) {
    color: var(--color-red-400);
  }
}
</style>
