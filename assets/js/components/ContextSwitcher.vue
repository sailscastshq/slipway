<script setup>
import { Link } from '@inertiajs/vue3'
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import Popover from '@/components/ui/popover/Popover.vue'
import ChevronDown from '@/components/ui/icons/ChevronDown.vue'
import Check from '@/components/ui/icons/Check.vue'

const props = defineProps({
  context: { type: Object, required: true },
  label: String,
  current: Boolean
})
const id = `context-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
const open = ref(false)
const panel = ref()
const searchInput = ref()
const query = ref('')
const data = ref(null)
const error = ref(false)
const loading = ref(false)
let request
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
    if (request === controller) loading.value = false
  }
}
watch(open, async (value) => {
  if (value) {
    query.value = ''
    load()
    await nextTick()
    searchInput.value?.focus()
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
  if (item.current) event.preventDefault()
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
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + links.length) %
        links.length
  links[next].focus()
}
</script>

<template>
  <button
    type="button"
    :popovertarget="id"
    :aria-label="`Switch ${context.kind}: ${label}`"
    :aria-current="current ? 'page' : undefined"
    :title="label"
    class="min-h-11 max-w-48 inline-flex min-w-0 items-center gap-1 rounded-sm px-1 text-gray-500 transition-colors hover:text-gray-950 focus-visible:outline-2 focus-visible:outline-offset-2 dark:text-gray-400 dark:hover:text-white"
    :class="current ? 'font-medium text-gray-950 dark:text-white' : ''"
  >
    <span class="truncate">{{ label }}</span
    ><ChevronDown class="size-3 shrink-0 opacity-60" />
  </button>
  <Popover
    :id="id"
    ref="panel"
    v-model:open="open"
    class="w-80 rounded-lg border-gray-200 p-1.5 shadow-xl dark:border-gray-800 dark:bg-gray-950"
    @keydown="move"
  >
    <div class="px-2.5 pb-2 pt-2 text-xs text-gray-500 dark:text-gray-400">
      {{ data?.scope || context.scope }}
    </div>
    <input
      ref="searchInput"
      v-model="query"
      :aria-label="`Search ${context.kind}s`"
      placeholder="Search…"
      class="min-h-11 mb-1 w-full border-b border-dashed border-gray-200 bg-transparent px-2.5 text-sm outline-none focus:border-gray-500 dark:border-gray-800 dark:focus:border-gray-400"
    />
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
          class="min-h-11 focus-visible:outline-inset flex items-center justify-between gap-3 rounded-md px-2.5 py-2 text-sm text-gray-800 hover:bg-gray-100 focus-visible:bg-gray-100 focus-visible:outline-2 dark:text-gray-200 dark:hover:bg-gray-900 dark:focus-visible:bg-gray-900"
          @click="select($event, item)"
        >
          <span class="truncate">{{ item.name }}</span
          ><Check v-if="item.current" class="size-4 text-brand shrink-0" />
        </Link>
        <p
          v-if="!filtered.length"
          role="status"
          class="px-2.5 py-5 text-sm text-gray-500"
        >
          No matches.
        </p>
      </div>
      <p class="px-2.5 py-2 text-xs text-gray-500 dark:text-gray-400">
        Opens {{ data.destination }}.
      </p>
    </template>
    <Link
      :href="context.href"
      class="min-h-11 mt-1 flex items-center border-t border-gray-200 px-2.5 text-sm text-gray-500 hover:text-gray-950 focus-visible:outline-2 dark:border-gray-800 dark:text-gray-400 dark:hover:text-white"
      @click="panel.close()"
      >View {{ context.kind }} overview</Link
    >
  </Popover>
</template>
