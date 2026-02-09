<script setup>
import { Link, Head, usePage } from '@inertiajs/vue3'
import { inject, ref, computed, onMounted } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  project: Object,
  environment: Object,
  appStatus: String
})

const page = usePage()
const toggleMobileMenu = inject('toggleMobileMenu')

const code = ref('// Access your Sails models, helpers, and config\n')
const output = ref('')
const error = ref('')
const running = ref(false)
const history = ref([])

const isRunning = computed(() => props.appStatus === 'running')

async function execute() {
  if (!code.value.trim() || running.value) return

  running.value = true
  output.value = ''
  error.value = ''

  try {
    const response = await fetch(
      `/api/v1/projects/${props.project.slug}/environments/${props.environment.slug}/execute`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': page.props._csrf || ''
        },
        body: JSON.stringify({ code: code.value })
      }
    )

    const result = await response.json()

    if (result.success) {
      output.value = result.output || '(no output)'
      error.value = ''
    } else {
      output.value = result.output || ''
      error.value = result.error || 'Execution failed'
    }

    // Add to history
    history.value.unshift({
      code: code.value,
      output: output.value,
      error: error.value,
      success: result.success,
      time: new Date()
    })

    // Keep only last 20 entries
    if (history.value.length > 20) {
      history.value = history.value.slice(0, 20)
    }
  } catch (err) {
    error.value = err.message
  } finally {
    running.value = false
  }
}

function loadFromHistory(entry) {
  code.value = entry.code
}

function handleKeydown(e) {
  // Cmd/Ctrl + Enter to run
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault()
    execute()
  }
  // Tab to insert spaces
  if (e.key === 'Tab') {
    e.preventDefault()
    const target = e.target
    const start = target.selectionStart
    const end = target.selectionEnd
    code.value = code.value.substring(0, start) + '  ' + code.value.substring(end)
    // Restore cursor position after Vue updates
    requestAnimationFrame(() => {
      target.selectionStart = target.selectionEnd = start + 2
    })
  }
}

// JavaScript syntax highlighting
const highlightedCode = computed(() => {
  return highlightJS(code.value)
})

function highlightJS(code) {
  if (!code) return ''

  const keywords = new Set([
    'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
    'debugger', 'default', 'delete', 'do', 'else', 'export', 'extends', 'finally',
    'for', 'function', 'if', 'import', 'in', 'instanceof', 'let', 'new', 'of',
    'return', 'static', 'super', 'switch', 'this', 'throw', 'try', 'typeof',
    'var', 'void', 'while', 'with', 'yield'
  ])

  const builtins = new Set([
    'true', 'false', 'null', 'undefined', 'NaN', 'Infinity',
    'console', 'process', 'require', 'module', 'exports',
    'Array', 'Object', 'String', 'Number', 'Boolean', 'Date', 'Math', 'JSON',
    'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Symbol', 'Error',
    'sails', 'User', 'Project', 'Environment', 'App', 'Deployment', 'Team', 'Setting'
  ])

  // Tokenize
  const tokens = []
  let i = 0

  while (i < code.length) {
    // Single-line comment
    if (code.slice(i, i + 2) === '//') {
      let end = code.indexOf('\n', i)
      if (end === -1) end = code.length
      tokens.push({ type: 'comment', value: code.slice(i, end) })
      i = end
      continue
    }

    // Multi-line comment
    if (code.slice(i, i + 2) === '/*') {
      let end = code.indexOf('*/', i + 2)
      if (end === -1) end = code.length
      else end += 2
      tokens.push({ type: 'comment', value: code.slice(i, end) })
      i = end
      continue
    }

    // String (single, double, template)
    if (code[i] === '"' || code[i] === "'" || code[i] === '`') {
      const quote = code[i]
      let end = i + 1
      while (end < code.length && code[end] !== quote) {
        if (code[end] === '\\') end++
        end++
      }
      if (end < code.length) end++
      tokens.push({ type: 'string', value: code.slice(i, end) })
      i = end
      continue
    }

    // Number
    if (/\d/.test(code[i]) || (code[i] === '.' && /\d/.test(code[i + 1]))) {
      let end = i
      while (end < code.length && /[\d.eExXa-fA-F_]/.test(code[end])) end++
      tokens.push({ type: 'number', value: code.slice(i, end) })
      i = end
      continue
    }

    // Word (keyword, builtin, or identifier)
    if (/[a-zA-Z_$]/.test(code[i])) {
      let end = i
      while (end < code.length && /[a-zA-Z0-9_$]/.test(code[end])) end++
      const word = code.slice(i, end)
      if (keywords.has(word)) {
        tokens.push({ type: 'keyword', value: word })
      } else if (builtins.has(word)) {
        tokens.push({ type: 'builtin', value: word })
      } else {
        tokens.push({ type: 'identifier', value: word })
      }
      i = end
      continue
    }

    // Operator/punctuation
    if (/[+\-*/%=<>!&|^~?:;,.()[\]{}]/.test(code[i])) {
      tokens.push({ type: 'punctuation', value: code[i] })
      i++
      continue
    }

    // Whitespace and newlines
    if (/\s/.test(code[i])) {
      let end = i
      while (end < code.length && /\s/.test(code[end])) end++
      tokens.push({ type: 'whitespace', value: code.slice(i, end) })
      i = end
      continue
    }

    // Fallback
    tokens.push({ type: 'other', value: code[i] })
    i++
  }

  // Render tokens with light/dark mode support
  const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  return tokens.map(t => {
    const escaped = escapeHtml(t.value)
    switch (t.type) {
      case 'keyword':
        return `<span class="text-purple-600 dark:text-purple-400">${escaped}</span>`
      case 'builtin':
        return `<span class="text-cyan-600 dark:text-cyan-400">${escaped}</span>`
      case 'string':
        return `<span class="text-green-600 dark:text-green-400">${escaped}</span>`
      case 'number':
        return `<span class="text-orange-600 dark:text-orange-400">${escaped}</span>`
      case 'comment':
        return `<span class="text-gray-400 dark:text-gray-500">${escaped}</span>`
      case 'punctuation':
        return `<span class="text-gray-500 dark:text-gray-400">${escaped}</span>`
      default:
        return `<span class="text-gray-900 dark:text-gray-100">${escaped}</span>`
    }
  }).join('')
}

