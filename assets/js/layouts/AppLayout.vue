<script setup>
import { Link, usePage, router } from '@inertiajs/vue3'
import { computed, ref, provide, onMounted } from 'vue'
import ToastContainer from '@/components/ToastContainer.vue'
import UpdateBanner from '@/components/UpdateBanner.vue'
import { createToast } from '@/composables/toast'
import { useFlashToast } from '@/composables/flash-toast'

const page = usePage()
const loggedInUser = page.props.loggedInUser

const currentPath = computed(() => page.url)

const isActive = (path) => {
  if (path === '/') {
    // Projects: active on home or any /projects/* path
    return currentPath.value === '/' || currentPath.value.startsWith('/projects')
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

onMounted(() => {
  const saved = localStorage.getItem('sidebarCollapsed')
  if (saved !== null) {
    sidebarCollapsed.value = saved === 'true'
  }
})

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
      if (!teams.find(t => t.id === team.id)) {
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

// Toast system
const { toasts, toast, dismiss } = createToast()
useFlashToast(toast)
</script>

<template>
  <div class="flex h-screen overflow-hidden bg-white dark:bg-gray-950" @click="closeAllDropdowns">
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
                <span
                  class="flex h-6 w-6 items-center justify-center rounded bg-brand text-xs font-medium text-white"
                >
                  {{ loggedInUser.team?.name?.charAt(0)?.toUpperCase() || 'T' }}
                </span>
                <span class="truncate font-medium">{{ loggedInUser.team?.name || 'Team' }}</span>
              </div>
              <svg
                :class="['h-4 w-4 shrink-0 text-gray-400 transition-transform dark:text-gray-500', teamDropdownOpen ? 'rotate-180' : '']"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
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
                <div class="px-3 py-1.5 text-xs font-medium text-gray-400 dark:text-gray-500">Teams</div>
                <button
                  v-for="team in userTeams"
                  :key="team.id"
                  @click="switchTeam(team.id)"
                  :class="[
                    'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800',
                    team.id === loggedInUser.team?.id ? 'text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-400'
                  ]"
                >
                  <span class="flex h-5 w-5 items-center justify-center rounded bg-brand text-[10px] font-medium text-white">
                    {{ team.name?.charAt(0)?.toUpperCase() }}
                  </span>
                  <span class="flex-1 truncate">{{ team.name }}</span>
                  <svg v-if="team.id === loggedInUser.team?.id" class="h-4 w-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                  </svg>
                </button>
                <div class="my-1 border-t border-gray-100 dark:border-gray-800"></div>
                <button
                  @click="createNewTeam"
                  class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
                >
                  <svg class="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
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
            <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
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
                <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
                <span>Projects</span>
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
                <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
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
            <span class="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-xs font-medium text-white">
              {{ loggedInUser.initials }}
            </span>
            <span class="flex-1 truncate text-left">{{ loggedInUser.email }}</span>
            <svg class="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
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
                @click="userDropdownOpen = false; closeMobileMenu()"
                class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <svg class="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                Profile
              </Link>
              <Link
                href="/settings"
                @click="userDropdownOpen = false; closeMobileMenu()"
                class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <svg class="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
                </svg>
                Settings
              </Link>
              <div class="my-1 border-t border-gray-100 dark:border-gray-800"></div>
              <button
                @click="logout"
                class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
              >
                <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Sign out
              </button>
            </div>
          </Transition>
        </div>
      </aside>
    </Transition>

    <!-- Desktop Sidebar -->
    <Transition
      enter-active-class="transition-all duration-200 ease-out"
      enter-from-class="-translate-x-full opacity-0"
      enter-to-class="translate-x-0 opacity-100"
      leave-active-class="transition-all duration-200 ease-in"
      leave-from-class="translate-x-0 opacity-100"
      leave-to-class="-translate-x-full opacity-0"
    >
      <aside
        v-if="loggedInUser && !sidebarCollapsed"
        class="hidden w-56 flex-col border-r border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-950 md:flex"
      >
        <!-- Team Selector + Collapse -->
        <div class="flex items-center justify-between px-3 py-4">
          <div class="relative flex-1">
            <button
              @click.stop="teamDropdownOpen = !teamDropdownOpen"
              class="flex w-full items-center space-x-2 rounded-md px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-200 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              <span class="flex h-6 w-6 items-center justify-center rounded bg-brand text-xs font-medium text-white">
                {{ loggedInUser.team?.name?.charAt(0)?.toUpperCase() || 'T' }}
              </span>
              <span class="flex-1 truncate text-left font-medium">{{ loggedInUser.team?.name || 'Team' }}</span>
              <svg
                :class="['h-4 w-4 shrink-0 text-gray-400 transition-transform dark:text-gray-500', teamDropdownOpen ? 'rotate-180' : '']"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
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
                <div class="px-3 py-1.5 text-xs font-medium text-gray-400 dark:text-gray-500">Teams</div>
                <button
                  v-for="team in userTeams"
                  :key="team.id"
                  @click="switchTeam(team.id)"
                  :class="[
                    'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800',
                    team.id === loggedInUser.team?.id ? 'text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-400'
                  ]"
                >
                  <span class="flex h-5 w-5 items-center justify-center rounded bg-brand text-[10px] font-medium text-white">
                    {{ team.name?.charAt(0)?.toUpperCase() }}
                  </span>
                  <span class="flex-1 truncate">{{ team.name }}</span>
                  <svg v-if="team.id === loggedInUser.team?.id" class="h-4 w-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                  </svg>
                </button>
                <div class="my-1 border-t border-gray-100 dark:border-gray-800"></div>
                <button
                  @click="createNewTeam"
                  class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
                >
                  <svg class="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
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
                <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
                <span>Projects</span>
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
                <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
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
            <span class="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-600 text-xs font-medium text-white">
              {{ loggedInUser.initials }}
            </span>
            <span class="flex-1 truncate text-left">{{ loggedInUser.email }}</span>
            <svg class="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
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
                <svg class="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                Profile
              </Link>
              <Link
                href="/settings"
                @click="userDropdownOpen = false"
                class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <svg class="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
                </svg>
                Settings
              </Link>
              <div class="my-1 border-t border-gray-100 dark:border-gray-800"></div>
              <button
                @click="logout"
                class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
              >
                <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Sign out
              </button>
            </div>
          </Transition>
        </div>
      </aside>
    </Transition>

    <!-- Main Content -->
    <main class="min-w-0 flex-1 overflow-y-auto bg-white dark:bg-gray-950">
      <!-- Update Banner (only for logged in users) -->
      <UpdateBanner v-if="loggedInUser" />

      <slot></slot>
    </main>

    <!-- Toasts -->
    <ToastContainer :toasts="toasts" @dismiss="dismiss" />
  </div>
</template>
