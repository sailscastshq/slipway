<script setup>
import { Link, Head, usePage } from '@inertiajs/vue3'
import {
  inject,
  ref,
  computed,
  watch,
  onMounted,
  onBeforeUnmount,
  nextTick
} from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'
import SlippyLoader from '@/components/SlippyLoader.vue'
import CodeEditor from '@/components/CodeEditor.vue'
import HelmResultViewer from '@/components/HelmResultViewer.vue'
import HelmWorkspaceLibrary from '@/components/HelmWorkspaceLibrary.vue'
import Tooltip from '@/components/Tooltip.vue'
import { helmEditorDiagnostic } from '@/lib/helmResult'
import { cancelHelmExecution, cancelledHelmResult } from '@/lib/helmExecution'

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
const executionResult = ref(null)
const requestError = ref('')
const running = ref(false)
const stopping = ref(false)
const editor = ref(null)
const library = ref(null)
const libraryOpen = ref(false)
const libraryTab = ref('history')
const completionMetadata = ref(null)
const editorSelection = ref({
  hasSelection: false,
  hasExecutableSelection: false,
  source: code.value
})
let executionSequence = 0
let activeExecution = null
let completionRequestSequence = 0

const isRunning = computed(() => props.appStatus === 'running')
const runLabel = computed(() =>
  editorSelection.value.hasSelection ? 'Run selection' : 'Run'
)
const canExecute = computed(() => {
  if (!isRunning.value || running.value) return false
  if (editorSelection.value.hasSelection) {
    return editorSelection.value.hasExecutableSelection
  }
  return Boolean(code.value.trim())
})
const helmLibraryUrl = computed(
  () =>
    `/api/v1/projects/${props.project.slug}/environments/${props.environment.slug}/helm`
)

async function execute(sourceOverride) {
  let execution
  if (typeof sourceOverride === 'string') {
    if (!sourceOverride.trim() || !isRunning.value || running.value) return
    code.value = sourceOverride
    await nextTick()
    execution = {
      source: sourceOverride,
      from: 0,
      to: sourceOverride.length,
      hasExecutableSource: true,
      startLine: 1,
      startColumn: 1
    }
  } else {
    execution = editor.value?.getExecutionSnapshot()
    if (!execution?.hasExecutableSource || !canExecute.value) return
  }

  editor.value.highlightExecution(execution)
  editor.value.clearDiagnostics()
  editor.value.focus()
  const currentExecution = {
    id: crypto.randomUUID(),
    sequence: ++executionSequence,
    startedAt: performance.now(),
    source: execution.source
  }
  activeExecution = currentExecution
  running.value = true
  stopping.value = false
  executionResult.value = null
  requestError.value = ''

  try {
    const response = await fetch(
      `/api/v1/projects/${props.project.slug}/environments/${props.environment.slug}/execute`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': page.props._csrf || ''
        },
        body: JSON.stringify({
          executionId: currentExecution.id,
          code: execution.source,
          sourceStartLine: execution.startLine,
          sourceStartColumn: execution.startColumn
        })
      }
    )

    const responseText = await response.text()
    let result
    try {
      result = JSON.parse(responseText)
    } catch {
      throw new Error(responseText || 'Execution failed')
    }

    if (!response.ok) {
      const diagnostic = helmEditorDiagnostic(result.error)
      if (diagnostic) editor.value.showDiagnostic(diagnostic)
      throw new Error(
        result.message ||
          result.error?.message ||
          result.error ||
          'Execution failed'
      )
    }
    if (activeExecution?.sequence !== currentExecution.sequence) return

    executionResult.value = result
    const diagnostic = helmEditorDiagnostic(result.error)
    if (diagnostic) editor.value.showDiagnostic(diagnostic)

    await revealHistory()
  } catch (err) {
    if (activeExecution?.sequence !== currentExecution.sequence) return
    requestError.value = err.message || 'Network error'
  } finally {
    if (activeExecution?.sequence === currentExecution.sequence) {
      running.value = false
      stopping.value = false
    }
  }
}

async function stopExecution() {
  const currentExecution = activeExecution
  if (!currentExecution || !running.value || stopping.value) return

  stopping.value = true
  requestError.value = ''

  try {
    const cancelled = await cancelHelmExecution(
      currentExecution.id,
      page.props._csrf || ''
    )
    if (!cancelled) {
      throw new Error('This Helm execution has already finished.')
    }
    if (activeExecution?.sequence !== currentExecution.sequence) return
    if (!running.value && executionResult.value?.status === 'cancelled') return

    const result = cancelledHelmResult(
      Math.round(performance.now() - currentExecution.startedAt)
    )
    executionResult.value = result
    running.value = false
  } catch (error) {
    if (activeExecution?.sequence !== currentExecution.sequence) return
    requestError.value = error.message || 'Could not stop Helm execution.'
  } finally {
    if (activeExecution?.sequence === currentExecution.sequence) {
      stopping.value = false
    }
  }
}

function runOrStop() {
  if (running.value) stopExecution()
  else execute()
}

