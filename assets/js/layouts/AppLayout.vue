<script setup>
import { Link, usePage, router } from '@inertiajs/vue3'
import { computed, ref, provide, onMounted, onUnmounted } from 'vue'
import { useEventSource } from '@/composables/sse'
import ToastContainer from '@/components/ToastContainer.vue'
import UpdateBanner from '@/components/UpdateBanner.vue'
import UpdateModal from '@/components/UpdateModal.vue'
import DeploymentToast from '@/components/DeploymentToast.vue'
import ServiceActionToast from '@/components/ServiceActionToast.vue'
import CommandPalette from '@/components/CommandPalette.vue'
import { createToast } from '@/composables/toast'
import { useFlashToast } from '@/composables/flash-toast'
import {
  createServiceActions,
  provideServiceActions
} from '@/composables/service-actions'
import { createCommandPalette } from '@/composables/useCommandPalette'
import { useUpdateCheck } from '@/composables/useUpdateCheck'

const page = usePage()
const loggedInUser = page.props.loggedInUser

const currentPath = computed(() => page.url)

const isActive = (path) => {
  if (path === '/') {
    // Projects: active on home or any /projects/* path (but not /lookout sub-routes)
    return (
      currentPath.value === '/' ||
      (currentPath.value.startsWith('/projects') &&
        !currentPath.value.includes('/lookout'))
    )
  }
  if (path === '/lookout') {
    return (
      currentPath.value.startsWith('/lookout') ||
      currentPath.value.includes('/lookout')
    )
  }
  return currentPath.value.startsWith(path)
}

// Mobile menu state
const mobileMenuOpen = ref(false)

const toggleMobileMenu = () => {
  mobileMenuOpen.value = !mobileMenuOpen.value
}

const closeMobileMenu = () => {
  mobileMenuOpen.value = false
}

// Desktop sidebar collapsed state (persisted in localStorage)
const sidebarCollapsed = ref(false)

const toggleSidebar = () => {
  sidebarCollapsed.value = !sidebarCollapsed.value
  localStorage.setItem('sidebarCollapsed', sidebarCollapsed.value)
}

// Provide toggle functions to child components
provide('toggleMobileMenu', toggleMobileMenu)
provide('toggleSidebar', toggleSidebar)
provide('sidebarCollapsed', sidebarCollapsed)

// Team dropdown state
const teamDropdownOpen = ref(false)
const userDropdownOpen = ref(false)

// Get user's teams (current team + owned teams)
const userTeams = computed(() => {
  if (!loggedInUser) return []
  const teams = []
  if (loggedInUser.team) {
    teams.push(loggedInUser.team)
  }
  // Add owned teams if different from current
  if (loggedInUser.ownedTeams) {
    for (const team of loggedInUser.ownedTeams) {
      if (!teams.find((t) => t.id === team.id)) {
        teams.push(team)
      }
    }
  }
  return teams
})

async function switchTeam(teamId) {
  teamDropdownOpen.value = false
  try {
    const res = await fetch('/switch-team', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamId })
    })
    if (res.ok) {
      window.location.reload()
    }
  } catch (e) {
    console.error('Failed to switch team:', e)
  }
}

function createNewTeam() {
  teamDropdownOpen.value = false
  router.visit('/teams/create')
}

function logout() {
  userDropdownOpen.value = false
  router.delete('/logout')
}

function closeAllDropdowns() {
  teamDropdownOpen.value = false
  userDropdownOpen.value = false
}

// Handle escape key to close dropdowns
function handleEscapeKey(e) {
  if (e.key === 'Escape') {
    closeAllDropdowns()
  }
}

// Toast system
const { toasts, toast, dismiss } = createToast()
useFlashToast(toast)

// Service actions (global tracking for service start/stop/restart)
const {
  actions: serviceActions,
  startAction,
  completeAction,
  dismissAction
} = createServiceActions()
provideServiceActions({ startAction, completeAction, dismissAction })

// Command palette (Cmd+K)
const { open: openCommandPalette } = createCommandPalette()

