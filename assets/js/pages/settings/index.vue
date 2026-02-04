<script setup>
import { Link, Head } from '@inertiajs/vue3'
import { inject, ref, computed } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'

defineOptions({
  layout: AppLayout
})

const toggleMobileMenu = inject('toggleMobileMenu')

const search = ref('')

const settings = [
  {
    title: 'Team Members',
    description: 'Invite and manage who has access to your team.',
    href: '/settings/team',
    icon: 'users'
  },
  {
    title: 'CLI Tokens',
    description: 'Manage tokens used to authenticate the Slipway CLI.',
    href: '/settings/cli-tokens',
    icon: 'key'
  }
]

const filtered = computed(() => {
  const q = search.value.toLowerCase().trim()
  if (!q) return settings
  return settings.filter(s =>
    s.title.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
  )
})
</script>
<template>
  <Head title="Settings | Slipway"></Head>
  <div class="flex h-full flex-col">
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-gray-200 px-4 py-4 dark:border-gray-800 sm:px-8">
      <div class="flex items-center space-x-3">
        <button
          @click="toggleMobileMenu"
          class="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white md:hidden"
        >
          <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <nav class="flex items-center text-sm">
          <span class="font-medium text-gray-900 dark:text-white">settings</span>
        </nav>
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
      <div class="mx-auto max-w-6xl">
        <!-- Search -->
        <div class="mb-6">
          <input
            v-model="search"
            type="text"
            placeholder="Search settings..."
            class="w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500 sm:w-64"
          />
        </div>

        <!-- Settings list -->
        <div v-if="filtered.length > 0" class="rounded-lg border border-gray-200 dark:border-gray-800">
          <Link
            v-for="(item, i) in filtered"
            :key="item.href"
            :href="item.href"
            :class="[
              'flex items-center justify-between px-4 py-4 transition-colors hover:bg-gray-50 dark:hover:bg-gray-900/50',
              i > 0 ? 'border-t border-gray-200 dark:border-gray-800' : ''
            ]"
          >
            <div class="flex items-center space-x-3">
              <!-- Users icon -->
              <svg
                v-if="item.icon === 'users'"
                class="h-4 w-4 text-gray-400 dark:text-gray-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.5"
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                />
              </svg>
              <!-- Key icon -->
              <svg
                v-if="item.icon === 'key'"
                class="h-4 w-4 text-gray-400 dark:text-gray-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.5"
                  d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
                />
              </svg>
              <div>
                <span class="text-sm font-medium text-gray-900 dark:text-white">{{ item.title }}</span>
                <p class="text-sm text-gray-500 dark:text-gray-400">{{ item.description }}</p>
              </div>
            </div>
            <svg class="h-4 w-4 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>

        <!-- No results -->
        <div v-else class="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
          No settings matching "{{ search }}"
        </div>
      </div>
    </div>
  </div>
</template>
