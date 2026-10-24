<script setup>
import { Head, router } from '@inertiajs/vue3'
import { inject, onMounted, onUnmounted } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'
import Breadcrumb from '@/components/ui/breadcrumb/Breadcrumb.vue'
import SidebarOpen from '@/components/ui/icons/SidebarOpen.vue'
import SidebarClose from '@/components/ui/icons/SidebarClose.vue'
import CiWorkspace from '@/components/ci/CiWorkspace.vue'
defineOptions({ layout: AppLayout })
const props = defineProps({
  project: Object,
  environment: Object,
  workspace: Object,
  app: Object,
  canManage: Boolean
})
let refreshTimer,
  refreshing = false,
  refreshedAt = 0
onMounted(() => {
  refreshTimer = setInterval(() => {
    const active = props.workspace.runs?.some((run) =>
      ['queued', 'preparing', 'running'].includes(run.state)
    )
    if (
      document.visibilityState !== 'visible' ||
      refreshing ||
      Date.now() - refreshedAt < (active ? 3000 : 15000)
    )
      return
    refreshing = true
    refreshedAt = Date.now()
    router.reload({
      only: ['workspace'],
      preserveScroll: true,
      onFinish: () => {
        refreshing = false
      }
    })
  }, 1000)
})
onUnmounted(() => clearInterval(refreshTimer))
const toggleSidebar = inject('toggleSidebar'),
  toggleMobileMenu = inject('toggleMobileMenu'),
  sidebarCollapsed = inject('sidebarCollapsed')
</script>
<template>
  <Head :title="`Slipway CI - ${project.name}`" />
  <div class="flex h-full flex-col">
    <header
      class="flex items-center justify-between gap-3 border-b border-gray-200 py-4 pl-4 pr-4 dark:border-gray-800 sm:pr-8"
    >
      <div class="flex min-w-0 items-center gap-3">
        <button
          aria-label="Open navigation"
          class="rounded-md p-1 text-gray-500 md:hidden"
          @click="toggleMobileMenu"
        >
          <SidebarOpen class="size-5" />
        </button>
        <button
          aria-label="Toggle sidebar"
          class="hidden text-gray-400 md:block"
          @click="toggleSidebar"
        >
          <SidebarOpen v-if="sidebarCollapsed" class="size-5" /><SidebarClose
            v-else
            class="size-5"
          />
        </button>
        <Breadcrumb
          :items="[
            { label: 'projects', href: '/' },
            {
              label: project.name.toLowerCase(),
              href: `/projects/${project.slug}`
            },
            {
              label: environment.name.toLowerCase(),
              href: `/projects/${project.slug}/environments/${environment.slug}`
            },
            { label: 'ci' }
          ]"
        />
      </div>
      <span class="shrink-0 text-xs text-gray-500">{{
        workspace.policy
          ? workspace.policy.enabled
            ? workspace.policy.configuration.automatic
              ? 'Automatic'
              : 'Local-first'
            : 'Disabled'
          : 'Not configured'
      }}</span>
    </header>
    <CiWorkspace
      :workspace="workspace"
      :can-manage="canManage"
      :target="{
        project: project.slug,
        env: environment.slug,
        app: app?.slug || 'web'
      }"
      :api-url="
        app
          ? `/api/v1/projects/${project.slug}/environments/${environment.slug}/apps/${app.slug}/ci`
          : ''
      "
      @refresh="router.reload({ only: ['workspace'] })"
    />
  </div>
</template>
