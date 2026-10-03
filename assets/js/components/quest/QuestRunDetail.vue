<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import Tabs from '@/components/ui/tabs/Tabs.vue'
import Button from '@/components/ui/button/Button.vue'
import Spinner from '@/components/SlipwaySpinner.vue'
import ChevronLeft from '@/components/ui/icons/ChevronLeft.vue'
import Play from '@/components/ui/icons/Play.vue'
import Refresh from '@/components/ui/icons/Refresh.vue'
import QuestStatus from './QuestStatus.vue'
import QuestResult from './QuestResult.vue'
import {
  formatQuestDuration,
  questAbsoluteTime,
  questErrorText,
  isActiveQuestRun
} from '@/lib/questWorkspace.mjs'

const props = defineProps({
  apiUrl: String,
  runId: String,
  eventId: String,
  revision: String,
  job: Object,
  canRun: Boolean,
  canCancel: Boolean,
  embedded: Boolean
})
const emit = defineEmits(['close', 'run-again', 'loaded'])
const run = ref(null)
const loading = ref(false)
const error = ref('')
const logs = ref(null)
const logsLoading = ref(false)
const logsError = ref('')
const tab = ref('result')
let sequence = 0
let controller
const legacy = computed(() => !!props.eventId)
const recordedInputs = computed(() =>
  Object.entries(run.value?.inputs || {}).map(([name, value]) => ({
    name,
    value: props.job?.inputs?.find((input) => input.name === name)?.sensitive
      ? '[REDACTED]'
      : JSON.stringify(value)
  }))
)
const active = computed(() => !legacy.value && isActiveQuestRun(run.value))
const tabClass = (value) => [
  'border-b-2 pb-2.5 text-sm font-medium',
  tab.value === value
    ? 'border-gray-900 text-gray-900 dark:border-white dark:text-white'
    : 'border-transparent text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
]
const stripAnsi = (text) =>
  String(text || '').replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')

async function load(reset = false) {
  const current = ++sequence
  controller?.abort()
  logsLoading.value = false
  controller = new AbortController()
  if (reset) {
    run.value = null
    logs.value = null
    logsError.value = ''
    tab.value = 'result'
  }
  loading.value = true
  error.value = ''
  try {
    const url = legacy.value
      ? `${props.apiUrl}/events/${encodeURIComponent(props.eventId)}`
      : `${props.apiUrl}/runs/${encodeURIComponent(props.runId)}`
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok)
      throw new Error(
        response.status === 404
          ? 'These details are not available yet, or the run is outside retained history.'
          : `Could not load details (HTTP ${response.status}).`
      )
    const data = await response.json()
    if (current !== sequence) return
    const detail = legacy.value ? data.event : data.run
    if (!detail) throw new Error('No run details were received.')
    if (
      (!legacy.value && detail.runId !== props.runId) ||
      (legacy.value && String(detail.eventId) !== props.eventId)
    )
      throw new Error('The returned details do not match this selection.')
    run.value = detail
    emit('loaded', detail)
    if (legacy.value)
      logs.value = {
        stdout: detail.stdout || '',
        stderr: detail.stderr || '',
        available:
          typeof detail.stdout === 'string' ||
          typeof detail.stderr === 'string',
        truncated: detail.truncated
      }
    else if (tab.value === 'logs') await loadLogs()
  } catch (failure) {
    if (current === sequence && failure.name !== 'AbortError')
      error.value = failure.message
  } finally {
    if (current === sequence) loading.value = false
  }
}

async function loadLogs() {
  if (legacy.value || !props.runId || logsLoading.value) return
  const current = sequence
  const id = props.runId
  logsLoading.value = true
  logsError.value = ''
  try {
    const response = await fetch(
      `${props.apiUrl}/runs/${encodeURIComponent(id)}/logs`,
      { signal: controller?.signal }
    )
    if (!response.ok)
      throw new Error(`Could not load logs (HTTP ${response.status}).`)
    const data = await response.json()
    if (current === sequence && id === props.runId) logs.value = data
  } catch (failure) {
    if (current === sequence && failure.name !== 'AbortError')
      logsError.value = failure.message
  } finally {
    if (current === sequence) logsLoading.value = false
  }
}
watch(
  () => [props.runId, props.eventId, props.apiUrl],
  () => {
    logsLoading.value = false
    load(true)
  },
  { immediate: true }
)
watch(
  () => props.revision,
  () => load()
)
watch(tab, (value) => {
  if (value === 'logs' && !logs.value) loadLogs()
})
onBeforeUnmount(() => {
  sequence++
  controller?.abort()
})
</script>

