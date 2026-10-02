<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Stop from '@/components/ui/icons/Stop.vue'
import History from '@/components/ui/icons/History.vue'
import InfoCircle from '@/components/ui/icons/InfoCircle.vue'
import Popover from '@/components/ui/popover/Popover.vue'
import Spinner from '@/components/SlipwaySpinner.vue'
import Input from '@/components/ui/input/Input.vue'
import HelmWriteGuardDialog from '@/components/HelmWriteGuardDialog.vue'
import { cancelHelmExecution } from '@/lib/helmExecution'
import { readHelmCommandStream } from '@/lib/helmCommandStream.mjs'

const props = defineProps({
  baseUrl: { type: String, required: true },
  target: { type: Object, required: true },
  appSlug: String,
  appRunning: Boolean,
  active: Boolean,
  csrf: { type: String, default: '' },
  ttlSeconds: { type: Number, default: 60 }
})
const emit = defineEmits(['busy'])
const source = ref('')
const displayTarget = ref(props.target)
const commandInput = ref(null)
const logs = ref([])
const result = ref(null)
const error = ref('')
const inputError = ref('')
const busy = ref(false)
const stopping = ref(false)
const started = ref(false)
const admitted = ref(false)
const displayTruncated = ref(false)
const requestedAt = ref(0)
const now = ref(Date.now())
const history = ref([])
const historyOpen = ref(false)
const helpOpen = ref(false)
const historyError = ref('')
const guard = ref({ show: false, findings: [], target: null, error: '' })
const arming = ref(false)
const writeArm = ref(null)
const lastSource = ref('')
let activeExecution = null
let sequence = 0
let historySequence = 0
let armSequence = 0
let clock
let logBytes = 0
let composing = false

const targetKey = computed(() =>
  JSON.stringify([
    props.target?.app?.id,
    props.target?.environment?.id,
    props.target?.deployment?.id,
    props.target?.container,
    props.target?.version
  ])
)
const armRemaining = computed(() =>
  Math.max(0, Math.ceil(((writeArm.value?.expiresAt || 0) - now.value) / 1000))
)
const armed = computed(
  () => writeArm.value?.source === source.value && armRemaining.value > 0
)
const elapsed = computed(() =>
  (
    (result.value?.durationMs ??
      (requestedAt.value ? now.value - requestedAt.value : 0)) / 1000
  ).toFixed(1)
)
const statusLabel = computed(() =>
  busy.value
    ? stopping.value
      ? 'Stopping'
      : started.value
      ? 'Running'
      : 'Preparing'
    : {
        success: 'Completed',
        error: 'Failed',
        timeout: 'Timed out',
        cancelled: 'Cancelled',
        unconfirmed: 'Unconfirmed'
      }[result.value?.status] || 'Ready'
)
const runLabel = computed(() =>
  armed.value
    ? `Run command · ${armRemaining.value}s`
    : result.value && source.value === lastSource.value
    ? 'Run again'
    : 'Run'
)

const draftChanged = computed(
  () => Boolean(lastSource.value) && source.value !== lastSource.value
)
const failed = computed(() =>
  ['error', 'timeout'].includes(result.value?.status)
)

function headers() {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'x-csrf-token': props.csrf
  }
}
async function api(suffix, body) {
  const response = await fetch(`${props.baseUrl}${suffix}`, {
    method: 'POST',
    headers: headers(),
    cache: 'no-store',
    body: JSON.stringify(body)
  })
  let data
  try {
    data = await response.json()
  } catch {
    throw new Error('The server did not return a valid response.')
  }
  if (!response.ok)
    throw new Error(data.message || data.error || 'The command request failed.')
  return data
}
function clearArm() {
  armSequence++
  writeArm.value = null
  if (arming.value) {
    arming.value = false
    emit('busy', busy.value)
  }
}
function setBusy(value) {
  busy.value = value
  emit('busy', value)
}
function appendLog(event) {
  if (displayTruncated.value) return
  const previous = logs.value.at(-1)
  if (logs.value.length >= 1024 && previous?.type !== event.type) {
    displayTruncated.value = true
    return
  }
  const remaining = 64 * 1024 - logBytes
  if (remaining <= 0) {
    displayTruncated.value = true
    return
  }
  const bytes = new TextEncoder().encode(event.text)
  const text = new TextDecoder().decode(bytes.subarray(0, remaining), {
    stream: true
  })
  logBytes += new TextEncoder().encode(text).byteLength
  if (!text) return
  if (previous?.type === event.type) previous.text += text
  else logs.value.push({ type: event.type, text })
  if (bytes.byteLength > remaining) displayTruncated.value = true
}
function resultError(value) {
  return typeof value === 'string' ? value : value?.message || ''
}
function stripAnsi(text) {
  return String(text).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
}
function handleCommandKeydown(event) {
  if (event.key !== 'Enter') return
  // Let the input's native IME confirmation finish. Implicit form submission
  // never executes; only a deliberate Enter or return-control activation does.
  if (composing || event.isComposing || event.keyCode === 229) {
    if (event.currentTarget?.tagName === 'BUTTON') event.preventDefault()
    return
  }
  event.preventDefault()
  if (
    event.repeat ||
    event.shiftKey ||
    event.ctrlKey ||
    event.altKey ||
    event.metaKey
  )
    return
  void execute()
}
function rejectMultilineTransfer(event) {
  const text = (event.clipboardData || event.dataTransfer)?.getData(
    'text/plain'
  )
  if (!text || !/[\r\n\u2028\u2029]/.test(text)) return
  // A text input silently removes line breaks. Do not turn a pasted script
  // into a different, executable single-line command.
  event.preventDefault()
  clearArm()
  inputError.value = 'Paste one command on a single line.'
}

