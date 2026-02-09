<script setup>
import { Link, Head, usePage } from '@inertiajs/vue3'
import { inject, ref, computed, nextTick } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  project: Object,
  environment: Object,
  service: Object
})

const page = usePage()
const toggleMobileMenu = inject('toggleMobileMenu')

const isRunning = computed(() => props.service.status === 'running')

const command = ref('')
const running = ref(false)
const history = ref([])
const outputContainer = ref(null)
const commandInput = ref(null)
const historyIndex = ref(-1)

async function execute() {
  if (!command.value.trim() || running.value) return

  const cmd = command.value
  running.value = true
  historyIndex.value = -1

  try {
    const response = await fetch(`/api/v1/services/${props.service.id}/redis`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': page.props._csrf || ''
      },
      body: JSON.stringify({ command: cmd })
    })

    const result = await response.json()

    history.value.push({
      command: cmd,
      output: result.output || '',
      error: result.error || null,
      success: result.success,
      duration: result.duration,
      time: new Date()
    })

    // Cap at 200 entries
    if (history.value.length > 200) {
      history.value = history.value.slice(-150)
    }

    command.value = ''
  } catch (err) {
    history.value.push({
      command: cmd,
      output: '',
      error: err.message,
      success: false,
      duration: 0,
      time: new Date()
    })
  } finally {
    running.value = false
    nextTick(() => {
      commandInput.value?.focus()
      if (outputContainer.value) {
        outputContainer.value.scrollTop = outputContainer.value.scrollHeight
      }
    })
  }
}

function handleKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    execute()
  }
  // Up arrow to navigate history
  if (e.key === 'ArrowUp' && history.value.length > 0) {
    e.preventDefault()
    if (historyIndex.value < history.value.length - 1) {
      historyIndex.value++
    }
    const entry = history.value[history.value.length - 1 - historyIndex.value]
    if (entry) command.value = entry.command
  }
  // Down arrow to navigate history
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (historyIndex.value > 0) {
      historyIndex.value--
      const entry = history.value[history.value.length - 1 - historyIndex.value]
      if (entry) command.value = entry.command
    } else {
      historyIndex.value = -1
      command.value = ''
    }
  }
}

function runQuickCommand(cmd) {
  command.value = cmd
  nextTick(() => execute())
}

function clearHistory() {
  history.value = []
}

const quickCommands = [
  { label: 'PING', cmd: 'PING' },
  { label: 'INFO', cmd: 'INFO server' },
  { label: 'DBSIZE', cmd: 'DBSIZE' },
  { label: 'KEYS *', cmd: 'KEYS *' },
  { label: 'CONFIG GET maxmemory', cmd: 'CONFIG GET maxmemory' }
]
</script>
<template>
  <Head :title="`Redis - ${service.name} - ${project.name} | Slipway`"></Head>
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
            :href="`/projects/${project.slug}/environments/${environment.slug}?services=1`"
            class="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >
            {{ environment.name.toLowerCase() }}
          </Link>
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <span class="font-medium text-gray-900 dark:text-white">{{ service.name }}</span>
        </nav>
      </div>
      <div class="flex items-center space-x-3">
        <span
          class="inline-flex h-6 w-6 items-center justify-center rounded bg-red-100 text-[9px] font-bold text-red-600 dark:bg-red-900/30 dark:text-red-400"
        >
          Rd
        </span>
        <span v-if="isRunning" class="flex items-center space-x-1.5 text-xs text-green-600 dark:text-green-400">
          <span class="h-1.5 w-1.5 rounded-full bg-green-500"></span>
          <span>connected</span>
        </span>
        <span v-else class="flex items-center space-x-1.5 text-xs text-gray-400">
          <span class="h-1.5 w-1.5 rounded-full bg-gray-400"></span>
          <span>not running</span>
        </span>
      </div>
    </div>

    <!-- Main content -->
    <div class="flex flex-1 flex-col overflow-hidden">
      <!-- Quick actions bar -->
      <div class="flex items-center gap-2 border-b border-gray-200 bg-gray-50 px-4 py-2 dark:border-gray-800 dark:bg-gray-900">
        <span class="text-xs font-medium text-gray-500 dark:text-gray-400">Quick:</span>
        <button
          v-for="qc in quickCommands"
          :key="qc.cmd"
          @click="runQuickCommand(qc.cmd)"
          :disabled="!isRunning || running"
          class="rounded-md border border-gray-200 bg-white px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
        >
          {{ qc.label }}
        </button>
        <div class="flex-1"></div>
        <button
          v-if="history.length > 0"
          @click="clearHistory"
          class="text-xs text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
        >
          Clear
        </button>
      </div>

      <!-- Output area -->
      <div
        ref="outputContainer"
        class="flex-1 overflow-y-auto bg-gray-950 p-4 font-mono text-sm leading-6"
      >
        <!-- Empty state -->
        <div v-if="history.length === 0 && !running" class="text-gray-600">
          <p>Redis CLI console for <span class="text-gray-400">{{ service.name }}</span></p>
          <p class="mt-2">Type a command below or use the quick actions above.</p>
          <p class="mt-1 text-gray-700">Use <kbd class="rounded bg-gray-800 px-1.5 py-0.5 text-xs text-gray-400">Up</kbd>/<kbd class="rounded bg-gray-800 px-1.5 py-0.5 text-xs text-gray-400">Down</kbd> arrows to navigate history.</p>
        </div>

        <!-- Command history output -->
        <div v-for="(entry, i) in history" :key="i" class="mb-3">
          <div class="flex items-center gap-2">
            <span class="text-red-400">redis&gt;</span>
            <span class="text-gray-200">{{ entry.command }}</span>
            <span class="text-gray-700 text-xs">{{ entry.duration }}ms</span>
          </div>
          <pre v-if="entry.success && entry.output" class="mt-0.5 whitespace-pre-wrap text-green-400">{{ entry.output }}</pre>
          <pre v-if="entry.error" class="mt-0.5 whitespace-pre-wrap text-red-400">{{ entry.error }}</pre>
          <div v-if="entry.success && !entry.output && !entry.error" class="mt-0.5 text-gray-600">(empty)</div>
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

      <!-- Command input -->
      <div class="border-t border-gray-800 bg-gray-950">
        <div class="flex items-center px-4 py-3">
          <span class="mr-2 font-mono text-sm text-red-400">redis&gt;</span>
          <input
            ref="commandInput"
            v-model="command"
            @keydown="handleKeydown"
            :disabled="!isRunning || running"
            type="text"
            placeholder="Enter Redis command..."
            spellcheck="false"
            autocomplete="off"
            class="flex-1 border-0 bg-transparent font-mono text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-0"
          />
          <button
            @click="execute"
            :disabled="!command.trim() || !isRunning || running"
            class="ml-2 flex items-center space-x-1.5 rounded-md bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-700 disabled:opacity-50"
          >
            <svg v-if="running" class="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span>{{ running ? 'Running...' : 'Run' }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Not running warning -->
    <div v-if="!isRunning" class="border-t border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/50 dark:bg-amber-900/10">
      <p class="text-center text-sm text-amber-700 dark:text-amber-400">
        The Redis service is not running. Start the service first to use the console.
      </p>
    </div>
  </div>
</template>
