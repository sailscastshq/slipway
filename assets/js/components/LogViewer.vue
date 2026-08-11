<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  LOG_LEVELS,
  appendLogEntry,
  buildLogEvents,
  filterLogEvents,
  parseLogLine,
  serializeLogEvents
} from '@/lib/log-viewer.mjs'
import Spinner from '@/components/SlipwaySpinner.vue'

const props = defineProps({
  lines: {
    type: Array,
    default: () => []
  },
  connected: Boolean,
  complete: Boolean,
  error: {
    type: String,
    default: ''
  },
  inactiveMessage: {
    type: String,
    default: ''
  },
  height: {
    type: String,
    default: 'md'
  }
})

const query = ref('')
const level = ref('all')
const wrap = ref(true)
const following = ref(true)
const copyState = ref('idle')
const viewport = ref(null)
const events = ref([])

let processedLineCount = 0
let firstProcessedLine
let lastProcessedLine
let nextEventKey = 0
let copyResetTimer

const visibleEvents = computed(() =>
  filterLogEvents(events.value, { query: query.value, level: level.value })
)
const levelCounts = computed(() => {
  const counts = { error: 0, warning: 0, info: 0, debug: 0 }
  for (const event of events.value) counts[event.level] += 1
  return counts
})
const heightClass = computed(() => (props.height === 'lg' ? 'h-96' : 'h-80'))
const connectionState = computed(() => {
  if (props.inactiveMessage) return 'inactive'
  if (props.error) return 'reconnecting'
  if (props.connected) return 'live'
  if (props.complete) return 'complete'
  return 'connecting'
})
const connectionLabel = computed(
  () =>
    ({
      inactive: 'Inactive',
      reconnecting: 'Reconnecting',
      live: 'Live',
      complete: 'Complete',
      connecting: 'Connecting'
    }[connectionState.value])
)

watch(
  () => [props.lines.length, props.lines[0], props.lines.at(-1)],
  syncEvents,
  { immediate: true }
)

watch(
  () => props.lines.length,
  () => {
    if (following.value) scrollToLatest()
  }
)

onMounted(scrollToLatest)
onBeforeUnmount(() => clearTimeout(copyResetTimer))

function syncEvents() {
  const source = props.lines
  const sourceChanged =
    source.length < processedLineCount ||
    (processedLineCount > 0 && source[0] !== firstProcessedLine) ||
    (source.length === processedLineCount &&
      source.at(-1) !== lastProcessedLine)

  if (sourceChanged) {
    events.value = buildLogEvents(source)
    for (const event of events.value) event.key = nextEventKey++
    processedLineCount = source.length
  } else if (source.length > processedLineCount) {
    const nextEvents = events.value
    for (let index = processedLineCount; index < source.length; index += 1) {
      const before = nextEvents.length
      const event = appendLogEntry(nextEvents, parseLogLine(source[index]))
      if (nextEvents.length > before) event.key = nextEventKey++
    }
    events.value = [...nextEvents]
    processedLineCount = source.length
  }

  firstProcessedLine = source[0]
  lastProcessedLine = source.at(-1)
}

function scrollToLatest() {
  nextTick(() => {
    if (viewport.value) viewport.value.scrollTop = viewport.value.scrollHeight
  })
}

function handleScroll() {
  if (!viewport.value) return
  following.value =
    viewport.value.scrollHeight -
      viewport.value.scrollTop -
      viewport.value.clientHeight <
    40
}

function toggleFollowing() {
  following.value = !following.value
  if (following.value) scrollToLatest()
}

async function copyVisibleLogs() {
  if (visibleEvents.value.length === 0) return

  clearTimeout(copyResetTimer)
  try {
    await navigator.clipboard.writeText(serializeLogEvents(visibleEvents.value))
    copyState.value = 'copied'
  } catch {
    copyState.value = 'failed'
  }

  copyResetTimer = setTimeout(() => {
    copyState.value = 'idle'
  }, 1800)
}

function levelLabel(value) {
  return {
    error: 'Errors',
    warning: 'Warnings',
    info: 'Info',
    debug: 'Debug'
  }[value]
}

function badgeClass(event) {
  return {
    error: 'text-rose-300',
    warning: 'text-amber-300',
    info: 'text-sky-300',
    debug: 'text-zinc-500'
  }[event.level]
}