// JSON/output syntax highlighting
const highlightedOutput = computed(() => {
  if (!output.value) return ''
  return highlightJSON(output.value)
})

function highlightJSON(str) {
  const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  // Simple JSON tokenizer
  const tokens = []
  let i = 0

  while (i < str.length) {
    // String
    if (str[i] === '"') {
      let end = i + 1
      while (end < str.length && str[end] !== '"') {
        if (str[end] === '\\') end++
        end++
      }
      if (end < str.length) end++
      tokens.push({ type: 'string', value: str.slice(i, end) })
      i = end
      continue
    }

    // Number
    if (/[-\d]/.test(str[i])) {
      let end = i
      if (str[end] === '-') end++
      while (end < str.length && /[\d.eE+-]/.test(str[end])) end++
      if (end > i) {
        tokens.push({ type: 'number', value: str.slice(i, end) })
        i = end
        continue
      }
    }

    // Boolean/null
    if (str.slice(i, i + 4) === 'true') {
      tokens.push({ type: 'boolean', value: 'true' })
      i += 4
      continue
    }
    if (str.slice(i, i + 5) === 'false') {
      tokens.push({ type: 'boolean', value: 'false' })
      i += 5
      continue
    }
    if (str.slice(i, i + 4) === 'null') {
      tokens.push({ type: 'null', value: 'null' })
      i += 4
      continue
    }

    // Punctuation
    if (/[{}\[\]:,]/.test(str[i])) {
      tokens.push({ type: 'punctuation', value: str[i] })
      i++
      continue
    }

    // Whitespace
    if (/\s/.test(str[i])) {
      let end = i
      while (end < str.length && /\s/.test(str[end])) end++
      tokens.push({ type: 'whitespace', value: str.slice(i, end) })
      i = end
      continue
    }

    // Other
    tokens.push({ type: 'other', value: str[i] })
    i++
  }

  return tokens.map(t => {
    const escaped = escapeHtml(t.value)
    switch (t.type) {
      case 'string':
        // Check if it's a key (followed by colon after whitespace)
        return `<span class="text-cyan-600 dark:text-cyan-400">${escaped}</span>`
      case 'number':
        return `<span class="text-orange-600 dark:text-orange-400">${escaped}</span>`
      case 'boolean':
        return `<span class="text-purple-600 dark:text-purple-400">${escaped}</span>`
      case 'null':
        return `<span class="text-gray-400 dark:text-gray-500">${escaped}</span>`
      case 'punctuation':
        return `<span class="text-gray-500 dark:text-gray-400">${escaped}</span>`
      default:
        return escaped
    }
  }).join('')
}
</script>
<template>
  <Head :title="`Helm - ${project.name} / ${environment.name} | Slipway`"></Head>
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
          <span class="font-medium text-gray-900 dark:text-white">helm</span>
        </nav>
      </div>
      <div class="flex items-center space-x-3">
        <span v-if="isRunning" class="flex items-center space-x-1.5 text-xs text-green-600 dark:text-green-400">
          <span class="h-1.5 w-1.5 rounded-full bg-green-500"></span>
          <span>connected</span>
        </span>
        <span v-else class="flex items-center space-x-1.5 text-xs text-gray-400">
          <span class="h-1.5 w-1.5 rounded-full bg-gray-400"></span>
          <span>app not running</span>
        </span>

        <!-- Run button -->
        <button
          @click="execute"
          :disabled="running || !isRunning"
          class="flex items-center space-x-1.5 rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
          :title="(navigator?.platform?.includes('Mac') ? '⌘' : 'Ctrl') + '+Enter'"
        >
          <svg v-if="running" class="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <svg v-else class="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
            <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
          </svg>
          <span>{{ running ? 'Running' : 'Run' }}</span>
        </button>

        <!-- Docs link -->
        <a
          href="https://docs.sailscasts.com/slipway/helm"
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

    <!-- Main content - Tinkerwell style -->
    <div class="flex flex-1 flex-col overflow-hidden lg:flex-row">
      <!-- Editor panel -->
      <div class="flex flex-1 flex-col border-b border-gray-100 dark:border-gray-800 lg:border-b-0 lg:border-r">
        <!-- Code editor with syntax highlighting -->
        <div class="relative flex-1 overflow-hidden bg-white dark:bg-gray-950">
          <!-- Editor area -->
          <div class="relative h-full overflow-auto">
            <!-- Highlighted layer -->
            <pre
              class="pointer-events-none absolute inset-0 whitespace-pre-wrap break-words py-4 pl-4 pr-4 font-mono text-sm leading-6"
              aria-hidden="true"
              v-html="highlightedCode"
            ></pre>
            <!-- Textarea -->
            <textarea
              v-model="code"
              @keydown="handleKeydown"
              :disabled="!isRunning"
              spellcheck="false"
              class="absolute inset-0 h-full w-full resize-none border-0 bg-transparent py-4 pl-4 pr-4 font-mono text-sm leading-6 text-transparent caret-gray-900 placeholder-gray-400 focus:outline-none focus:ring-0 dark:caret-gray-100 dark:placeholder-gray-600"
              placeholder="// Enter JavaScript code..."
            ></textarea>
          </div>
        </div>
      </div>

      <!-- Output panel -->
      <div class="flex flex-1 flex-col bg-white dark:bg-gray-950">
        <div class="relative flex-1 overflow-y-auto p-4 font-mono text-sm leading-6">
          <!-- Output -->
          <pre v-if="output" class="whitespace-pre-wrap" v-html="highlightedOutput"></pre>
          <!-- Error -->
          <pre v-else-if="error" class="whitespace-pre-wrap text-red-600 dark:text-red-400">{{ error }}</pre>
          <!-- Running indicator -->
          <div v-else-if="running" class="flex items-center space-x-2 text-gray-400 dark:text-gray-500">
            <svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>

          <!-- Clear button (floating) -->
          <button
            v-if="output || error"
            @click="output = ''; error = ''"
            class="absolute right-3 top-3 text-xs text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
          >
            clear
          </button>
        </div>

        <!-- History (collapsible at bottom) -->
        <div v-if="history.length > 0" class="border-t border-gray-100 dark:border-gray-800">
          <div class="max-h-32 overflow-y-auto">
            <button
              v-for="(entry, i) in history"
              :key="i"
              @click="loadFromHistory(entry)"
              class="flex w-full items-center justify-between border-b border-gray-100 px-4 py-2 text-left hover:bg-gray-50 dark:border-gray-800/50 dark:hover:bg-gray-800/50"
            >
              <code class="truncate font-mono text-xs text-gray-500 dark:text-gray-400">{{ entry.code.split('\n').filter(l => !l.trim().startsWith('//')).join(' ').slice(0, 50) }}</code>
              <span :class="['shrink-0 ml-2 h-1.5 w-1.5 rounded-full', entry.success ? 'bg-green-500' : 'bg-red-500']"></span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Not running warning -->
    <div v-if="!isRunning" class="border-t border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/50 dark:bg-amber-900/10">
      <p class="text-center text-sm text-amber-700 dark:text-amber-400">
        App not running. Deploy first to use Helm.
      </p>
    </div>
  </div>
</template>
