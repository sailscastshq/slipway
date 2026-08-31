<script setup>
import Stop from '@/components/ui/icons/Stop.vue'
import SidebarOpen from '@/components/ui/icons/SidebarOpen.vue'
import SidebarClose from '@/components/ui/icons/SidebarClose.vue'
import Play from '@/components/ui/icons/Play.vue'
import History from '@/components/ui/icons/History.vue'
import ExternalLink from '@/components/ui/icons/ExternalLink.vue'
import Bookmark from '@/components/ui/icons/Bookmark.vue'
import { Head, router, usePage } from '@inertiajs/vue3'
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
import Spinner from '@/components/SlipwaySpinner.vue'
import CodeEditor from '@/components/CodeEditor.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import HelmResultViewer from '@/components/HelmResultViewer.vue'
import HelmScratchpadTabs from '@/components/HelmScratchpadTabs.vue'
import HelmWorkspaceLibrary from '@/components/HelmWorkspaceLibrary.vue'
import HelmWriteGuardDialog from '@/components/HelmWriteGuardDialog.vue'
import Alert from '@/components/ui/alert/Alert.vue'
import Breadcrumb from '@/components/ui/breadcrumb/Breadcrumb.vue'
import Tooltip from '@/components/ui/tooltip/Tooltip.vue'
import Tabs from '@/components/ui/tabs/Tabs.vue'
import { useHelmScratchpads } from '@/composables/useHelmScratchpads'
import { helmEditorDiagnostic } from '@/lib/helmResult'
import { cancelHelmExecution, cancelledHelmResult } from '@/lib/helmExecution'
import {
  helmScratchpadIsModified,
  helmScratchpadTargetTitle
} from '@/lib/helmScratchpads.mjs'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  project: Object,
  environment: Object,
  app: Object,
  target: Object,
  writeArmTtlSeconds: {
    type: Number,
    default: 60
  },
  appStatus: String
})

const page = usePage()
const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')
const breadcrumbs = computed(() => [
  { label: 'projects', href: '/' },
  {
    label: props.project.name.toLowerCase(),
    href: `/projects/${props.project.slug}`
  },
  {
    label: props.environment.name.toLowerCase(),
    href: `/projects/${props.project.slug}/environments/${props.environment.slug}`
  },
  ...(props.app
    ? [
        {
          label: props.app.name.toLowerCase(),
          title: props.app.name
        }
      ]
    : []),
  { label: 'helm' }
])

const scratchpads = useHelmScratchpads(() => props.target)
const {
  tabs: scratchpadTabs,
  activeId: activeScratchpadId,
  activeTab: activeScratchpad,
  currentTargetKey,
  code,
  view: resultView,
  result: executionResult,
  error: requestError,
  canCreate: canCreateScratchpad
} = scratchpads
const running = ref(false)
const stopping = ref(false)
const editor = ref(null)
const library = ref(null)
const libraryOpen = ref(false)
const libraryTab = ref('history')
const completionMetadata = ref(null)
const writeGuard = ref({
  show: false,
  execution: null,
  findings: [],
  target: null,
  error: ''
})
const writeArm = ref(null)
const writeArmRemaining = ref(0)
const armingWrites = ref(false)
const inspectingSource = ref(false)
const targetSwitch = ref({ show: false, tab: null })
const closeScratchpadGuard = ref({ show: false, tab: null })
const editorSelection = ref({
  hasSelection: false,
  hasExecutableSelection: false,
  source: code.value
})
let executionSequence = 0
let activeExecution = null
let completionRequestSequence = 0
let writeArmTimer = null

const isRunning = computed(() => props.appStatus === 'running')
const isProduction = computed(() => Boolean(props.environment.isProduction))
const writeArmActive = computed(
  () =>
    Boolean(writeArm.value) &&
    writeArmRemaining.value > 0 &&
    writeArm.value.expiresAt > Date.now()
)
const runLabel = computed(() =>
  editorSelection.value.hasSelection ? 'Run selection' : 'Run'
)
const canExecute = computed(() => {
  if (!isRunning.value || running.value || inspectingSource.value) return false
  if (editorSelection.value.hasSelection) {
    return editorSelection.value.hasExecutableSelection
  }
  return Boolean(code.value.trim())
})
const helmLibraryUrl = computed(
  () =>
    `/api/v1/projects/${props.project.slug}/environments/${props.environment.slug}/helm`
)
const targetSwitchMessage = computed(() => {
  const target = targetSwitch.value.tab?.target
  return target
    ? `This scratchpad runs against ${helmScratchpadTargetTitle(
        target
      )}. Confirm the production target before continuing.`
    : ''
})
const closeScratchpadMessage = computed(() => {
  const tab = closeScratchpadGuard.value.tab
  return tab
    ? `“${tab.name}” has changes that have not been executed or saved as a snippet.`
    : ''
})

