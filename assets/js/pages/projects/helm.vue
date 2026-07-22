<script setup>
import { Link, Head, usePage } from '@inertiajs/vue3'
import { inject, ref, computed, onMounted } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'
import SlippyLoader from '@/components/SlippyLoader.vue'
import { highlightJS } from '@/lib/highlightJS'

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
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')

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

function clearExecutionOutput() {
  output.value = ''
  error.value = ''
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
    code.value =
      code.value.substring(0, start) + '  ' + code.value.substring(end)
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

// JSON/output syntax highlighting
const highlightedOutput = computed(() => {
  if (!output.value) return ''
  return highlightJSON(output.value)
})

function highlightJSON(str) {
  const escapeHtml = (s) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

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

  return tokens
    .map((t) => {
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
    })
    .join('')
}
</script>
<template>
  <Head
    :title="`Helm - ${project.name} / ${environment.name} | Slipway`"
  ></Head>
  <div
    data-test="helm-page"
    class="flex h-full min-h-0 flex-col overflow-hidden"
  >
    <!-- Header -->
    <div
      class="flex shrink-0 items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800 sm:px-8 sm:py-4"
    >
      <div class="flex items-center space-x-3">
        <!-- Mobile menu toggle -->
        <button
          data-test="helm-mobile-menu"
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
        <!-- Mobile: simplified breadcrumb -->
        <nav class="flex items-center space-x-2 text-sm sm:hidden">
          <Link
            :href="`/projects/${project.slug}/environments/${environment.slug}`"
            class="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >
            {{ project.name.toLowerCase() }}
          </Link>
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <span class="font-medium text-gray-900 dark:text-white">helm</span>
        </nav>
        <!-- Desktop: full breadcrumb -->
        <nav class="hidden items-center space-x-2 text-sm sm:flex">
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
          <span class="font-medium text-gray-900 dark:text-white">helm</span>
        </nav>
      </div>
      <div class="flex items-center space-x-2 sm:space-x-3">
        <!-- Status indicator -->
        <span
          v-if="isRunning"
          class="flex items-center space-x-1.5 text-xs text-green-600 dark:text-green-400"
        >
          <span class="h-1.5 w-1.5 rounded-full bg-green-500"></span>
          <span class="hidden sm:inline">connected</span>
        </span>
        <span
          v-else
          class="flex items-center space-x-1.5 text-xs text-gray-400"
        >
          <span class="h-1.5 w-1.5 rounded-full bg-gray-400"></span>
          <span class="hidden sm:inline">not running</span>
        </span>

        <!-- Run button -->
        <button
          data-test="helm-run"
          @click="execute"
          :disabled="running || !isRunning"
          class="flex items-center space-x-1.5 rounded-md bg-gray-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100 sm:px-3"
          :title="
            (navigator?.platform?.includes('Mac') ? '⌘' : 'Ctrl') + '+Enter'
          "
        >
          <SlippyLoader v-if="running" size="h-3 w-3" />
          <svg v-else class="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
            <path
              d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z"
            />
          </svg>
          <span class="hidden sm:inline">{{
            running ? 'Running' : 'Run'
          }}</span>
        </button>

        <!-- Docs link -->
        <a
          href="https://docs.sailscasts.com/slipway/helm"
          target="_blank"
          class="hidden items-center space-x-1 text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white sm:flex"
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

    <!-- Main content - Tinkerwell style -->
    <div
      data-test="helm-workspace"
      class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:flex-row"
    >
      <!-- Editor panel -->
      <div
        data-test="helm-editor-panel"
        class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-b border-gray-100 dark:border-gray-800 lg:border-b-0 lg:border-r"
      >
        <!-- Code editor with syntax highlighting -->
        <div
          class="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-white dark:bg-gray-950"
        >
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
              data-test="helm-editor"
              v-model="code"
              @keydown="handleKeydown"
              :disabled="!isRunning"
              spellcheck="false"
              class="absolute inset-0 h-full w-full resize-none border-0 bg-transparent py-4 pl-4 pr-4 font-mono text-sm leading-6 text-transparent placeholder-gray-400 caret-gray-900 focus:outline-none focus:ring-0 dark:placeholder-gray-600 dark:caret-gray-100"
              placeholder="// Enter JavaScript code..."
            ></textarea>
          </div>
        </div>
      </div>

      <!-- Output panel -->
      <div
        data-test="helm-output-panel"
        class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white dark:bg-gray-950"
      >
        <div
          data-test="helm-output-scroll"
          class="relative min-h-0 min-w-0 flex-1 overflow-auto p-4 font-mono text-sm leading-6"
        >
          <!-- Output -->
          <pre
            v-if="output"
            data-test="helm-output"
            class="whitespace-pre-wrap"
            v-html="highlightedOutput"
          ></pre>
          <!-- Error -->
          <pre
            v-else-if="error"
            class="whitespace-pre-wrap text-red-600 dark:text-red-400"
            >{{ error }}</pre
          >
          <!-- Running indicator -->
          <div
            v-else-if="running"
            class="flex items-center space-x-2 text-gray-400 dark:text-gray-500"
          >
            <SlippyLoader size="h-4 w-4" />
          </div>

          <!-- Clear button (floating) -->
          <button
            v-if="output || error"
            @click="clearExecutionOutput"
            class="absolute right-3 top-3 text-xs text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
          >
            clear
          </button>
        </div>

        <!-- History (collapsible at bottom) -->
        <div
          v-if="history.length > 0"
          class="shrink-0 border-t border-gray-100 dark:border-gray-800"
        >
          <div class="max-h-32 overflow-y-auto">
            <button
              v-for="(entry, i) in history"
              :key="i"
              @click="loadFromHistory(entry)"
              class="flex w-full items-center justify-between border-b border-gray-100 px-4 py-2 text-left hover:bg-gray-50 dark:border-gray-800/50 dark:hover:bg-gray-800/50"
            >
              <code
                class="truncate font-mono text-xs text-gray-500 dark:text-gray-400"
                >{{
                  entry.code
                    .split('\n')
                    .filter((l) => !l.trim().startsWith('//'))
                    .join(' ')
                    .slice(0, 50)
                }}</code
              >
              <span
                :class="[
                  'ml-2 h-1.5 w-1.5 shrink-0 rounded-full',
                  entry.success ? 'bg-green-500' : 'bg-red-500'
                ]"
              ></span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Not running warning -->
    <div
      v-if="!isRunning"
      class="border-t border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/50 dark:bg-amber-900/10"
    >
      <p class="text-center text-sm text-amber-700 dark:text-amber-400">
        App not running. Deploy first to use Helm.
      </p>
    </div>
  </div>
</template>