async function execute() {
  if (
    busy.value ||
    arming.value ||
    composing ||
    inputError.value ||
    guard.value.show ||
    !props.active ||
    !props.appRunning ||
    !source.value.trim()
  )
    return
  const submitted = source.value
  const scope = targetKey.value
  const current = ++sequence
  error.value = ''
  inputError.value = ''
  setBusy(true)
  started.value = false
  requestedAt.value = 0
  try {
    const inspection = await api('/inspect-source', {
      code: submitted,
      mode: 'command',
      appSlug: props.appSlug
    })
    if (current !== sequence || scope !== targetKey.value) return
    if (inspection.requiresWriteArm && !armed.value) {
      guard.value = {
        show: true,
        findings: inspection.classification.findings,
        target: inspection.target,
        error: ''
      }
      return
    }
    const token = armed.value ? writeArm.value.token : undefined
    clearArm()
    const id = crypto.randomUUID()
    const controller = new AbortController()
    activeExecution = { id, controller, sequence: current }
    lastSource.value = submitted
    logs.value = []
    displayTruncated.value = false
    admitted.value = false
    logBytes = 0
    result.value = null
    requestedAt.value = Date.now()
    now.value = requestedAt.value
    const response = await fetch(`${props.baseUrl}/commands`, {
      method: 'POST',
      headers: { ...headers(), Accept: 'application/x-ndjson' },
      cache: 'no-store',
      body: JSON.stringify({
        code: submitted,
        appSlug: props.appSlug,
        executionId: id,
        writeArmToken: token
      }),
      signal: controller.signal
    })
    const terminal = await readHelmCommandStream(response, {
      executionId: id,
      onEvent(event) {
        if (current !== sequence) return
        if (event.type === 'accepted') {
          admitted.value = true
          displayTarget.value = event.target || props.target
        } else if (event.type === 'started') started.value = true
        else if (['stdout', 'stderr'].includes(event.type)) appendLog(event)
      }
    })
    if (current !== sequence) return
    result.value = terminal
    error.value = resultError(terminal.error)
    void refreshHistory()
  } catch (caught) {
    if (current !== sequence) return
    if (activeExecution && !caught.requestFailed) {
      result.value = {
        status: 'unconfirmed',
        success: false,
        exitCode: null,
        durationMs: Date.now() - requestedAt.value
      }
      error.value =
        'The command outcome is unconfirmed. Check the selected app before running it again.'
    } else {
      error.value = caught.message || 'The command request failed.'
    }
  } finally {
    if (current === sequence) {
      activeExecution = null
      admitted.value = false
      stopping.value = false
      setBusy(false)
      await nextTick()
      if (props.active && !guard.value.show) commandInput.value?.focus()
    }
  }
}
async function arm() {
  if (arming.value || !guard.value.show) return
  const currentArm = ++armSequence
  arming.value = true
  emit('busy', true)
  guard.value.error = ''
  const submitted = source.value
  const scope = targetKey.value
  try {
    const data = await api('/arm-writes', {
      code: submitted,
      mode: 'command',
      appSlug: props.appSlug
    })
    if (
      currentArm !== armSequence ||
      source.value !== submitted ||
      targetKey.value !== scope ||
      !props.active
    )
      return
    writeArm.value = {
      token: data.token,
      expiresAt: data.expiresAt,
      source: submitted
    }
    now.value = Date.now()
    guard.value.show = false
  } catch (caught) {
    if (currentArm === armSequence) guard.value.error = caught.message
  } finally {
    if (currentArm === armSequence) {
      arming.value = false
      emit('busy', busy.value)
      await nextTick()
      if (currentArm === armSequence && props.active && !guard.value.show)
        commandInput.value?.focus()
    }
  }
}
function cancelGuard() {
  if (!arming.value) {
    guard.value.show = false
    nextTick(() => commandInput.value?.focus())
  }
}
async function stop() {
  const execution = activeExecution
  if (!execution || !admitted.value || stopping.value) return
  stopping.value = true
  error.value = ''
  try {
    const confirmed = await cancelHelmExecution(execution.id, props.csrf)
    if (activeExecution?.sequence !== execution.sequence) return
    if (!confirmed)
      error.value =
        'Stop could not be confirmed. Check the command result and selected app.'
    // Only the streamed terminal envelope can change the execution result.
  } catch (caught) {
    if (activeExecution?.sequence === execution.sequence)
      error.value = caught.message || 'Could not request Stop.'
  } finally {
    if (activeExecution?.sequence === execution.sequence) stopping.value = false
  }
}
async function refreshHistory() {
  const current = ++historySequence
  const scope = targetKey.value
  try {
    const query = new URLSearchParams({
      mode: 'command',
      appSlug: props.appSlug || ''
    })
    const response = await fetch(`${props.baseUrl}/history?${query}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    })
    if (!response.ok) throw new Error('Command history is unavailable.')
    const data = await response.json()
    if (current === historySequence && scope === targetKey.value) {
      history.value = data.entries || []
      historyError.value = ''
    }
  } catch (caught) {
    if (current === historySequence) historyError.value = caught.message
  }
}
function loadHistory(entry) {
  if (busy.value || arming.value) return
  // Restoring a draft is always a new editing decision, even if its text matches
  // an armed command. It must never reuse that command's production permission.
  clearArm()
  inputError.value = ''
  source.value = entry.source
  historyOpen.value = false
  nextTick(() => commandInput.value?.focus())
}
function resetTarget() {
  sequence++
  historySequence++
  activeExecution?.controller.abort()
  activeExecution = null
  admitted.value = false
  displayTruncated.value = false
  clearArm()
  source.value = ''
  lastSource.value = ''
  historyOpen.value = false
  helpOpen.value = false
  displayTarget.value = props.target
  logs.value = []
  history.value = []
  result.value = null
  error.value = ''
  guard.value.show = false
  inputError.value = ''
  composing = false
  setBusy(false)
  stopping.value = false
  requestedAt.value = 0
  if (props.active) refreshHistory()
}
watch(source, () => {
  clearArm()
  inputError.value = ''
})
watch(targetKey, resetTarget)
watch(
  () => props.active,
  (active) => {
    if (!active) {
      helpOpen.value = false
      clearArm()
      guard.value.show = false
    } else {
      refreshHistory()
      nextTick(() => commandInput.value?.focus())
    }
  }
)
watch(
  () => busy.value || Boolean(writeArm.value),
  (ticking) => {
    clearInterval(clock)
    if (ticking)
      clock = setInterval(() => {
        now.value = Date.now()
        if (!busy.value && writeArm.value?.expiresAt <= now.value) clearArm()
      }, 250)
  }
)
onMounted(() => {
  refreshHistory()
  if (props.active) commandInput.value?.focus()
})
onBeforeUnmount(() => {
  armSequence++
  sequence++
  historySequence++
  activeExecution?.controller.abort()
  clearInterval(clock)
  emit('busy', false)
})
</script>

<template>
  <section
    data-test="helm-command-console"
    aria-label="Helm command console"
    class="flex min-h-0 flex-1 flex-col overflow-hidden bg-white dark:bg-gray-950"
  >
    <div class="shrink-0 space-y-1 px-4 pt-3 sm:px-8">
      <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p
          data-test="helm-command-target"
          class="min-w-0 break-words text-sm text-gray-700 dark:text-gray-300"
        >
          <span class="font-semibold text-gray-900 dark:text-gray-100">{{
            displayTarget.app?.name || appSlug
          }}</span>
          <span aria-hidden="true" class="mx-1 text-gray-400">/</span>
          <span
            :class="
              displayTarget.environment?.isProduction
                ? 'font-medium text-amber-700 dark:text-amber-400'
                : ''
            "
            >{{
              displayTarget.environment?.name || displayTarget.environment?.slug
            }}</span
          ><span v-if="displayTarget.displayVersion" class="text-xs">
            @ {{ displayTarget.displayVersion }}</span
          >
        </p>
        <div
          class="flex shrink-0 items-center gap-1 text-xs text-gray-600 dark:text-gray-400"
        >
          <button
            type="button"
            aria-label="Command history"
            :aria-expanded="historyOpen"
            aria-controls="helm-command-history"
            class="min-h-11 sm:min-h-8 flex items-center gap-1.5 rounded-md px-2 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-500 dark:hover:bg-gray-800"
            @click="historyOpen = !historyOpen"
          >
            <History class="h-4 w-4" /> History
          </button>
          <button
            type="button"
            aria-label="Command help"
            popovertarget="helm-command-help"
            class="min-h-11 min-w-11 sm:min-h-8 sm:min-w-8 flex items-center justify-center rounded-md hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-500 dark:hover:bg-gray-800"
          >
            <InfoCircle class="h-4 w-4" />
          </button>
        </div>
      </div>
      <Popover
        id="helm-command-help"
        v-model:open="helpOpen"
        aria-label="Command help"
        placement="bottom-end"
        class="w-72 space-y-2 text-xs leading-5 text-gray-700 dark:text-gray-300"
      >
        <p class="font-medium text-gray-900 dark:text-gray-100">
          Running commands
        </p>
        <p>
          Press Enter to run one executable with arguments. Shell operators and
          interactive input aren’t supported.
        </p>
        <p id="helm-command-hint">
          Commands are saved; output isn’t. Keep secrets in environment
          variables.
        </p>
        <p>
          History restores a command for editing. Production commands require a
          fresh, single-use confirmation.
        </p>
      </Popover>
      <form
        class="flex items-center gap-2 border-b border-dashed border-gray-200 focus-within:border-gray-500 dark:border-gray-800 dark:focus-within:border-gray-500"
        @submit.prevent
      >
        <label
          for="helm-command-input"
          class="select-none font-mono text-sm text-gray-400"
          aria-hidden="true"
          >&gt;</label
        >
        <Input
          id="helm-command-input"
          ref="commandInput"
          v-model="source"
          aria-label="Helm command"
          placeholder="sails run your-script --input=value"
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          enterkeyhint="send"
          spellcheck="false"
          :aria-describedby="
            inputError
              ? 'helm-command-hint helm-command-input-error'
              : 'helm-command-hint'
          "
          :aria-invalid="Boolean(inputError)"
          :disabled="busy || arming || !appRunning"
          class="h-12 min-w-0 flex-1 rounded-none border-0 bg-transparent px-1 font-mono text-base text-gray-900 outline-none placeholder:text-gray-400 focus:ring-0 dark:text-gray-100 dark:placeholder:text-gray-600 sm:text-sm"
          @keydown="handleCommandKeydown"
          @input="inputError = ''"
          @compositionstart="composing = true"
          @compositionend="composing = false"
          @paste="rejectMultilineTransfer"
          @drop="rejectMultilineTransfer"
        />
        <button
          v-if="busy"
          type="button"
          :disabled="stopping || !admitted"
          aria-label="Stop command"
          class="min-h-11 sm:min-h-9 flex items-center gap-1.5 rounded-md px-3 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/30"
          @click="stop"
        >
          <Spinner v-if="stopping" class="h-3.5 w-3.5" /><Stop
            v-else
            class="h-3.5 w-3.5"
          />{{ stopping ? 'Stopping' : 'Stop' }}
        </button>
        <button
          v-else
          type="button"
          :disabled="
            arming || !appRunning || !source.trim() || Boolean(inputError)
          "
          data-test="helm-command-run"
          :aria-label="runLabel"
          :title="runLabel"
          @keydown="handleCommandKeydown"
          @click="execute"
          class="min-h-11 min-w-11 sm:min-h-9 flex shrink-0 items-center justify-center gap-2 rounded-md px-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-30 dark:text-gray-400 dark:hover:bg-gray-900 dark:hover:text-gray-100"
        >
          <span aria-hidden="true" class="hidden text-xs sm:inline">Enter</span>
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="h-4 w-4"
          >
            <path d="M16 4v6a2 2 0 0 1-2 2H4m4-4-4 4 4 4" />
          </svg>
        </button>
      </form>
      <div
        v-if="draftChanged || armed"
        class="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs"
      >
        <span
          v-if="draftChanged"
          data-test="helm-command-draft"
          class="text-gray-600 dark:text-gray-400"
          >Draft changed · not run</span
        >
        <span v-if="armed" role="status" class="text-red-600 dark:text-red-400">
          Armed · {{ armRemaining }}s
        </span>
      </div>
      <p
        v-if="inputError"
        id="helm-command-input-error"
        role="alert"
        class="text-xs text-amber-700 dark:text-amber-400"
      >
        {{ inputError }}
      </p>
    </div>
    <div
      v-if="historyOpen"
      id="helm-command-history"
      class="max-h-48 shrink-0 overflow-auto border-b border-gray-200 px-4 py-3 dark:border-gray-800 sm:px-8"
      aria-label="Command history entries"
    >
      <p v-if="historyError" role="alert" class="text-xs text-amber-600">
        {{ historyError }}
      </p>
      <p v-else-if="!history.length" class="text-xs text-gray-400">
        No command history for this app.
      </p>
      <button
        v-for="entry in history"
        :key="entry.id"
        type="button"
        :disabled="busy || arming"
        class="flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left text-xs hover:bg-gray-100 disabled:opacity-50 dark:hover:bg-gray-900"
        @click="loadHistory(entry)"
      >
        <code class="min-w-0 flex-1 truncate">{{ entry.source }}</code
        ><span class="shrink-0 text-gray-400"
          >{{ entry.status }} ·
          {{ (entry.durationMs / 1000).toFixed(1) }}s</span
        ><span class="sr-only">Load command</span>
      </button>
    </div>
    <div class="shrink-0 px-4 pb-1 pt-2 sm:px-8">
      <p
        v-if="lastSource"
        id="helm-command-provenance"
        data-test="helm-command-provenance"
        :class="
          draftChanged || (busy && !requestedAt)
            ? 'mb-1 break-words text-xs leading-5 text-gray-600 dark:text-gray-400'
            : 'sr-only'
        "
      >
        Output from
        <code class="text-gray-800 dark:text-gray-200">{{ lastSource }}</code>
      </p>
      <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
        <span
          role="status"
          data-test="helm-command-status"
          class="font-medium"
          :class="
            result?.status === 'unconfirmed'
              ? 'text-amber-700 dark:text-amber-400'
              : failed
              ? 'text-red-700 dark:text-red-400'
              : 'text-gray-700 dark:text-gray-300'
          "
          >{{ statusLabel }}</span
        >
        <span v-if="requestedAt" class="text-gray-500 dark:text-gray-400"
          >{{ elapsed }}s</span
        >
        <span
          v-if="
            Number.isInteger(result?.exitCode) && result?.status !== 'success'
          "
          class="font-medium text-red-700 dark:text-red-400"
          >exit {{ result.exitCode }}</span
        >
        <span v-if="result?.signal" class="text-gray-600 dark:text-gray-400">{{
          result.signal
        }}</span>
        <span
          v-if="result?.truncated || displayTruncated"
          class="text-amber-700 dark:text-amber-400"
          >Output truncated</span
        >
        <details
          v-if="
            result?.status === 'success' && Number.isInteger(result?.exitCode)
          "
          :key="requestedAt"
          class="ml-auto text-gray-500 dark:text-gray-400"
        >
          <summary
            aria-label="Execution details"
            class="cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-500"
          >
            Details
          </summary>
          <p class="pt-1">exit {{ result.exitCode }}</p>
        </details>
      </div>
    </div>
    <p
      v-if="error"
      role="alert"
      data-test="helm-command-error"
      class="shrink-0 border-b border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/30 dark:bg-amber-950/20 dark:text-amber-200 sm:px-8"
    >
      {{ error }}
    </p>
    <div
      tabindex="0"
      role="region"
      aria-label="Command output"
      :aria-describedby="lastSource ? 'helm-command-provenance' : undefined"
      class="min-h-0 flex-1 overflow-auto px-4 py-2 font-mono text-sm leading-6 sm:px-8"
    >
      <pre
        class="whitespace-pre-wrap break-words"
      ><span v-for="(log, index) in logs" :key="index" :class="log.type === 'stderr' ? 'text-amber-700 dark:text-amber-400' : 'text-gray-800 dark:text-gray-200'">{{ stripAnsi(log.text) }}</span><span v-if="!logs.length" class="text-gray-400">{{ busy ? 'Waiting for command output…' : result ? 'No command output.' : 'Command output will appear here.' }}</span></pre>
    </div>
    <HelmWriteGuardDialog
      mode="command"
      :show="guard.show"
      :findings="guard.findings"
      :target="guard.target"
      :ttl-seconds="ttlSeconds"
      :loading="arming"
      :error="guard.error"
      @arm="arm"
      @cancel="cancelGuard"
    />
  </section>
</template>
