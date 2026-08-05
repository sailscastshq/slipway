<script setup>
import { Link } from '@inertiajs/vue3'
import { computed, inject } from 'vue'

const props = defineProps({
  project: Object,
  environment: Object,
  app: Object,
  hostBridgeOrigin: Boolean,
  breadcrumbs: {
    type: Array,
    default: () => []
  }
})

const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')
const mobileBreadcrumbs = computed(() => props.breadcrumbs.slice(-2))
</script>

<template>
  <header
    class="min-h-14 flex items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-950 sm:px-6"
    data-test="bridge-page-header"
  >
    <div class="flex min-w-0 items-center gap-3">
      <button
        type="button"
        class="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white md:hidden"
        aria-label="Open Bridge navigation"
        @click="toggleMobileMenu"
      >
        <svg
          class="h-5 w-5"
          viewBox="-0.5 -0.5 16 16"
          fill="none"
          stroke="currentColor"
        >
          <path
            d="M12.777 14.285H2.223c-.833 0-1.508-.675-1.508-1.508V2.223c0-.833.675-1.508 1.508-1.508h10.554c.833 0 1.508.675 1.508 1.508v10.554c0 .833-.675 1.508-1.508 1.508Z"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1"
          />
          <path
            d="M5.615 14.285V.715M2.6 5.992 3.919 7.5 2.6 9.008"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1"
          />
        </svg>
      </button>
      <button
        type="button"
        class="hidden rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-900 dark:hover:text-gray-200 md:block"
        :aria-label="sidebarCollapsed ? 'Show navigation' : 'Hide navigation'"
        @click="toggleSidebar"
      >
        <svg
          class="h-5 w-5"
          viewBox="-0.5 -0.5 16 16"
          fill="none"
          stroke="currentColor"
        >
          <path
            d="M12.777 14.285H2.223c-.833 0-1.508-.675-1.508-1.508V2.223c0-.833.675-1.508 1.508-1.508h10.554c.833 0 1.508.675 1.508 1.508v10.554c0 .833-.675 1.508-1.508 1.508Z"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1"
          />
          <path
            d="M5.615 14.285V.715"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1"
          />
          <path
            :d="
              sidebarCollapsed
                ? 'M2.6 5.992 3.919 7.5 2.6 9.008'
                : 'M3.919 5.992 2.6 7.5l1.319 1.508'
            "
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1"
          />
        </svg>
      </button>

      <nav
        aria-label="Breadcrumb"
        class="flex min-w-0 items-center gap-2 text-sm sm:hidden"
      >
        <template
          v-for="(crumb, index) in mobileBreadcrumbs"
          :key="`${crumb.label}-${index}`"
        >
          <span v-if="index" class="text-gray-300 dark:text-gray-700">/</span>
          <Link
            v-if="crumb.href && index < mobileBreadcrumbs.length - 1"
            :href="crumb.href"
            class="max-w-32 truncate text-gray-500 dark:text-gray-400"
          >
            {{ crumb.label }}
          </Link>
          <span
            v-else
            class="max-w-40 truncate font-medium text-gray-900 dark:text-white"
            :title="crumb.title || crumb.label"
          >
            {{ crumb.label }}
          </span>
        </template>
      </nav>

      <nav
        aria-label="Breadcrumb"
        class="hidden min-w-0 items-center gap-2 text-sm sm:flex"
      >
        <template v-if="!hostBridgeOrigin">
          <Link
            href="/"
            class="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
            >projects</Link
          >
          <span class="text-gray-300 dark:text-gray-700">/</span>
          <Link
            :href="`/projects/${project.slug}`"
            class="max-w-32 truncate text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >
            {{ project.name.toLowerCase() }}
          </Link>
          <span class="text-gray-300 dark:text-gray-700">/</span>
          <Link
            :href="`/projects/${project.slug}/environments/${environment.slug}`"
            class="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >
            {{ environment.slug }}
          </Link>
        </template>
        <span v-else class="max-w-32 truncate text-gray-500 dark:text-gray-400">
          {{ app?.name }}
        </span>
        <template
          v-for="(crumb, index) in breadcrumbs"
          :key="`${crumb.label}-${index}`"
        >
          <span class="text-gray-300 dark:text-gray-700">/</span>
          <Link
            v-if="crumb.href"
            :href="crumb.href"
            class="max-w-40 truncate text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >
            {{ crumb.label }}
          </Link>
          <span
            v-else
            class="max-w-48 truncate font-medium text-gray-900 dark:text-white"
            :title="crumb.title || crumb.label"
          >
            {{ crumb.label }}
          </span>
        </template>
      </nav>
    </div>

    <div class="flex shrink-0 items-center gap-2 sm:gap-3">
      <a
        v-if="hostBridgeOrigin"
        href="https://docs.sailscasts.com/slipway/bridge"
        target="_blank"
        rel="noreferrer"
        class="text-sm text-gray-500 transition-colors hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
        data-test="bridge-docs-link"
      >
        Docs <span aria-hidden="true">↗</span>
      </a>
      <slot name="actions" />
    </div>
  </header>
</template>
