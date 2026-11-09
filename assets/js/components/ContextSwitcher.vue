<script setup>
import { Link, usePage } from '@inertiajs/vue3'
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import Popover from '@/components/ui/popover/Popover.vue'
import ChevronDown from '@/components/ui/icons/ChevronDown.vue'
import Check from '@/components/ui/icons/Check.vue'
import Search from '@/components/ui/icons/Search.vue'
import ArrowRight from '@/components/ui/icons/ArrowRight.vue'

const props = defineProps({
  context: { type: Object, required: true },
  label: String,
  current: Boolean
})
const page = usePage()
const id = `context-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
const open = ref(false)
const panel = ref()
const anchor = ref()
const searchInput = ref()
const query = ref('')
const data = ref(null)
const error = ref(false)
const loading = ref(false)
let request
const showSearch = computed(() => (data.value?.items.length || 0) > 5)
const filtered = computed(() =>
  (data.value?.items || []).filter((item) =>
    item.name.toLowerCase().includes(query.value.trim().toLowerCase())
  )
)
async function load() {
  request?.abort()
  const controller = new AbortController()
  request = controller
  loading.value = true
  error.value = false
  data.value = null
  try {
    const params = new URLSearchParams(props.context.params)
    const response = await fetch(`/api/v1/navigation/contexts?${params}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    })
    if (!response.ok) throw new Error('unavailable')
    const result = await response.json()
    if (!controller.signal.aborted) data.value = result
  } catch (cause) {
    if (cause.name !== 'AbortError') error.value = true
  } finally {
    if (request === controller) {
      loading.value = false
      await nextTick()
      if (open.value && !controller.signal.aborted) {
        const target =
          searchInput.value ||
          panel.value?.content.querySelector(
            '[data-context-choice][aria-current]'
          ) ||
          panel.value?.content.querySelector('[data-context-choice], button')
        target?.focus({ preventScroll: true })
      }
    }
  }
}
watch(open, (value) => {
  if (value) {
    query.value = ''
    load()
  } else request?.abort()
})
watch(
  () => props.context,
  () => {
    open.value = false
    request?.abort()
    data.value = null
  }
)
onBeforeUnmount(() => request?.abort())
function select(event, item) {
  if (item.current && item.href === page.url.split(/[?#]/)[0])
    event.preventDefault()
  panel.value?.close()
}
function move(event) {
  if (event.target.tagName === 'INPUT' && ['Home', 'End'].includes(event.key))
    return
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  const links = [
    ...panel.value.content.querySelectorAll('[data-context-choice]')
  ]
  if (!links.length) return
  event.preventDefault()
  const index = links.indexOf(document.activeElement)
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
      ? links.length - 1
      : index === -1
      ? event.key === 'ArrowDown'
        ? 0
        : links.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + links.length) %
        links.length
  links[next].focus()
}
</script>

<template>
  <span ref="anchor" class="max-w-48 inline-flex min-w-0 items-center">
    <Link
      :href="context.href"
      :aria-label="`Open ${context.kind}: ${label}`"
      :aria-current="current ? 'page' : undefined"
      :title="label"
      class="min-h-11 inline-flex min-w-0 items-center rounded-sm px-1 text-gray-500 transition-colors hover:text-gray-950 hover:underline hover:underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 dark:text-gray-400 dark:hover:text-white"
      :class="current ? 'font-medium text-gray-950 dark:text-white' : ''"
      @click="panel?.close({ restoreFocus: false })"
    >
      <span class="truncate">{{ label }}</span>
    </Link>
    <button
      type="button"
      :popovertarget="id"
      :aria-label="`Switch ${context.kind}: ${label}`"
      class="min-h-11 min-w-6 inline-flex shrink-0 items-center justify-center rounded-sm text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-950 focus-visible:outline-2 focus-visible:outline-offset-2 dark:hover:bg-gray-900 dark:hover:text-white"
    >
      <ChevronDown class="size-3" />
    </button>
  </span>
  <Popover
    :id="id"
    ref="panel"
    :anchor="anchor"
    v-model:open="open"
    role="group"
    :aria-label="data?.scope || context.scope"
    class="w-56 rounded-lg border-gray-200 p-1 shadow-lg dark:border-gray-800 dark:bg-gray-950"
    @keydown="move"
  >
    <div
      v-if="showSearch"
      class="mb-1 flex items-center gap-2 border-b border-gray-100 px-2 focus-within:border-gray-400 dark:border-gray-800 dark:focus-within:border-gray-500"
    >
      <Search class="size-3.5 shrink-0 text-gray-400" />
      <input
        ref="searchInput"
        v-model="query"
        :aria-label="`Search ${context.kind}s`"
        placeholder="Search…"
        class="min-h-9 min-w-0 flex-1 bg-transparent text-sm outline-none"
      />
    </div>
    <div v-if="loading" role="status" class="px-2.5 py-5 text-sm text-gray-500">
      Loading…
    </div>
    <div v-else-if="error" role="alert" class="p-2.5 text-sm">
      <p>This context is unavailable. Your access may have changed.</p>
      <button type="button" class="min-h-11 mt-2 underline" @click="load">
        Try again
      </button>
    </div>
    <template v-else-if="data">
      <div class="max-h-64 overflow-y-auto">
        <Link
          v-for="item in filtered"
          :key="item.slug"
          :href="item.href"
          data-context-choice
          :aria-current="item.current ? 'true' : undefined"
          class="min-h-9 focus-visible:outline-inset pointer-coarse:min-h-11 flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm text-gray-800 hover:bg-gray-100 focus-visible:bg-gray-100 focus-visible:outline-2 dark:text-gray-200 dark:hover:bg-gray-900 dark:focus-visible:bg-gray-900"
          @click="select($event, item)"
        >
          <span class="truncate">{{ item.name }}</span
          ><Check v-if="item.current" class="size-4 text-brand shrink-0" />
          <ArrowRight v-else class="size-3.5 shrink-0 text-gray-400" />
        </Link>
        <p
          v-if="!filtered.length"
          role="status"
          class="px-2.5 py-5 text-sm text-gray-500"
        >
          No matches.
        </p>
      </div>
    </template>
  </Popover>
</template>