<template>
  <section
    data-test="quest-run-detail"
    :class="[
      'min-w-0 overflow-hidden bg-white dark:bg-gray-950',
      !embedded && 'rounded-lg border border-gray-200 dark:border-gray-800'
    ]"
    aria-labelledby="quest-run-detail-title"
  >
    <div class="flex items-start justify-between gap-3 px-4 py-4">
      <div class="min-w-0">
        <h3
          id="quest-run-detail-title"
          class="text-sm font-medium text-gray-900 dark:text-white"
        >
          {{ legacy ? 'Legacy event' : 'Run details'
          }}<span
            v-if="job && !embedded"
            class="ml-2 text-gray-500 dark:text-gray-400"
            >{{ job.friendlyName || job.name }}</span
          >
        </h3>
        <p class="mt-1 break-all font-mono text-[10px] text-gray-400">
          {{ eventId || runId }}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <Button
          v-if="canRun && !legacy && run && !active"
          class="min-h-8 min-w-0 border border-gray-200 bg-transparent px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:bg-transparent dark:text-gray-300 dark:hover:bg-gray-800"
          @click="emit('run-again', run)"
          ><Play class="h-3 w-3" />Run again</Button
        >
        <button
          type="button"
          class="flex items-center gap-1 rounded p-1 text-xs text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          aria-label="Close run details"
          @click="emit('close')"
        >
          <ChevronLeft class="h-3.5 w-3.5" />All runs
        </button>
      </div>
    </div>
    <div
      v-if="loading && !run"
      class="flex items-center gap-2 px-4 py-8 text-sm text-gray-500"
    >
      <Spinner class="h-4 w-4" />Loading run…
    </div>
    <div
      v-else-if="error"
      role="alert"
      class="px-4 pb-4 text-sm text-red-600 dark:text-red-400"
    >
      {{ error }}
      <button type="button" class="ml-1 underline" @click="load()">
        Try again
      </button>
    </div>
    <template v-else-if="run">
      <div
        class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 pb-4 text-xs text-gray-500 dark:text-gray-400"
      >
        <QuestStatus :state="legacy ? run.event : run.state" />
        <span>{{
          legacy
            ? 'Telemetry event'
            : run.trigger === 'schedule' || run.trigger === 'scheduled'
            ? 'Scheduled'
            : run.trigger === 'manual'
            ? 'Manual'
            : run.trigger || 'Run'
        }}</span>
        <span
          :title="
            questAbsoluteTime(
              run.startedAt || run.requestedAt || run.recordedAt
            )
          "
          >{{
            questAbsoluteTime(
              run.startedAt || run.requestedAt || run.recordedAt
            )
          }}</span
        >
        <span>{{ formatQuestDuration(run.duration) }}</span>
        <span v-if="run.exitCode !== null && run.exitCode !== undefined"
          >Exit {{ run.exitCode }}</span
        >
      </div>
      <div
        v-if="run.error"
        role="status"
        class="mx-4 mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/20 dark:text-red-400"
      >
        {{ questErrorText(run.error) }}
      </div>
      <p
        v-if="active && !canCancel"
        class="px-4 pb-3 text-xs text-gray-500 dark:text-gray-400"
      >
        This runtime does not support cancellation.
      </p>
      <Tabs v-model="tab" aria-label="Run output">
        <div
          data-slot="tabs-list"
          class="flex gap-5 border-b border-gray-200 px-4 dark:border-gray-800"
        >
          <button data-value="result" :class="tabClass('result')">Result</button
          ><button data-value="logs" :class="tabClass('logs')">Logs</button>
        </div>
        <div data-slot="tab-panel" data-value="result">
          <QuestResult
            :result="run.result"
            :pending="active"
            :legacy="legacy"
          />
        </div>
        <div data-slot="tab-panel" data-value="logs" data-test="quest-run-logs">
          <div
            v-if="logsLoading && !logs"
            class="flex items-center gap-2 p-4 text-sm text-gray-500"
          >
            <Spinner class="h-4 w-4" />Loading logs…
          </div>
          <div
            v-else-if="logsError"
            role="alert"
            class="p-4 text-sm text-red-600 dark:text-red-400"
          >
            {{ logsError }}
            <button type="button" class="underline" @click="loadLogs">
              Try again
            </button>
          </div>
          <template
            v-else-if="
              logs?.available !== false && (logs?.stdout || logs?.stderr)
            "
          >
            <section v-if="logs.stdout">
              <h4
                class="border-b border-gray-100 px-4 py-2 text-[10px] font-medium uppercase text-gray-400 dark:border-gray-800"
              >
                stdout
              </h4>
              <pre
                class="max-h-80 overflow-auto whitespace-pre-wrap break-words px-4 py-3 font-mono text-xs leading-5 text-gray-700 dark:text-gray-300"
                >{{ stripAnsi(logs.stdout) }}</pre
              >
            </section>
            <section v-if="logs.stderr">
              <h4
                class="border-y border-gray-100 px-4 py-2 text-[10px] font-medium uppercase text-gray-400 dark:border-gray-800"
              >
                stderr
              </h4>
              <pre
                class="max-h-80 overflow-auto whitespace-pre-wrap break-words px-4 py-3 font-mono text-xs leading-5 text-gray-700 dark:text-gray-300"
                >{{ stripAnsi(logs.stderr) }}</pre
              >
            </section>
          </template>
          <p v-else class="p-4 text-sm text-gray-500 dark:text-gray-400">
            {{
              logs?.available === false
                ? 'Logs are no longer available.'
                : active
                ? 'No logs captured yet.'
                : 'No logs were captured.'
            }}
          </p>
          <div
            v-if="logs?.truncated || active"
            class="flex items-center justify-between px-4 pb-3 text-xs text-gray-500 dark:text-gray-400"
          >
            <span>{{
              logs?.truncated
                ? 'Logs truncated.'
                : 'Logs are fetched on request.'
            }}</span
            ><button
              v-if="active"
              type="button"
              :disabled="logsLoading"
              class="flex items-center gap-1"
              @click="loadLogs"
            >
              <Refresh class="h-3 w-3" />Refresh logs
            </button>
          </div>
        </div>
      </Tabs>
      <details
        v-if="!legacy"
        class="border-t border-gray-200 text-xs dark:border-gray-800"
      >
        <summary class="px-4 py-3 text-gray-500 dark:text-gray-400">
          Execution context
        </summary>
        <dl
          class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 px-4 pb-4 text-gray-500 dark:text-gray-400"
        >
          <template v-if="recordedInputs.length">
            <dt>Inputs</dt>
            <dd class="space-y-1">
              <div
                v-for="input in recordedInputs"
                :key="input.name"
                class="break-all font-mono text-[11px]"
              >
                <span class="text-gray-400">{{ input.name }}:</span>
                {{ input.value }}
              </div>
            </dd>
          </template>
          <dt>Requested</dt>
          <dd>{{ questAbsoluteTime(run.requestedAt) }}</dd>
          <dt>Finished</dt>
          <dd>{{ questAbsoluteTime(run.finishedAt) }}</dd>
          <dt v-if="run.actor">Actor</dt>
          <dd v-if="run.actor" class="break-all">
            {{
              typeof run.actor === 'object'
                ? run.actor.name || run.actor.email || run.actor.id
                : run.actor
            }}
          </dd>
          <dt>Runtime</dt>
          <dd class="break-all font-mono text-[10px]">
            {{ run.runtimeId || '—' }}
          </dd>
          <dt>Deployment</dt>
          <dd class="break-all font-mono text-[10px]">
            {{ run.deploymentId || '—' }}
          </dd>
          <dt v-if="run.signal">Signal</dt>
          <dd v-if="run.signal">{{ run.signal }}</dd>
        </dl>
      </details>
    </template>
  </section>
</template>