async function execute(sourceOverride) {
  let execution
  if (typeof sourceOverride === 'string') {
    if (
      !sourceOverride.trim() ||
      !isRunning.value ||
      running.value ||
      inspectingSource.value
    )
      return
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

  const candidateArm =
    writeArmActive.value && writeArm.value.source === execution.source
      ? writeArm.value
      : null
  if (writeArm.value && !candidateArm) clearWriteArm()

  if (isProduction.value && !candidateArm) {
    inspectingSource.value = true
    requestError.value = ''
    try {
      const inspection = await inspectSource(execution.source)
      if (inspection.requiresWriteArm) {
        writeGuard.value = {
          show: true,
          execution,
          findings: inspection.classification?.findings || [],
          target: inspection.target || props.target,
          error: ''
        }
        return
      }
    } catch (error) {
      requestError.value =
        error.message || 'Could not inspect this production source.'
      return
    } finally {
      inspectingSource.value = false
    }
  }

  editor.value.highlightExecution(execution)
  editor.value.clearDiagnostics()
  editor.value.clearInspections()
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
  const activeArm = candidateArm
  if (activeArm) clearWriteArm()

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
          sourceStartColumn: execution.startColumn,
          appSlug: props.app?.slug,
          writeArmToken: activeArm?.token
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
      if (response.status === 409 && result.code === 'HELM_WRITES_NOT_ARMED') {
        writeGuard.value = {
          show: true,
          execution,
          findings: result.classification?.findings || [],
          target: result.target || props.target,
          error: ''
        }
        return
      }
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
    editor.value.showInspections(result.inspections)
    const diagnostic = helmEditorDiagnostic(result.error)
    if (diagnostic) editor.value.showDiagnostic(diagnostic)
    if (!execution.hasSelection) {
      scratchpads.markCurrentSourceSaved(code.value)
    }

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

async function inspectSource(source) {
  const response = await fetch(`${helmLibraryUrl.value}/inspect-source`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-csrf-token': page.props._csrf || ''
    },
    cache: 'no-store',
    body: JSON.stringify({
      code: source,
      appSlug: props.app?.slug
    })
  })
  const text = await response.text()
  let result
  try {
    result = JSON.parse(text)
  } catch {
    throw new Error(text || 'Could not inspect this production source.')
  }
  if (!response.ok) {
    throw new Error(
      result.message ||
        result.error ||
        'Could not inspect this production source.'
    )
  }
  return result
}

async function armWrites() {
  const execution = writeGuard.value.execution
  if (!execution || armingWrites.value) return

  armingWrites.value = true
  writeGuard.value.error = ''
  try {
    const response = await fetch(`${helmLibraryUrl.value}/arm-writes`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'x-csrf-token': page.props._csrf || ''
      },
      cache: 'no-store',
      body: JSON.stringify({
        code: execution.source,
        appSlug: props.app?.slug
      })
    })
    const text = await response.text()
    let result
    try {
      result = JSON.parse(text)
    } catch {
      throw new Error(text || 'Could not arm production writes.')
    }
    if (!response.ok) {
      throw new Error(
        result.message || result.error || 'Could not arm production writes.'
      )
    }

    writeArm.value = {
      token: result.token,
      sourceHash: result.sourceHash,
      source: execution.source,
      expiresAt: result.expiresAt,
      target: result.target
    }
    writeGuard.value = {
      show: false,
      execution: null,
      findings: [],
      target: null,
      error: ''
    }
    startWriteArmTimer()
    await nextTick()
    editor.value?.focus()
  } catch (error) {
    writeGuard.value.error = error.message || 'Could not arm production writes.'
  } finally {
    armingWrites.value = false
  }
}