function eventClass(event) {
  return {
    error: 'border-l-rose-500/70 bg-rose-950/20 hover:bg-rose-950/30',
    warning: 'border-l-amber-400/60 bg-amber-950/10 hover:bg-amber-950/20',
    info: 'border-l-transparent hover:bg-white/[0.035]',
    debug: 'border-l-transparent hover:bg-white/[0.025]'
  }[event.level]
}

function segmentClass(type) {
  return {
    error: 'font-semibold text-rose-300',
    warning: 'font-medium text-amber-300',
    info: 'text-sky-300',
    debug: 'text-zinc-500',
    method: 'font-semibold text-cyan-300',
    url: 'text-violet-300 underline decoration-violet-400/40 underline-offset-2',
    path: 'text-cyan-300',
    tag: 'text-zinc-500',
    'status-error': 'rounded bg-rose-500/15 px-1 font-semibold text-rose-300',
    'status-warning':
      'rounded bg-amber-500/15 px-1 font-semibold text-amber-300',
    'status-redirect': 'text-sky-300',
    'status-success': 'text-emerald-300'
  }[type]
}
</script>

<template>
  <section
    data-test="log-viewer"
    class="overflow-hidden bg-zinc-950 text-zinc-200"
    aria-label="Live logs"
  >
    <div
      class="flex flex-wrap items-center gap-x-3 gap-y-2 border-y border-white/[0.07] bg-zinc-900/80 px-3 py-2 sm:flex-nowrap"
    >
      <div
        class="min-w-24 order-1 flex items-center gap-2 font-sans text-xs text-zinc-400"
        role="status"
        aria-live="polite"
      >
        <span
          :class="[
            'h-1.5 w-1.5 rounded-full',
            connectionState === 'live' && 'bg-emerald-400',
            connectionState === 'complete' && 'bg-zinc-500',
            connectionState === 'connecting' &&
              'animate-pulse bg-amber-300 motion-reduce:animate-none',
            connectionState === 'reconnecting' &&
              'animate-pulse bg-rose-400 motion-reduce:animate-none',
            connectionState === 'inactive' && 'bg-zinc-600'
          ]"
        ></span>
        <span>{{ connectionLabel }}</span>
      </div>

      <label
        class="sm:min-w-40 relative order-3 min-w-full flex-1 sm:order-2 sm:max-w-sm"
      >
        <span class="sr-only">Search logs</span>
        <svg
          aria-hidden="true"
          class="pointer-events-none absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.8"
            d="m21 21-4.35-4.35m2.35-5.65a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z"
          />
        </svg>
        <input
          v-model="query"
          data-test="log-search"
          type="search"
          autocomplete="off"
          placeholder="Find in logs…"
          class="h-9 w-full border-0 border-b border-dashed border-zinc-700 bg-transparent pl-6 pr-2 font-sans text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-sky-400 focus:ring-0"
        />
      </label>

      <div class="order-2 ml-auto flex items-center gap-1 sm:order-3">
        <label class="relative">
          <span class="sr-only">Filter logs by severity</span>
          <select
            v-model="level"
            data-test="log-level-filter"
            class="h-10 appearance-none border-0 border-b border-dashed border-zinc-700 bg-transparent py-0 pl-2 pr-7 font-sans text-xs text-zinc-300 outline-none focus:border-sky-400 focus:ring-0"
          >
            <option value="all">All · {{ events.length }}</option>
            <option v-for="value in LOG_LEVELS" :key="value" :value="value">
              {{ levelLabel(value) }} · {{ levelCounts[value] }}
            </option>
          </select>
          <svg
            aria-hidden="true"
            class="pointer-events-none absolute right-1.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="m7 10 5 5 5-5"
            />
          </svg>
        </label>

        <button
          type="button"
          :aria-label="
            following ? 'Pause automatic scrolling' : 'Follow latest log'
          "
          :aria-pressed="following"
          :title="following ? 'Following latest log' : 'Follow latest log'"
          :class="[
            'min-w-10 inline-flex h-10 items-center justify-center gap-1.5 rounded-md px-2 font-sans text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70',
            following
              ? 'bg-white/[0.07] text-zinc-200'
              : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-300'
          ]"
          @click="toggleFollowing"
        >
          <svg
            aria-hidden="true"
            class="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.8"
              d="m7 10 5 5 5-5M12 15V4M5 20h14"
            />
          </svg>
          <span class="hidden lg:inline">{{
            following ? 'Following' : 'Follow'
          }}</span>
        </button>

        <button
          type="button"
          :aria-label="
            wrap ? 'Turn line wrapping off' : 'Turn line wrapping on'
          "
          :aria-pressed="wrap"
          :title="wrap ? 'Line wrapping on' : 'Line wrapping off'"
          :class="[
            'min-w-10 inline-flex h-10 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70',
            wrap && 'bg-white/[0.07] text-zinc-200'
          ]"
          @click="wrap = !wrap"
        >
          <svg
            aria-hidden="true"
            class="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.8"
              d="M4 7h12a4 4 0 0 1 0 8H9m0 0 3-3m-3 3 3 3M4 12h7M4 17h2"
            />
          </svg>
        </button>

        <button
          type="button"
          :disabled="visibleEvents.length === 0"
          :aria-label="
            copyState === 'copied' ? 'Logs copied' : 'Copy visible logs'
          "
          :title="
            copyState === 'failed' ? 'Could not copy logs' : 'Copy visible logs'
          "
          class="min-w-10 inline-flex h-10 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70 disabled:cursor-not-allowed disabled:opacity-30"
          @click="copyVisibleLogs"
        >
          <svg
            v-if="copyState === 'copied'"
            aria-hidden="true"
            class="h-4 w-4 text-emerald-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="m5 13 4 4L19 7"
            />
          </svg>
          <svg
            v-else
            aria-hidden="true"
            class="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.8"
              d="M8 8V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3m-7-6h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z"
            />
          </svg>
        </button>
      </div>
    </div>

    <div
      v-if="error && events.length > 0"
      class="flex items-center gap-2 border-b border-amber-400/10 bg-amber-400/[0.06] px-3 py-2 font-sans text-xs text-amber-200/80"
      role="status"
    >
      <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300"></span>
      Kept the logs already received. Reconnecting to live output…
    </div>

    <div
      ref="viewport"
      data-test="log-viewport"
      :class="[heightClass, 'overflow-auto overscroll-contain']"
      aria-live="off"
      @scroll="handleScroll"
    >
      <div
        v-if="inactiveMessage && events.length === 0"
        class="flex h-full items-center justify-center px-6 text-center font-sans text-sm text-zinc-500"
      >
        {{ inactiveMessage }}
      </div>
      <div
        v-else-if="error && events.length === 0"
        role="status"
        class="flex h-full items-center justify-center px-6 text-center font-sans text-sm text-rose-300"
      >
        {{ error }}
      </div>
      <div
        v-else-if="!connected && events.length === 0"
        class="flex h-full items-center justify-center font-sans text-sm text-zinc-500"
      >
        <Spinner class="mr-2 h-4 w-4" />
        Connecting to logs…
      </div>
      <div
        v-else-if="events.length === 0"
        class="flex h-full items-center justify-center font-sans text-sm text-zinc-500"
      >
        Waiting for output…
      </div>
      <div
        v-else-if="visibleEvents.length === 0"
        class="flex h-full items-center justify-center px-6 text-center font-sans text-sm text-zinc-500"
      >
        No logs match this search and severity.
      </div>
      <ol v-else class="min-w-full py-1 font-mono text-xs leading-5">
        <li
          v-for="event in visibleEvents"
          :key="event.key"
          data-test="log-event"
          :data-level="event.level"
          :class="[
            'border-l-2 px-3 py-2 transition-colors sm:grid sm:grid-cols-[6.75rem_4rem_minmax(0,1fr)] sm:items-start sm:gap-3 sm:py-1.5',
            eventClass(event)
          ]"
        >
          <div class="mb-1.5 flex items-center gap-2 sm:contents">
            <time
              :datetime="event.timestamp || undefined"
              :title="event.timestamp || 'Timestamp unavailable'"
              class="select-none tabular-nums text-zinc-600 sm:text-right"
            >
              {{ event.time || '—' }}
            </time>
            <span
              :class="[
                'font-sans text-[9px] font-semibold uppercase tracking-[0.12em]',
                badgeClass(event)
              ]"
            >
              {{ event.level === 'warning' ? 'Warn' : event.level }}
            </span>
          </div>
          <div class="min-w-0">
            <code
              v-for="(entry, entryIndex) in event.entries"
              :key="entryIndex"
              :class="[
                'min-h-5 block bg-transparent p-0 font-mono text-[12px] text-zinc-300',
                entryIndex > 0 && 'text-zinc-500',
                wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'
              ]"
              ><span
                v-for="(segment, segmentIndex) in entry.segments"
                :key="segmentIndex"
                :class="segmentClass(segment.type)"
                >{{ segment.text }}</span
              ></code
            >
          </div>
        </li>
      </ol>
    </div>
  </section>
</template>
