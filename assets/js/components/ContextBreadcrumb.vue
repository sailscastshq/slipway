<script setup>
import { Link, usePage } from '@inertiajs/vue3'
import { computed, useId } from 'vue'
import Breadcrumb from '@/components/ui/breadcrumb/Breadcrumb.vue'
import ContextSwitcher from '@/components/ContextSwitcher.vue'
import Popover from '@/components/ui/popover/Popover.vue'

const props = defineProps({
  items: { type: Array, required: true },
  currentOnlyOnMobile: Boolean
})
const page = usePage()
const overflowId = `contexts-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
const path = computed(() => page.url.split(/[?#]/)[0])
function context(item, current = false) {
  const href = item.href || (current ? path.value : '')
  const match = href.match(
    /^\/projects\/([^/]+)(?:\/environments\/([^/]+)(?:\/apps\/([^/]+))?)?$/
  )
  if (!match) return null
  const source = path.value.match(
    /^\/projects\/[^/]+\/environments\/[^/]+\/apps\/[^/]+\/([^/]+)/
  )
  const environmentSection = path.value.match(
    /^\/projects\/[^/]+\/environments\/[^/]+\/(helm|dock)$/
  )
  const kind = match[3] ? 'app' : match[2] ? 'environment' : 'project'
  return {
    kind,
    href,
    scope:
      kind === 'app'
        ? 'Apps in this environment'
        : kind === 'environment'
        ? 'Environments in this project'
        : 'Projects in your team',
    params: {
      kind,
      projectSlug: match[1],
      ...(match[2] ? { environmentSlug: match[2] } : {}),
      ...(match[3]
        ? {
            appSlug: match[3],
            section: source?.[1] || environmentSection?.[1] || ''
          }
        : {})
    }
  }
}
const hidden = computed(() =>
  props.items.length > 3 ? props.items.slice(1, -2) : []
)
</script>

<template>
  <Breadcrumb :items="items" :current-only-on-mobile="currentOnlyOnMobile">
    <template #item="{ item, current }">
      <ContextSwitcher
        v-if="context(item, current)"
        :context="context(item, current)"
        :label="item.label"
        :current="current"
      />
      <span
        v-else-if="current"
        aria-current="page"
        data-slot="current"
        :title="item.title"
        class="min-h-11 max-w-64 inline-flex min-w-0 items-center px-1 font-medium text-gray-950 dark:text-white"
        ><span class="truncate">{{ item.label }}</span></span
      >
      <Link
        v-else-if="item.href"
        :href="item.href"
        data-slot="link"
        :title="item.title"
        class="min-h-11 max-w-48 inline-flex min-w-0 items-center rounded-sm px-1 text-gray-500 hover:text-gray-950 focus-visible:outline-2 dark:text-gray-400 dark:hover:text-white"
        ><span class="truncate">{{ item.label }}</span></Link
      >
      <span
        v-else
        class="min-h-11 inline-flex min-w-0 items-center px-1 text-gray-500"
        ><span class="truncate">{{ item.label }}</span></span
      >
    </template>
    <template #ellipsis>
      <button
        type="button"
        :popovertarget="overflowId"
        aria-label="Show project and environment breadcrumbs"
        class="min-h-11 min-w-6 rounded-sm text-gray-500 hover:text-gray-950 focus-visible:outline-2 dark:text-gray-400 dark:hover:text-white"
      >
        …
      </button>
      <Popover :id="overflowId" class="flex-col gap-1 p-2">
        <div
          v-for="item in hidden"
          :key="item.href"
          class="flex min-w-0 items-center"
        >
          <ContextSwitcher
            v-if="context(item)"
            :context="context(item)"
            :label="item.label"
          />
          <Link
            v-else
            :href="item.href"
            class="min-h-11 inline-flex items-center px-1 text-sm"
            >{{ item.label }}</Link
          >
        </div>
      </Popover>
    </template>
  </Breadcrumb>
</template>
