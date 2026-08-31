<script setup>
import ShieldCheck from '@/components/ui/icons/ShieldCheck.vue'
import Search from '@/components/ui/icons/Search.vue'
import Heart from '@/components/ui/icons/Heart.vue'
import DocumentText from '@/components/ui/icons/DocumentText.vue'
import Database from '@/components/ui/icons/Database.vue'
import ChevronDown from '@/components/ui/icons/ChevronDown.vue'
import ChartBar from '@/components/ui/icons/ChartBar.vue'
import BookOpen from '@/components/ui/icons/BookOpen.vue'
import Input from '@/components/ui/input/Input.vue'
import { Link, usePage } from '@inertiajs/vue3'
import { computed, ref } from 'vue'
import Menu from '@/components/ui/menu/Menu.vue'

const props = defineProps({
  app: Object,
  basePath: String,
  workspace: Object
})

defineEmits(['navigate'])

const page = usePage()
const search = ref('')
const normalizedBasePath = computed(() => props.basePath || '/bridge')
const currentUrl = computed(() => page.url || normalizedBasePath.value)
const currentPath = computed(() => currentUrl.value.split('?')[0])
const selectedDashboard = computed(() =>
  new URLSearchParams(currentUrl.value.split('?')[1] || '').get('dashboard')
)
const visibleDashboards = computed(() =>
  (props.workspace?.dashboards || []).filter((dashboard) => !dashboard.default)
)
const actor = computed(() => props.workspace?.actor || {})
const actorName = computed(
  () => actor.value.fullName || actor.value.email || 'Bridge user'
)
const actorInitials = computed(() => {
  const source = actor.value.fullName || actor.value.email || 'B'
  return source
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
})
const roleLabel = computed(() => {
  const role = actor.value.role || 'viewer'
  return role.charAt(0).toUpperCase() + role.slice(1)
})
const appInitial = computed(
  () => props.app?.name?.trim().charAt(0).toUpperCase() || 'A'
)
const resources = computed(() => props.workspace?.resources || [])
const showSearch = computed(() => resources.value.length > 8)
const filteredResources = computed(() => {
  const query = search.value.trim().toLowerCase()
  if (!query) return resources.value
  return resources.value.filter((resource) =>
    [resource.label, resource.singularLabel, resource.identity]
      .filter(Boolean)
      .some((value) => value.toLowerCase().includes(query))
  )
})

function resourceUrl(identity) {
  return `${normalizedBasePath.value}/${identity}`
}

function isResourceActive(identity) {
  const path = resourceUrl(identity)
  return currentPath.value === path || currentPath.value.startsWith(`${path}/`)
}
</script>