async function revealHistory() {
  libraryTab.value = 'history'
  libraryOpen.value = true
  await nextTick()
  await library.value?.refreshHistory()
}

function toggleLibrary(tab) {
  if (libraryOpen.value && libraryTab.value === tab) {
    libraryOpen.value = false
    return
  }
  libraryTab.value = tab
  libraryOpen.value = true
}

async function loadSource(source) {
  code.value = source
  await nextTick()
  editor.value?.focus()
}

function clearExecutionOutput() {
  executionResult.value = null
  requestError.value = ''
  editor.value?.clearDiagnostics()
}

async function loadCompletionMetadata() {
  const sequence = ++completionRequestSequence

  try {
    const response = await fetch(
      `/api/v1/projects/${props.project.slug}/environments/${props.environment.slug}/helm/completions`,
      {
        headers: {
          Accept: 'application/json'
        },
        cache: 'no-store'
      }
    )
    if (!response.ok) throw new Error('Completion metadata is unavailable.')

    const metadata = await response.json()
    if (sequence !== completionRequestSequence) return
    completionMetadata.value = metadata.available ? metadata : null
  } catch {
    if (sequence === completionRequestSequence) {
      completionMetadata.value = null
    }
  }
}

onMounted(() => {
  loadCompletionMetadata()
  window.addEventListener('focus', loadCompletionMetadata)
})

onBeforeUnmount(() => {
  completionRequestSequence++
  window.removeEventListener('focus', loadCompletionMetadata)
})

watch(code, () => editor.value?.clearDiagnostics())
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

        <div class="flex items-center">
          <Tooltip text="History" position="bottom">
            <button
              type="button"
              data-test="helm-history-toggle"
              :aria-pressed="libraryOpen && libraryTab === 'history'"
              :class="[
                'rounded-md p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 dark:focus-visible:ring-gray-700',
                libraryOpen && libraryTab === 'history'
                  ? 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-white'
                  : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-200'
              ]"
              @click="toggleLibrary('history')"
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
                  stroke-width="1.75"
                  d="M12 8v4l2.5 1.5M3.5 12a8.5 8.5 0 1 0 2.1-5.6M3.5 4.5v4h4"
                />
              </svg>
              <span class="sr-only">History</span>
            </button>
          </Tooltip>
          <Tooltip text="Snippets" position="bottom">
            <button
              type="button"
              data-test="helm-snippets-toggle"
              :aria-pressed="libraryOpen && libraryTab === 'snippets'"
              :class="[
                'rounded-md p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 dark:focus-visible:ring-gray-700',
                libraryOpen && libraryTab === 'snippets'
                  ? 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-white'
                  : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-200'
              ]"
              @click="toggleLibrary('snippets')"
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
                  stroke-width="1.75"
                  d="M6.5 4.5h11v15L12 16l-5.5 3.5v-15Z"
                />
              </svg>
              <span class="sr-only">Snippets</span>
            </button>
          </Tooltip>
        </div>

        <!-- Run button -->
        <button
          data-test="helm-run"
          @click="runOrStop"
          :disabled="running ? stopping : !canExecute"
          :class="[
            'flex items-center space-x-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-50 sm:px-3',
            running
              ? 'bg-red-600 hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-500'
              : 'bg-gray-900 hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100'
          ]"
          :title="
            running
              ? 'Stop execution'
              : `${runLabel} · ${
                  navigator?.platform?.includes('Mac') ? '⌘' : 'Ctrl'
                }+Enter`
          "
        >
          <SlippyLoader v-if="stopping" size="h-3 w-3" />
          <svg
            v-else-if="running"
            class="h-3 w-3"
            fill="currentColor"
            viewBox="0 0 20 20"
            aria-hidden="true"
          >
            <rect x="5" y="5" width="10" height="10" rx="1" />
          </svg>
          <svg v-else class="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
            <path
              d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z"
            />
          </svg>
          <span class="hidden sm:inline">{{
            stopping ? 'Stopping' : running ? 'Stop' : runLabel
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
          <CodeEditor
            ref="editor"
            v-model="code"
            language="javascript"
            aria-label="Helm JavaScript"
            test-id="helm-editor"
            height="fill"
            :disabled="!isRunning"
            :completion-metadata="completionMetadata"
            submit-on-mod-enter
            placeholder="// Enter JavaScript code..."
            @selection-change="editorSelection = $event"
            @submit="execute"
          />
        </div>
      </div>

      <!-- Output panel -->
      <div
        data-test="helm-output-panel"
        class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white dark:bg-gray-950"
      >
        <HelmResultViewer
          :result="executionResult"
          :error="requestError"
          :loading="running"
          clearable
          test-id="helm"
          @clear="clearExecutionOutput"
        />

        <HelmWorkspaceLibrary
          v-if="libraryOpen"
          ref="library"
          v-model:tab="libraryTab"
          :base-url="helmLibraryUrl"
          :csrf="page.props._csrf || ''"
          :current-source="editorSelection.source || code"
          @close="libraryOpen = false"
          @load="loadSource"
          @insert="loadSource"
          @rerun="execute"
        />
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