function cancelWriteGuard() {
  if (armingWrites.value) return
  writeGuard.value = {
    show: false,
    execution: null,
    findings: [],
    target: null,
    error: ''
  }
  nextTick(() => editor.value?.focus())
}

function startWriteArmTimer() {
  window.clearInterval(writeArmTimer)
  updateWriteArmRemaining()
  writeArmTimer = window.setInterval(updateWriteArmRemaining, 250)
}

function updateWriteArmRemaining() {
  if (!writeArm.value) {
    writeArmRemaining.value = 0
    return
  }
  writeArmRemaining.value = Math.max(
    0,
    Math.ceil((writeArm.value.expiresAt - Date.now()) / 1000)
  )
  if (writeArmRemaining.value === 0) clearWriteArm()
}

function clearWriteArm() {
  writeArm.value = null
  writeArmRemaining.value = 0
  window.clearInterval(writeArmTimer)
  writeArmTimer = null
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
  scratchpads.clearRuntime()
  editor.value?.clearDiagnostics()
  editor.value?.clearInspections()
}

async function activateScratchpad(tab) {
  if (!tab || running.value || inspectingSource.value) return
  if (tab.target.key === currentTargetKey.value) {
    scratchpads.activate(tab.id)
    clearWriteArm()
    await nextTick()
    editor.value?.clearDiagnostics()
    editor.value?.clearInspections()
    editor.value?.focus()
    return
  }

  if (tab.target.environment.isProduction) {
    targetSwitch.value = { show: true, tab }
    return
  }
  openScratchpadTarget(tab)
}

function activateScratchpadById(id) {
  const tab = scratchpadTabs.value.find((item) => item.id === id)
  if (tab) activateScratchpad(tab)
}

function openScratchpadTarget(tab = targetSwitch.value.tab) {
  if (!tab) return
  targetSwitch.value = { show: false, tab: null }
  scratchpads.activate(tab.id)
  router.visit(tab.target.href)
}

async function createScratchpad() {
  if (running.value || inspectingSource.value) return
  const tab = scratchpads.create()
  if (!tab) return
  clearWriteArm()
  await nextTick()
  editor.value?.focus()
}

async function duplicateScratchpad(tab) {
  if (running.value || inspectingSource.value) return
  const copy = scratchpads.duplicate(tab.id)
  if (!copy) return
  clearWriteArm()
  await nextTick()
  editor.value?.focus()
}

function requestCloseScratchpad(tab) {
  if (!tab || running.value || inspectingSource.value) return
  if (helmScratchpadIsModified(tab)) {
    closeScratchpadGuard.value = { show: true, tab }
    return
  }
  closeScratchpad(tab)
}

function closeScratchpad(tab = closeScratchpadGuard.value.tab) {
  if (!tab) return
  closeScratchpadGuard.value = { show: false, tab: null }
  scratchpads.close(tab.id)
  clearWriteArm()
  nextTick(() => editor.value?.focus())
}

async function saveScratchpadAsSnippet() {
  libraryTab.value = 'snippets'
  libraryOpen.value = true
  await nextTick()
  library.value?.openSnippetDialog(code.value)
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
  clearWriteArm()
  window.removeEventListener('focus', loadCompletionMetadata)
})