<template>
  <div
    class="flex h-full flex-col border-r border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-950"
    data-test="bridge-workspace-sidebar"
  >
    <div class="flex items-center justify-between px-3 py-4">
      <div
        class="flex w-full min-w-0 items-center space-x-2 rounded-md px-2 py-1.5 text-sm text-gray-700 dark:text-gray-200"
      >
        <span
          class="bg-brand flex h-6 w-6 shrink-0 items-center justify-center rounded text-xs font-medium text-white"
          aria-hidden="true"
        >
          {{ appInitial }}
        </span>
        <div class="min-w-0 flex-1">
          <p class="truncate font-medium" :title="app?.name || 'App'">
            {{ app?.name || 'App' }}
          </p>
          <p class="truncate text-[11px] text-gray-400 dark:text-gray-500">
            Bridge
          </p>
        </div>
      </div>
    </div>

    <nav
      class="min-h-0 flex-1 overflow-y-auto px-3 py-4"
      aria-label="Bridge workspace"
    >
      <ul class="space-y-1">
        <li>
          <Link
            :href="normalizedBasePath"
            :class="[
              'flex items-center space-x-3 rounded-md px-2 py-2 text-sm transition-colors',
              currentPath === normalizedBasePath && !selectedDashboard
                ? 'font-medium text-gray-900 dark:text-white'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            ]"
            @click="$emit('navigate')"
          >
            <DocumentText class="h-4 w-4 shrink-0" />
            <span>Overview</span>
          </Link>
        </li>
        <li v-for="dashboard in visibleDashboards" :key="dashboard.id">
          <Link
            :href="`${normalizedBasePath}?dashboard=${encodeURIComponent(
              dashboard.id
            )}`"
            :class="[
              'flex items-center space-x-3 rounded-md px-2 py-2 text-sm transition-colors',
              selectedDashboard === dashboard.id
                ? 'font-medium text-gray-900 dark:text-white'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            ]"
            @click="$emit('navigate')"
          >
            <ChartBar class="h-4 w-4 shrink-0" />
            <span class="truncate">{{ dashboard.label }}</span>
          </Link>
        </li>

        <li v-if="showSearch" class="px-2 pb-2">
          <div class="relative">
            <Search
              class="pointer-events-none absolute left-0 top-2 h-3.5 w-3.5 text-gray-400"
            />
            <Input
              v-model="search"
              type="search"
              aria-label="Search Bridge resources"
              placeholder="Find a resource"
              class="focus:border-brand w-full border-b border-dashed border-gray-300 bg-transparent py-1.5 pl-5 pr-1 text-xs text-gray-800 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-gray-200 dark:placeholder-gray-600"
            />
          </div>
        </li>
        <li v-for="resource in filteredResources" :key="resource.identity">
          <Link
            :href="resourceUrl(resource.identity)"
            :data-resource="resource.identity"
            data-test="bridge-resource-link"
            :class="[
              'flex items-center space-x-3 rounded-md px-2 py-2 text-sm transition-colors',
              isResourceActive(resource.identity)
                ? 'font-medium text-gray-900 dark:text-white'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            ]"
            @click="$emit('navigate')"
          >
            <Database class="h-4 w-4 shrink-0" />
            <span class="truncate">{{ resource.label }}</span>
          </Link>
        </li>
        <li
          v-if="resources.length && filteredResources.length === 0"
          class="px-2 py-4 text-xs text-gray-400 dark:text-gray-500"
        >
          No matching resources
        </li>
      </ul>
    </nav>

    <div class="relative px-3 py-3">
      <Menu
        id="bridge-actor-menu"
        aria-label="Bridge account actions"
        placement="top-start"
        :offset="4"
        class="w-52 rounded-lg border-gray-200 bg-white px-0 py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
        data-test="bridge-actor-menu"
      >
        <div class="contents">
          <div
            class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 dark:text-gray-300"
          >
            <ShieldCheck class="h-4 w-4 shrink-0 text-gray-400" />
            <span class="min-w-0 flex-1 truncate" data-test="bridge-actor-role">
              {{ roleLabel }}
            </span>
            <span
              class="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-400 dark:bg-gray-800 dark:text-gray-500"
            >
              Role
            </span>
          </div>
          <div
            role="separator"
            class="my-1 border-t border-gray-100 dark:border-gray-800"
          ></div>
          <a
            href="https://docs.sailscasts.com/slipway/bridge"
            target="_blank"
            rel="noreferrer"
            class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <BookOpen class="h-4 w-4 text-gray-400" />
            <span>Docs</span>
          </a>
          <a
            href="https://github.com/sponsors/DominusKelvin"
            target="_blank"
            rel="noreferrer"
            class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <Heart class="h-4 w-4 text-pink-400" />
            <span>Sponsor Slipway</span>
          </a>
        </div>
      </Menu>

      <button
        type="button"
        popovertarget="bridge-actor-menu"
        class="flex w-full items-center space-x-3 rounded-md px-2 py-2 text-sm text-gray-500 transition-colors hover:bg-gray-200/50 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800/50 dark:hover:text-gray-200"
        data-test="bridge-actor-menu-button"
      >
        <span
          class="bg-brand flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium text-white"
        >
          {{ actorInitials }}
        </span>
        <span
          class="min-w-0 flex-1 truncate text-left"
          :title="actor.email || actorName"
        >
          {{ actor.email || actorName }}
        </span>
        <ChevronDown class="h-4 w-4 shrink-0 text-gray-400" stroke-width="2" />
      </button>
    </div>
  </div>
</template>
