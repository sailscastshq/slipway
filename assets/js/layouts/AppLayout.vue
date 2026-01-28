<script setup>
import { Link, usePage } from '@inertiajs/vue3'
import { computed, ref, provide } from 'vue'

const page = usePage()
const loggedInUser = page.props.loggedInUser

const currentPath = computed(() => page.url)

const isActive = (path) => {
  if (path === '/') return currentPath.value === '/'
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

// Provide toggle function to child components
provide('toggleMobileMenu', toggleMobileMenu)
</script>

<template>
  <div class="flex min-h-screen bg-white dark:bg-gray-950">
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
        <!-- Header -->
        <div class="flex items-center justify-between px-3 py-4">
          <button
            class="flex flex-1 items-center justify-between rounded-md px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-200 dark:text-gray-200 dark:hover:bg-gray-800"
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
              class="h-4 w-4 shrink-0 text-gray-400 dark:text-gray-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M8 9l4-4 4 4m0 6l-4 4-4-4"
              />
            </svg>
          </button>
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
                    ? 'bg-gray-200 text-gray-900 dark:bg-gray-800 dark:text-white'
                    : 'text-gray-600 hover:bg-gray-200/50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800/50 dark:hover:text-gray-200'
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
                href="/settings"
                @click="closeMobileMenu"
                :class="[
                  'flex items-center space-x-3 rounded-md px-3 py-2.5 text-sm transition-colors',
                  isActive('/settings')
                    ? 'bg-gray-200 text-gray-900 dark:bg-gray-800 dark:text-white'
                    : 'text-gray-600 hover:bg-gray-200/50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800/50 dark:hover:text-gray-200'
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
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                  />
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="1.5"
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
                <span>Settings</span>
              </Link>
            </li>
          </ul>
        </nav>

        <!-- User Profile -->
        <div class="px-3 py-3">
          <Link
            href="/profile"
            @click="closeMobileMenu"
            class="flex items-center space-x-3 rounded-md px-3 py-2.5 text-sm text-gray-600 transition-colors hover:bg-gray-200/50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800/50 dark:hover:text-gray-200"
          >
            <span
              class="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-xs font-medium text-white"
            >
              {{ loggedInUser.initials }}
            </span>
            <span class="truncate">{{ loggedInUser.email }}</span>
          </Link>
        </div>
      </aside>
    </Transition>

    <!-- Desktop Sidebar -->
    <aside
      class="hidden w-56 flex-col border-r border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-950 md:flex"
      v-if="loggedInUser"
    >
      <!-- Team Selector -->
      <div class="px-3 py-4">
        <button
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
            class="h-4 w-4 shrink-0 text-gray-400 dark:text-gray-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M8 9l4-4 4 4m0 6l-4 4-4-4"
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
              :class="[
                'flex items-center space-x-3 rounded-md px-2 py-2 text-sm transition-colors',
                isActive('/')
                  ? 'bg-gray-200 text-gray-900 dark:bg-gray-800 dark:text-white'
                  : 'text-gray-500 hover:bg-gray-200/50 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800/50 dark:hover:text-gray-200'
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
              href="/settings"
              :class="[
                'flex items-center space-x-3 rounded-md px-2 py-2 text-sm transition-colors',
                isActive('/settings')
                  ? 'bg-gray-200 text-gray-900 dark:bg-gray-800 dark:text-white'
                  : 'text-gray-500 hover:bg-gray-200/50 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800/50 dark:hover:text-gray-200'
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
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                />
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.5"
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
              <span>Settings</span>
            </Link>
          </li>
        </ul>
      </nav>

      <!-- User Profile -->
      <div class="px-3 py-3">
        <Link
          href="/profile"
          class="flex items-center space-x-3 rounded-md px-2 py-2 text-sm text-gray-500 transition-colors hover:bg-gray-200/50 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800/50 dark:hover:text-gray-200"
        >
          <span
            class="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-600 text-xs font-medium text-white"
          >
            {{ loggedInUser.initials }}
          </span>
          <span class="truncate">{{ loggedInUser.email }}</span>
        </Link>
      </div>
    </aside>

    <!-- Main Content -->
    <main class="flex-1 bg-white dark:bg-gray-950">
      <slot></slot>
    </main>
  </div>
</template>