// Update check (shared singleton state populated by UpdateBanner)
const { updateInfo } = useUpdateCheck()
const showUpdateModal = ref(false)

// Active deployments tracking (SSE-based — no polling)
const activeDeployments = ref([])

const { close: disconnectDeploymentStream } = useEventSource(
  loggedInUser ? '/api/v1/deployments/active/stream' : null,
  {
    immediate: !!loggedInUser,
    onMessage(data) {
      if (data.deployments) {
        // Only add new deployments, don't remove ones we're already tracking
        // (DeploymentToast handles its own lifecycle via per-deployment SSE)
        for (const dep of data.deployments) {
          if (!activeDeployments.value.find((d) => d.id === dep.id)) {
            activeDeployments.value.push(dep)
          }
        }
      }
    }
  }
)

function dismissDeployment(deploymentId) {
  activeDeployments.value = activeDeployments.value.filter(
    (d) => d.id !== deploymentId
  )
}

// Initialize on mount
onMounted(() => {
  // Restore sidebar state
  const saved = localStorage.getItem('sidebarCollapsed')
  if (saved !== null) {
    sidebarCollapsed.value = saved === 'true'
  }

  // Listen for escape key to close dropdowns
  document.addEventListener('keydown', handleEscapeKey)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleEscapeKey)
})
</script>

