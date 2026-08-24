<script setup>
import { usePage } from '@inertiajs/vue3'
import { computed, onMounted, onUnmounted, provide, ref, watch } from 'vue'
import BridgeWorkspaceSidebar from '@/components/bridge/BridgeWorkspaceSidebar.vue'
import Sheet from '@/components/ui/sheet/Sheet.vue'
import Sidebar from '@/components/ui/sidebar/Sidebar.vue'

const STORAGE_KEY = 'slipway:bridge-sidebar-collapsed'
const page = usePage()
const mobileMenuOpen = ref(false)
const mobileSheet = ref()
const desktopSidebar = ref()
const sidebarOpen = ref(true)
const sidebarCollapsed = computed(() => !sidebarOpen.value)
let desktopMediaQuery

function toggleMobileMenu(event) {
  if (mobileMenuOpen.value) {
    mobileSheet.value?.close()
    return
  }

  const invoker = event?.currentTarget ?? event
  if (mobileSheet.value) mobileSheet.value.showModal(invoker)
  else mobileMenuOpen.value = true
}

function closeMobileMenu() {
  if (mobileSheet.value) mobileSheet.value.close()
  else mobileMenuOpen.value = false
}

function toggleSidebar() {
  desktopSidebar.value?.toggle()
}

function updateSidebarOpen(open) {
  sidebarOpen.value = open
}

function legacySidebarDefault() {
  if (typeof window === 'undefined') return true
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== 'true'
  } catch {
    return true
  }
}

function handleDesktopViewport(event) {
  if (event.matches) closeMobileMenu()
}

const defaultSidebarOpen = legacySidebarDefault()

provide('toggleMobileMenu', toggleMobileMenu)
provide('toggleSidebar', toggleSidebar)
provide('sidebarCollapsed', sidebarCollapsed)

onMounted(() => {
  desktopMediaQuery = window.matchMedia('(min-width: 768px)')
  desktopMediaQuery.addEventListener('change', handleDesktopViewport)
})

onUnmounted(() => {
  desktopMediaQuery?.removeEventListener('change', handleDesktopViewport)
})

watch(() => page.url, closeMobileMenu)
</script>

<template>
  <div
    class="flex h-screen min-h-0 overflow-hidden bg-white text-gray-900 dark:bg-gray-950 dark:text-white"
    data-test="bridge-workspace"
  >
    <Sheet
      id="bridge-navigation-mobile"
      ref="mobileSheet"
      v-model:open="mobileMenuOpen"
      aria-label="Bridge navigation"
      class="starting:open:-translate-x-full left-0 right-auto ml-0 mr-auto w-72 -translate-x-full border-none bg-gray-50 shadow-2xl dark:bg-gray-950 md:hidden"
    >
      <BridgeWorkspaceSidebar
        :app="page.props.app"
        :base-path="page.props.bridgeRequestBasePath"
        :workspace="page.props.bridgeWorkspace"
        class="h-full w-72"
        @navigate="closeMobileMenu"
      />
    </Sheet>

    <Sidebar
      id="bridge-navigation"
      ref="desktopSidebar"
      :default-open="defaultSidebarOpen"
      aria-label="Bridge navigation"
      class="hidden w-56 bg-gray-50 data-[state=closed]:w-0 data-[state=closed]:opacity-0 dark:bg-gray-950 md:flex"
      @update:open="updateSidebarOpen"
    >
      <BridgeWorkspaceSidebar
        :app="page.props.app"
        :base-path="page.props.bridgeRequestBasePath"
        :workspace="page.props.bridgeWorkspace"
        class="w-56"
      />
    </Sidebar>

    <main class="min-w-0 flex-1 overflow-hidden">
      <slot />
    </main>
  </div>
</template>
