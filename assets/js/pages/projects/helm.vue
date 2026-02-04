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

const code = ref('// Access your Sails models, helpers, and config\n// Examples:\n//   return await User.find()\n//   return sails.config.custom\n//   return await sails.helpers.docker.getContainerStatus(containerName)\n\nreturn await User.count()')
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
      </div>
    </div>

    <!-- Main content -->
    <div class="flex flex-1 flex-col overflow-hidden lg:flex-row">
      <!-- Editor panel -->
      <div class="flex flex-1 flex-col border-b border-gray-200 dark:border-gray-800 lg:border-b-0 lg:border-r">
        <!-- Editor toolbar -->
        <div class="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-2 dark:border-gray-800 dark:bg-gray-900">
          <span class="text-xs font-medium text-gray-500 dark:text-gray-400">Code</span>
          <div class="flex items-center space-x-2">
            <span class="text-xs text-gray-400 dark:text-gray-500">
              {{ navigator?.platform?.includes('Mac') ? '⌘' : 'Ctrl' }}+Enter to run
            </span>
            <button
              @click="execute"
              :disabled="running || !isRunning"
              class="flex items-center space-x-1.5 rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
            >
              <svg v-if="running" class="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <svg v-else class="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
              </svg>
              <span>{{ running ? 'Running...' : 'Run' }}</span>
            </button>
          </div>
        </div>

        <!-- Code editor -->
        <div class="flex-1 overflow-hidden">
          <textarea
            v-model="code"
            @keydown="handleKeydown"
            :disabled="!isRunning"
            spellcheck="false"
            class="h-full w-full resize-none border-0 bg-gray-950 p-4 font-mono text-sm leading-6 text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-0"
            placeholder="Enter JavaScript code to execute..."
          ></textarea>
        </div>
      </div>

      <!-- Output panel -->
      <div class="flex flex-1 flex-col">
        <!-- Output toolbar -->
        <div class="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-2 dark:border-gray-800 dark:bg-gray-900">
          <span class="text-xs font-medium text-gray-500 dark:text-gray-400">Output</span>
          <button
            v-if="output || error"
            @click="output = ''; error = ''"
            class="text-xs text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
          >
            Clear
          </button>
        </div>

        <!-- Output content -->
        <div class="flex-1 overflow-y-auto bg-gray-950 p-4 font-mono text-sm leading-6">
          <!-- Error -->
          <pre v-if="error" class="whitespace-pre-wrap text-red-400">{{ error }}</pre>
          <!-- Success output -->
          <pre v-if="output" class="whitespace-pre-wrap text-green-400">{{ output }}</pre>
          <!-- Empty state -->
          <div v-if="!output && !error && !running" class="text-gray-600">
            <p>Output will appear here.</p>
            <p class="mt-2">Tip: Use <code class="rounded bg-gray-800 px-1">return</code> to see the result of an expression.</p>
          </div>
          <!-- Running indicator -->
          <div v-if="running" class="flex items-center space-x-2 text-gray-500">
            <svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span>Executing...</span>
          </div>
        </div>

        <!-- History -->
        <div v-if="history.length > 0" class="border-t border-gray-800">
          <div class="border-b border-gray-800 bg-gray-900 px-4 py-2">
            <span class="text-xs font-medium text-gray-500">History</span>
          </div>
          <div class="max-h-48 overflow-y-auto bg-gray-950">
            <button
              v-for="(entry, i) in history"
              :key="i"
              @click="loadFromHistory(entry)"
              class="flex w-full items-center justify-between border-b border-gray-800/50 px-4 py-2 text-left hover:bg-gray-900/50"
            >
              <code class="truncate text-xs text-gray-400">{{ entry.code.split('\n').filter(l => !l.trim().startsWith('//')).join(' ').slice(0, 60) }}</code>
              <span :class="['shrink-0 ml-2 h-1.5 w-1.5 rounded-full', entry.success ? 'bg-green-500' : 'bg-red-500']"></span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Not running warning -->
    <div v-if="!isRunning" class="border-t border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/50 dark:bg-amber-900/10">
      <p class="text-center text-sm text-amber-700 dark:text-amber-400">
        The app is not running. Deploy your app first to use Helm.
      </p>
    </div>
  </div>
</template>