<template>
  <div
    class="flex h-screen overflow-hidden bg-white dark:bg-gray-950"
    @click="closeAllDropdowns"
  >
    <!-- Mobile Menu Backdrop -->
    <Transition
      enter-active-class="transition-opacity duration-300"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition-opacity duration-300"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="mobileMenuOpen && loggedInUser"
        class="fixed inset-0 z-40 bg-black/50 md:hidden"
        @click="closeMobileMenu"
      />
    </Transition>

    <!-- Mobile Menu Drawer -->
    <Transition
      enter-active-class="transition-transform duration-300 ease-out"
      enter-from-class="-translate-x-full"
      enter-to-class="translate-x-0"
      leave-active-class="transition-transform duration-300 ease-in"
      leave-from-class="translate-x-0"
      leave-to-class="-translate-x-full"
    >
      <aside
        v-if="mobileMenuOpen && loggedInUser"
        class="fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-gray-50 dark:bg-gray-950 md:hidden"
      >
        <!-- Header with Team Selector -->
        <div class="flex items-center justify-between px-3 py-4">
          <div class="relative flex-1">
            <button
              @click.stop="teamDropdownOpen = !teamDropdownOpen"
              class="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-200 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              <div class="flex items-center space-x-2">
                <img
                  v-if="loggedInUser.team?.logoUrl"
                  :src="loggedInUser.team.logoUrl"
                  alt=""
                  class="h-6 w-6 rounded object-cover"
                />
                <span
                  v-else
                  class="bg-brand flex h-6 w-6 items-center justify-center rounded text-xs font-medium text-white"
                >
                  {{ loggedInUser.team?.name?.charAt(0)?.toUpperCase() || 'T' }}
                </span>
                <span class="truncate font-medium">{{
                  loggedInUser.team?.name || 'Team'
                }}</span>
              </div>
              <svg
                :class="[
                  'h-4 w-4 shrink-0 text-gray-400 transition-transform dark:text-gray-500',
                  teamDropdownOpen ? 'rotate-180' : ''
                ]"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>
            <!-- Team Dropdown -->
            <Transition
              enter-active-class="transition ease-out duration-100"
              enter-from-class="transform opacity-0 scale-95"
              enter-to-class="transform opacity-100 scale-100"
              leave-active-class="transition ease-in duration-75"
              leave-from-class="transform opacity-100 scale-100"
              leave-to-class="transform opacity-0 scale-95"
            >
              <div
                v-if="teamDropdownOpen"
                @click.stop
                class="absolute left-0 top-full z-20 mt-1 w-full rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
              >
                <div
                  class="px-3 py-1.5 text-xs font-medium text-gray-400 dark:text-gray-500"
                >
                  Teams
                </div>
                <button
                  v-for="team in userTeams"
                  :key="team.id"
                  @click="switchTeam(team.id)"
                  :class="[
                    'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800',
                    team.id === loggedInUser.team?.id
                      ? 'text-gray-900 dark:text-white'
                      : 'text-gray-600 dark:text-gray-400'
                  ]"
                >
                  <img
                    v-if="team.logoUrl"
                    :src="team.logoUrl"
                    alt=""
                    class="h-5 w-5 rounded object-cover"
                  />
                  <span
                    v-else
                    class="bg-brand flex h-5 w-5 items-center justify-center rounded text-[10px] font-medium text-white"
                  >
                    {{ team.name?.charAt(0)?.toUpperCase() }}
                  </span>
                  <span class="flex-1 truncate">{{ team.name }}</span>
                  <svg
                    v-if="team.id === loggedInUser.team?.id"
                    class="h-4 w-4 text-emerald-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </button>
                <div
                  class="my-1 border-t border-gray-100 dark:border-gray-800"
                ></div>
                <button
                  @click="createNewTeam"
                  class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
                >
                  <svg
                    class="h-5 w-5 text-gray-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M12 4v16m8-8H4"
                    />
                  </svg>
                  <span>Create team</span>
                </button>
              </div>
            </Transition>
          </div>
          <button
            @click="closeMobileMenu"
            class="ml-2 rounded-md p-1.5 text-gray-500 hover:bg-gray-200 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          >
            <svg
              class="h-5 w-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <!-- Navigation -->
        <nav class="flex-1 px-3 py-4">
          <ul class="space-y-1">
            <li>
              <Link
                href="/"
                @click="closeMobileMenu"
                :class="[
                  'flex items-center space-x-3 rounded-md px-3 py-2.5 text-sm transition-colors',
                  isActive('/')
                    ? 'text-gray-900 dark:text-white'
                    : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200'
                ]"
              >
                <svg
                  class="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="1.5"
                    d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                  />
                </svg>
                <span>Projects</span>
              </Link>
            </li>
            <li>
              <Link
                href="/lookout"
                @click="closeMobileMenu"
                :class="[
                  'flex items-center space-x-3 rounded-md px-3 py-2.5 text-sm transition-colors',
                  isActive('/lookout')
                    ? 'text-gray-900 dark:text-white'
                    : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200'
                ]"
              >
                <svg
                  class="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="1.5"
                    d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                  />
                </svg>
                <span>Lookout</span>
              </Link>
            </li>
            <li>
              <Link
                href="/bosun"
                @click="closeMobileMenu"
                :class="[
                  'flex items-center space-x-3 rounded-md px-3 py-2.5 text-sm transition-colors',
                  isActive('/bosun')
                    ? 'text-gray-900 dark:text-white'
                    : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200'
                ]"
              >
                <svg
                  class="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="1.5"
                    d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085"
                  />
                </svg>
                <span>Bosun</span>
              </Link>
            </li>
            <li>
              <Link
                href="/settings"
                @click="closeMobileMenu"
                :class="[
                  'flex items-center space-x-3 rounded-md px-3 py-2.5 text-sm transition-colors',
                  isActive('/settings')
                    ? 'text-gray-900 dark:text-white'
                    : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200'
                ]"
              >
                <svg
                  class="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="1.5"
                    d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75"
                  />
                </svg>
                <span>Settings</span>
              </Link>
            </li>
          </ul>
        </nav>

        <!-- User Profile Dropdown (Mobile) -->
        <div class="relative px-3 py-3">
          <button
            @click.stop="userDropdownOpen = !userDropdownOpen"
            class="flex w-full items-center space-x-3 rounded-md px-3 py-2.5 text-sm text-gray-600 transition-colors hover:bg-gray-200/50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800/50 dark:hover:text-gray-200"
          >
            <span
              class="bg-brand flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium text-white"
            >
              {{ loggedInUser.initials }}
            </span>
            <span class="flex-1 truncate text-left">{{
              loggedInUser.email
            }}</span>
            <svg
              class="h-4 w-4 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>
          <!-- User Dropdown -->
          <Transition
            enter-active-class="transition ease-out duration-100"
            enter-from-class="transform opacity-0 scale-95"
            enter-to-class="transform opacity-100 scale-100"
            leave-active-class="transition ease-in duration-75"
            leave-from-class="transform opacity-100 scale-100"
            leave-to-class="transform opacity-0 scale-95"
          >
            <div
              v-if="userDropdownOpen"
              @click.stop
              class="absolute bottom-full left-3 right-3 z-20 mb-1 rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
            >
              <Link
                href="/profile"
                @click="
                  userDropdownOpen = false
                  closeMobileMenu()
                "
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
                    stroke-width="2"
                    d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                  />
                </svg>
                Profile
              </Link>
              <Link
                href="/settings"
                @click="
                  userDropdownOpen = false
                  closeMobileMenu()
                "
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
                    stroke-width="2"
                    d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75"
                  />
                </svg>
                Settings
              </Link>
              <!-- Update available (conditional) -->
              <button
                v-if="updateInfo?.updateAvailable"
                @click="
                  userDropdownOpen = false
                  closeMobileMenu()
                  showUpdateModal = true
                "
                class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <svg
                  class="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                <span class="flex-1">Update available</span>
                <span
                  class="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                  >{{ updateInfo.latestVersion }}</span
                >
              </button>
              <button
                @click="
                  userDropdownOpen = false
                  closeMobileMenu()
                  openCommandPalette()
                "
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
                    stroke-width="2"
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
                <span class="flex-1">Search</span>
                <kbd
                  class="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-400 dark:bg-gray-800 dark:text-gray-500"
                  >&#8984;K</kbd
                >
              </button>
              <div
                class="my-1 border-t border-gray-100 dark:border-gray-800"
              ></div>
              <a
                href="https://docs.sailscasts.com/slipway"
                target="_blank"
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
                    stroke-width="2"
                    d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                  />
                </svg>
                Docs
              </a>
              <a
                href="https://github.com/sailscastshq/slipway"
                target="_blank"
                class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <svg
                  class="h-4 w-4 text-gray-400"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path
                    d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
                  />
                </svg>
                Star on GitHub
              </a>
              <a
                href="https://github.com/sponsors/DominusKelvin"
                target="_blank"
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
                Sponsor Slipway
              </a>
              <div
                class="my-1 border-t border-gray-100 dark:border-gray-800"
              ></div>
              <button
                @click="logout"
                class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
              >
                <svg
                  class="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                  />
                </svg>
                Sign out
              </button>
            </div>
          </Transition>
        </div>
      </aside>
    </Transition>

    <!-- Desktop Sidebar -->
    <aside
      v-if="loggedInUser"
      :class="[
        'hidden flex-col border-r border-gray-200 bg-gray-50 transition-all duration-200 ease-out dark:border-gray-800 dark:bg-gray-950 md:flex',
        sidebarCollapsed ? 'w-0 overflow-hidden border-r-0' : 'w-56'
      ]"
    >
      <!-- Team Selector + Collapse -->
      <div class="flex items-center justify-between px-3 py-4">
        <div class="relative flex-1">
          <button
            @click.stop="teamDropdownOpen = !teamDropdownOpen"
            class="flex w-full items-center space-x-2 rounded-md px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-200 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            <img
              v-if="loggedInUser.team?.logoUrl"
              :src="loggedInUser.team.logoUrl"
              alt=""
              class="h-6 w-6 rounded object-cover"
            />
            <span
              v-else
              class="bg-brand flex h-6 w-6 items-center justify-center rounded text-xs font-medium text-white"
            >
              {{ loggedInUser.team?.name?.charAt(0)?.toUpperCase() || 'T' }}
            </span>
            <span class="flex-1 truncate text-left font-medium">{{
              loggedInUser.team?.name || 'Team'
            }}</span>
            <svg
              :class="[
                'h-4 w-4 shrink-0 text-gray-400 transition-transform dark:text-gray-500',
                teamDropdownOpen ? 'rotate-180' : ''
              ]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>
          <!-- Team Dropdown -->
          <Transition
            enter-active-class="transition ease-out duration-100"
            enter-from-class="transform opacity-0 scale-95"
            enter-to-class="transform opacity-100 scale-100"
            leave-active-class="transition ease-in duration-75"
            leave-from-class="transform opacity-100 scale-100"
            leave-to-class="transform opacity-0 scale-95"
          >
            <div
              v-if="teamDropdownOpen"
              @click.stop
              class="absolute left-0 top-full z-20 mt-1 w-full rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
            >
              <div
                class="px-3 py-1.5 text-xs font-medium text-gray-400 dark:text-gray-500"
              >
                Teams
              </div>
              <button
                v-for="team in userTeams"
                :key="team.id"
                @click="switchTeam(team.id)"
                :class="[
                  'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800',
                  team.id === loggedInUser.team?.id
                    ? 'text-gray-900 dark:text-white'
                    : 'text-gray-600 dark:text-gray-400'
                ]"
              >
                <img
                  v-if="team.logoUrl"
                  :src="team.logoUrl"
                  alt=""
                  class="h-5 w-5 rounded object-cover"
                />
                <span
                  v-else
                  class="bg-brand flex h-5 w-5 items-center justify-center rounded text-[10px] font-medium text-white"
                >
                  {{ team.name?.charAt(0)?.toUpperCase() }}
                </span>
                <span class="flex-1 truncate">{{ team.name }}</span>
                <svg
                  v-if="team.id === loggedInUser.team?.id"
                  class="h-4 w-4 text-emerald-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </button>
              <div
                class="my-1 border-t border-gray-100 dark:border-gray-800"
              ></div>
              <button
                @click="createNewTeam"
                class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
              >
                <svg
                  class="h-5 w-5 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M12 4v16m8-8H4"
                  />
                </svg>
                <span>Create team</span>
              </button>
            </div>
          </Transition>
        </div>
      </div>

      <!-- Navigation -->
      <nav class="flex-1 px-3 py-4">
        <ul class="space-y-1">
          <li>
            <Link
              href="/"
              :class="[
                'flex items-center space-x-3 rounded-md px-2 py-2 text-sm transition-colors',
                isActive('/')
                  ? 'text-gray-900 dark:text-white'
                  : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
              ]"
            >
              <svg
                class="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.5"
                  d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                />
              </svg>
              <span>Projects</span>
            </Link>
          </li>
          <li>
            <Link
              href="/lookout"
              :class="[
                'flex items-center space-x-3 rounded-md px-2 py-2 text-sm transition-colors',
                isActive('/lookout')
                  ? 'text-gray-900 dark:text-white'
                  : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
              ]"
            >
              <svg
                class="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.5"
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                />
              </svg>
              <span>Lookout</span>
            </Link>
          </li>
          <li>
            <Link
              href="/bosun"
              :class="[
                'flex items-center space-x-3 rounded-md px-2 py-2 text-sm transition-colors',
                isActive('/bosun')
                  ? 'text-gray-900 dark:text-white'
                  : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
              ]"
            >
              <svg
                class="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.5"
                  d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085"
                />
              </svg>
              <span>Bosun</span>
            </Link>
          </li>
          <li>
            <Link
              href="/settings"
              :class="[
                'flex items-center space-x-3 rounded-md px-2 py-2 text-sm transition-colors',
                isActive('/settings')
                  ? 'text-gray-900 dark:text-white'
                  : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
              ]"
            >
              <svg
                class="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.5"
                  d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75"
                />
              </svg>
              <span>Settings</span>
            </Link>
          </li>
        </ul>
      </nav>

      <!-- User Profile Dropdown (Desktop) -->
      <div class="relative px-3 py-3">
        <button
          @click.stop="userDropdownOpen = !userDropdownOpen"
          class="flex w-full items-center space-x-3 rounded-md px-2 py-2 text-sm text-gray-500 transition-colors hover:bg-gray-200/50 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800/50 dark:hover:text-gray-200"
        >
          <span
            class="bg-brand flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium text-white"
          >
            {{ loggedInUser.initials }}
          </span>
          <span class="flex-1 truncate text-left">{{
            loggedInUser.email
          }}</span>
          <svg
            class="h-4 w-4 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>
        <!-- User Dropdown -->
        <Transition
          enter-active-class="transition ease-out duration-100"
          enter-from-class="transform opacity-0 scale-95"
          enter-to-class="transform opacity-100 scale-100"
          leave-active-class="transition ease-in duration-75"
          leave-from-class="transform opacity-100 scale-100"
          leave-to-class="transform opacity-0 scale-95"
        >
          <div
            v-if="userDropdownOpen"
            @click.stop
            class="absolute bottom-full left-3 right-3 z-20 mb-1 rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
          >
            <Link
              href="/profile"
              @click="userDropdownOpen = false"
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
                  stroke-width="2"
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                />
              </svg>
              Profile
            </Link>
            <Link
              href="/settings"
              @click="userDropdownOpen = false"
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
                  stroke-width="2"
                  d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75"
                />
              </svg>
              Settings
            </Link>
            <!-- Update available (conditional) -->
            <button
              v-if="updateInfo?.updateAvailable"
              @click="
                userDropdownOpen = false
                showUpdateModal = true
              "
              class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <svg
                class="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              <span class="flex-1">Update available</span>
              <span
                class="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                >{{ updateInfo.latestVersion }}</span
              >
            </button>
            <button
              @click="
                userDropdownOpen = false
                openCommandPalette()
              "
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
                  stroke-width="2"
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <span class="flex-1">Search</span>
              <kbd
                class="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-400 dark:bg-gray-800 dark:text-gray-500"
                >&#8984;K</kbd
              >
            </button>
            <div
              class="my-1 border-t border-gray-100 dark:border-gray-800"
            ></div>
            <a
              href="https://docs.sailscasts.com/slipway"
              target="_blank"
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
                  stroke-width="2"
                  d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                />
              </svg>
              Docs
            </a>
            <a
              href="https://github.com/sailscastshq/slipway"
              target="_blank"
              class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <svg
                class="h-4 w-4 text-gray-400"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path
                  d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
                />
              </svg>
              Star on GitHub
            </a>
            <a
              href="https://github.com/sponsors/DominusKelvin"
              target="_blank"
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
              Sponsor Slipway
            </a>
            <div
              class="my-1 border-t border-gray-100 dark:border-gray-800"
            ></div>
            <button
              @click="logout"
              class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
            >
              <svg
                class="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                />
              </svg>
              Sign out
            </button>
          </div>
        </Transition>
      </div>
    </aside>

    <!-- Main Content -->
    <main class="min-w-0 flex-1 overflow-y-auto bg-white dark:bg-gray-950">
      <!-- Update Banner (only for logged in users) -->
      <UpdateBanner v-if="loggedInUser" />

      <slot></slot>
    </main>

    <!-- Toasts -->
    <ToastContainer :toasts="toasts" @dismiss="dismiss" />

    <!-- Persistent Deployment & Service Action Toasts -->
    <div
      class="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-3"
    >
      <ServiceActionToast
        v-for="action in serviceActions"
        :key="'service-' + action.id"
        :action="action"
        @dismiss="dismissAction"
      />
      <DeploymentToast
        v-for="deployment in activeDeployments"
        :key="'deploy-' + deployment.id"
        :deployment="deployment"
        @dismiss="dismissDeployment"
      />
    </div>

    <!-- Command Palette (Cmd+K) -->
    <CommandPalette v-if="loggedInUser" />

    <!-- Update Confirmation Modal -->
    <UpdateModal
      v-if="showUpdateModal"
      :updateInfo="updateInfo"
      @close="showUpdateModal = false"
    />
  </div>
</template>
