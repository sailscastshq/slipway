<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import {
  LOG_LEVELS,
  filterLogEntries,
  parseLogLine,
  serializeLogEntries
} from '@/lib/log-viewer.mjs'
import SlippyLoader from '@/components/SlippyLoader.vue'

const props = defineProps({
  lines: {
    type: Array,
    default: () => []
  },
  connected: Boolean,
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
const copied = ref(false)
const viewport = ref(null)

const entries = computed(() => props.lines.map(parseLogLine))
const visibleEntries = computed(() =>
  filterLogEntries(entries.value, { query: query.value, level: level.value })
)
const levelCounts = computed(() =>
  entries.value.reduce(
    (counts, entry) => {
      if (entry.level === 'continuation') counts.info += 1
      else counts[entry.level] += 1
      return counts
    },
    { error: 0, warning: 0, info: 0, debug: 0 }
  )
)
const heightClass = computed(() => (props.height === 'lg' ? 'h-96' : 'h-80'))

watch(
  () => props.lines.length,
  () => {
    if (following.value) scrollToLatest()
  }
)

onMounted(scrollToLatest)

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
  if (visibleEntries.value.length === 0) return
  await navigator.clipboard.writeText(serializeLogEntries(visibleEntries.value))
  copied.value = true
  setTimeout(() => {
    copied.value = false
  }, 1600)
}

function levelLabel(value) {
  return {
    error: 'Errors',
    warning: 'Warnings',
    info: 'Info',
    debug: 'Debug'
  }[value]
}

function entryLabel(entry) {
  if (entry.continuation && entry.level === 'continuation') return 'Trace'
  return {
    error: 'Error',
    warning: 'Warn',
    info: 'Info',
    debug: 'Debug',
    continuation: 'Trace'
  }[entry.level]
}

function levelButtonClass(value) {
  if (level.value !== value) {
    return 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
  }

  return {
    all: 'bg-white/10 text-white',
    error: 'bg-rose-500/15 text-rose-300',
    warning: 'bg-amber-500/15 text-amber-300',
    info: 'bg-sky-500/15 text-sky-300',
    debug: 'bg-zinc-500/20 text-zinc-300'
  }[value]
}

function badgeClass(entry) {
  return {
    error: 'bg-rose-500/15 text-rose-300 ring-rose-400/20',
    warning: 'bg-amber-500/15 text-amber-300 ring-amber-400/20',
    info: 'bg-sky-500/10 text-sky-300 ring-sky-400/15',
    debug: 'bg-zinc-500/15 text-zinc-400 ring-zinc-400/15',
    continuation: 'text-zinc-600'
  }[entry.level]
}

function rowClass(entry) {
  if (entry.level === 'error') return 'bg-rose-950/20 hover:bg-rose-950/30'
  if (entry.level === 'warning') return 'bg-amber-950/10 hover:bg-amber-950/20'
  return 'hover:bg-white/[0.035]'
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
      class="flex flex-wrap items-center gap-2 bg-zinc-900/80 px-3 py-2 shadow-[inset_0_-1px_0_rgba(255,255,255,0.06)]"
    >
      <label class="min-w-44 relative flex-1 sm:max-w-xs">
        <span class="sr-only">Search logs</span>
        <svg
          aria-hidden="true"
          class="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="m21 21-4.35-4.35m2.35-5.65a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z"
          />
        </svg>
        <input
          v-model="query"
          data-test="log-search"
          type="search"
          autocomplete="off"
          placeholder="Search logs"
          class="h-8 w-full border-0 border-b border-dashed border-zinc-700 bg-transparent pl-8 pr-2 font-sans text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-sky-400 focus:ring-0"
        />
      </label>

      <div class="flex items-center gap-0.5" aria-label="Filter by severity">
        <button
          v-for="value in ['all', ...LOG_LEVELS]"
          :key="value"
          type="button"
          :aria-pressed="level === value"
          :class="[
            'rounded-md px-2 py-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70',
            levelButtonClass(value)
          ]"
          @click="level = value"
        >
          {{ value === 'all' ? 'All' : levelLabel(value) }}
          <span class="ml-0.5 tabular-nums opacity-60">
            {{ value === 'all' ? entries.length : levelCounts[value] }}
          </span>
        </button>
      </div>

      <div class="ml-auto flex items-center gap-1">
        <button
          type="button"
          :aria-pressed="following"
          :class="[
            'rounded-md px-2 py-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70',
            following
              ? 'bg-emerald-500/10 text-emerald-300'
              : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-300'
          ]"
          @click="toggleFollowing"
        >
          <span
            :class="[
              'mr-1 inline-block h-1.5 w-1.5 rounded-full',
              following ? 'bg-emerald-400' : 'bg-zinc-600'
            ]"
          ></span>
          {{ following ? 'Following' : 'Paused' }}
        </button>
        <button
          type="button"
          :aria-pressed="wrap"
          class="rounded-md px-2 py-1 text-[11px] font-medium text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70"
          @click="wrap = !wrap"
        >
          {{ wrap ? 'Wrap on' : 'Wrap off' }}
        </button>
        <button
          type="button"
          :disabled="visibleEntries.length === 0"
          class="rounded-md px-2 py-1 text-[11px] font-medium text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70 disabled:cursor-not-allowed disabled:opacity-40"
          @click="copyVisibleLogs"
        >
          {{ copied ? 'Copied' : 'Copy' }}
        </button>
      </div>
    </div>

    <div
      ref="viewport"
      data-test="log-viewport"
      :class="[heightClass, 'overflow-auto overscroll-contain']"
      aria-live="off"
      @scroll="handleScroll"
    >
      <div
        v-if="error"
        role="status"
        class="flex h-full items-center justify-center px-6 text-center font-sans text-sm text-rose-300"
      >
        {{ error }}
      </div>
      <div
        v-else-if="inactiveMessage"
        class="flex h-full items-center justify-center px-6 text-center font-sans text-sm text-zinc-500"
      >
        {{ inactiveMessage }}
      </div>
      <div
        v-else-if="!connected && entries.length === 0"
        class="flex h-full items-center justify-center font-sans text-sm text-zinc-500"
      >
        <SlippyLoader size="h-4 w-4" class="mr-2" />
        Connecting to logs…
      </div>
      <div
        v-else-if="entries.length === 0"
        class="flex h-full items-center justify-center font-sans text-sm text-zinc-500"
      >
        Waiting for output…
      </div>
      <div
        v-else-if="visibleEntries.length === 0"
        class="flex h-full items-center justify-center px-6 text-center font-sans text-sm text-zinc-500"
      >
        No logs match this filter.
      </div>
      <ol v-else class="min-w-full py-1 font-mono text-xs leading-5">
        <li
          v-for="(entry, index) in visibleEntries"
          :key="`${index}-${entry.raw}`"
          :class="[
            'grid min-w-max grid-cols-[6.75rem_4.25rem_minmax(28rem,1fr)] items-start gap-2 px-3 py-0.5 transition-colors',
            rowClass(entry)
          ]"
        >
          <time
            :datetime="entry.timestamp || undefined"
            :title="entry.timestamp || 'Timestamp unavailable'"
            class="select-none text-right tabular-nums text-zinc-600"
          >
            {{ entry.time || '—' }}
          </time>
          <span
            :class="[
              'min-w-11 mt-0.5 inline-flex h-4 w-fit items-center justify-center rounded px-1.5 font-sans text-[9px] font-semibold uppercase tracking-wider ring-1 ring-inset',
              badgeClass(entry)
            ]"
          >
            {{ entryLabel(entry) }}
          </span>
          <code
            :class="[
              'block min-w-0 bg-transparent p-0 font-mono text-[12px] text-zinc-300',
              wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'
            ]"
            ><span
              v-for="(segment, segmentIndex) in entry.segments"
              :key="segmentIndex"
              :class="segmentClass(segment.type)"
              >{{ segment.text }}</span
            ></code
          >
        </li>
      </ol>
    </div>
  </section>
</template>