watch(code, () => {
  editor.value?.clearDiagnostics()
  editor.value?.clearInspections()
  if (writeArm.value && writeArm.value.source !== code.value) clearWriteArm()
})
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
      <div class="flex min-w-0 flex-1 items-center space-x-3">
        <!-- Mobile menu toggle -->
        <button
          data-test="helm-mobile-menu"
          @click="toggleMobileMenu"
          class="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white md:hidden"
        >
          <SidebarOpen class="h-5 w-5" stroke-width="1" />
        </button>
        <!-- Desktop sidebar toggle -->
        <button
          @click="toggleSidebar"
          class="hidden text-gray-400 dark:text-gray-500 md:block"
        >
          <SidebarOpen
            v-if="sidebarCollapsed"
            class="h-5 w-5"
            stroke-width="1"
          />
          <SidebarClose v-else class="h-5 w-5" stroke-width="1" />
        </button>
        <Breadcrumb :items="breadcrumbs" class="flex-1" />
      </div>
      <div class="flex shrink-0 items-center space-x-2 sm:space-x-3">
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
          <Tooltip text="History" placement="bottom">
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
              <History class="h-4 w-4" stroke-width="1.75" />
              <span class="sr-only">History</span>
            </button>
          </Tooltip>
          <Tooltip text="Snippets" placement="bottom">
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
              <Bookmark class="h-4 w-4" stroke-width="1.75" />
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
            running || writeArmActive
              ? 'bg-red-600 hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-500'
              : 'bg-gray-900 hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100'
          ]"
        >
          <Spinner v-if="stopping || inspectingSource" class="h-3 w-3" />
          <Stop v-else-if="running" class="h-3 w-3" />
          <Play v-else class="h-3 w-3" />
          <span class="hidden sm:inline">{{
            stopping
              ? 'Stopping'
              : running
              ? 'Stop'
              : inspectingSource
              ? 'Checking'
              : writeArmActive
              ? `Run write · ${writeArmRemaining}s`
              : runLabel
          }}</span>
          <span
            v-if="writeArmActive"
            data-test="helm-writes-armed"
            class="sr-only"
            role="status"
          >
            Production writes armed for {{ writeArmRemaining }} seconds
          </span>
        </button>

        <!-- Docs link -->
        <a
          href="https://docs.sailscasts.com/slipway/helm"
          target="_blank"
          class="hidden items-center space-x-1 text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white sm:flex"
        >
          <span>Docs</span>
          <ExternalLink class="h-3.5 w-3.5" stroke-width="2" />
        </a>
      </div>
    </div>

    <Tabs
      :model-value="activeScratchpadId"
      aria-label="Helm scratchpads"
      class="contents"
      @change="activateScratchpadById"
    >
      <HelmScratchpadTabs
        :tabs="scratchpadTabs"
        :active-id="activeScratchpadId"
        :current-target-key="currentTargetKey"
        :disabled="running || inspectingSource"
        :can-create="canCreateScratchpad"
        @create="createScratchpad"
        @rename="scratchpads.rename"
        @duplicate="duplicateScratchpad"
        @move="(tab, offset) => scratchpads.move(tab.id, offset)"
        @save="saveScratchpadAsSnippet"
        @close="requestCloseScratchpad"
      />
    </Tabs>

    <!-- Main content - Tinkerwell style -->
    <div
      id="helm-scratchpad-panel"
      role="tabpanel"
      :aria-labelledby="
        activeScratchpad
          ? `helm-scratchpad-${activeScratchpad.id}-tab`
          : undefined
      "
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
          v-model:view="resultView"
          :result="executionResult"
          :error="requestError"
          :loading="running"
          :target="target"
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
          @snippet-saved="scratchpads.markCurrentSourceSaved"
        />
      </div>
    </div>

    <HelmWriteGuardDialog
      :show="writeGuard.show"
      :findings="writeGuard.findings"
      :target="writeGuard.target"
      :ttl-seconds="writeArmTtlSeconds"
      :loading="armingWrites"
      :error="writeGuard.error"
      @arm="armWrites"
      @cancel="cancelWriteGuard"
    />

    <ConfirmModal
      :show="targetSwitch.show"
      title="Open production scratchpad?"
      :message="targetSwitchMessage"
      confirm-label="Open production"
      @cancel="targetSwitch = { show: false, tab: null }"
      @confirm="openScratchpadTarget"
    />

    <ConfirmModal
      :show="closeScratchpadGuard.show"
      title="Close modified scratchpad?"
      :message="closeScratchpadMessage"
      confirm-label="Close scratchpad"
      destructive
      @cancel="closeScratchpadGuard = { show: false, tab: null }"
      @confirm="closeScratchpad"
    />

    <!-- Not running warning -->
    <Alert
      v-if="!isRunning"
      data-test="helm-not-running-notice"
      role="note"
      class="rounded-none border-t border-amber-200 bg-amber-50 px-4 py-3 text-inherit dark:border-amber-900/50 dark:bg-amber-900/10"
    >
      <p class="text-center text-sm text-amber-700 dark:text-amber-400">
        App not running. Deploy first to use Helm.
      </p>
    </Alert>
  </div>
</template>
