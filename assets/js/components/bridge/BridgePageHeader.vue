<script setup>
import SidebarClose from '@/components/ui/icons/SidebarClose.vue'
import SidebarOpen from '@/components/ui/icons/SidebarOpen.vue'
import { computed, inject } from 'vue'
import Breadcrumb from '@/components/ui/breadcrumb/Breadcrumb.vue'

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
const breadcrumbItems = computed(() => [
  ...(props.hostBridgeOrigin
    ? [
        {
          label: props.app?.name || 'bridge',
          title: props.app?.name || 'bridge'
        }
      ]
    : [
        { label: 'projects', href: '/' },
        {
          label: props.project.name.toLowerCase(),
          href: `/projects/${props.project.slug}`
        },
        {
          label: props.environment.slug,
          href: `/projects/${props.project.slug}/environments/${props.environment.slug}`
        }
      ]),
  ...props.breadcrumbs
])
</script>

<template>
  <header
    class="min-h-14 flex items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-950 sm:px-6"
    data-test="bridge-page-header"
  >
    <div class="flex min-w-0 flex-1 items-center gap-3">
      <button
        type="button"
        class="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white md:hidden"
        aria-label="Open Bridge navigation"
        @click="toggleMobileMenu"
      >
        <SidebarOpen class="h-5 w-5" stroke-width="1" />
      </button>
      <button
        type="button"
        class="hidden rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-900 dark:hover:text-gray-200 md:block"
        :aria-label="sidebarCollapsed ? 'Show navigation' : 'Hide navigation'"
        @click="toggleSidebar"
      >
        <SidebarOpen v-if="sidebarCollapsed" class="h-5 w-5" stroke-width="1" />
        <SidebarClose v-else class="h-5 w-5" stroke-width="1" />
      </button>

      <Breadcrumb :items="breadcrumbItems" class="flex-1" />
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
