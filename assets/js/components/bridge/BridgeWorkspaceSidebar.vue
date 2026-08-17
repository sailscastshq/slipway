<script setup>
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
  <aside
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
            <svg
              class="h-4 w-4 shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.5"
                d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-13Z M8 9h8M8 13h5"
              />
            </svg>
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
            <svg
              class="h-4 w-4 shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.5"
                d="M4 19V9m5 10V5m5 14v-7m5 7V8"
              />
            </svg>
            <span class="truncate">{{ dashboard.label }}</span>
          </Link>
        </li>

        <li v-if="showSearch" class="px-2 pb-2">
          <div class="relative">
            <svg
              class="pointer-events-none absolute left-0 top-2 h-3.5 w-3.5 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.5"
                d="m21 21-4.35-4.35m1.35-5.65a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z"
              />
            </svg>
            <input
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
            <svg
              class="h-4 w-4 shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.5"
                d="M5 7.5C5 5.567 8.134 4 12 4s7 1.567 7 3.5S15.866 11 12 11 5 9.433 5 7.5Zm0 0v4c0 1.933 3.134 3.5 7 3.5s7-1.567 7-3.5v-4m-14 4v4C5 17.433 8.134 19 12 19s7-1.567 7-3.5v-4"
              />
            </svg>
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
            <svg
              class="h-4 w-4 shrink-0 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.5"
                d="M9 12.75 11.25 15 15 9.75m6-1.5c0 5.25-3.44 9.95-9 11.25-5.56-1.3-9-6-9-11.25V5.8L12 2.25l9 3.55v2.45Z"
              />
            </svg>
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
            <svg
              class="h-4 w-4 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.5"
                d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
              />
            </svg>
            <span>Docs</span>
          </a>
          <a
            href="https://github.com/sponsors/DominusKelvin"
            target="_blank"
            rel="noreferrer"
            class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <svg
              class="h-4 w-4 text-pink-400"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
              />
            </svg>
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
        <svg
          class="h-4 w-4 shrink-0 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="m19 9-7 7-7-7"
          />
        </svg>
      </button>
    </div>
  </aside>
</template>
