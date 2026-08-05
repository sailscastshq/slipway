<script setup>
import { usePage } from '@inertiajs/vue3'
import { onMounted, onUnmounted, provide, ref } from 'vue'
import BridgeWorkspaceSidebar from '@/components/bridge/BridgeWorkspaceSidebar.vue'

const STORAGE_KEY = 'slipway:bridge-sidebar-collapsed'
const page = usePage()
const mobileMenuOpen = ref(false)
const sidebarCollapsed = ref(false)

function toggleMobileMenu() {
  mobileMenuOpen.value = !mobileMenuOpen.value
}

function closeMobileMenu() {
  mobileMenuOpen.value = false
}

function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value
  localStorage.setItem(STORAGE_KEY, String(sidebarCollapsed.value))
}

function handleKeydown(event) {
  if (event.key === 'Escape') closeMobileMenu()
}

provide('toggleMobileMenu', toggleMobileMenu)
provide('toggleSidebar', toggleSidebar)
provide('sidebarCollapsed', sidebarCollapsed)

onMounted(() => {
  sidebarCollapsed.value = localStorage.getItem(STORAGE_KEY) === 'true'
  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <div
    class="flex h-screen min-h-0 overflow-hidden bg-white text-gray-900 dark:bg-gray-950 dark:text-white"
    data-test="bridge-workspace"
  >
    <Transition
      enter-active-class="transition-opacity duration-300"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition-opacity duration-300"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <button
        v-if="mobileMenuOpen"
        type="button"
        class="fixed inset-0 z-40 bg-black/50 md:hidden"
        aria-label="Close Bridge navigation"
        @click="closeMobileMenu"
      ></button>
    </Transition>

    <Transition
      enter-active-class="transition-transform duration-300 ease-out"
      enter-from-class="-translate-x-full"
      enter-to-class="translate-x-0"
      leave-active-class="transition-transform duration-300 ease-in"
      leave-from-class="translate-x-0"
      leave-to-class="-translate-x-full"
    >
      <BridgeWorkspaceSidebar
        v-if="mobileMenuOpen"
        :app="page.props.app"
        :base-path="page.props.bridgeRequestBasePath"
        :workspace="page.props.bridgeWorkspace"
        class="fixed inset-y-0 left-0 z-50 w-72 shadow-2xl md:hidden"
        @navigate="closeMobileMenu"
      />
    </Transition>

    <BridgeWorkspaceSidebar
      :app="page.props.app"
      :base-path="page.props.bridgeRequestBasePath"
      :workspace="page.props.bridgeWorkspace"
      :class="[
        'hidden shrink-0 transition-[width,border] duration-200 ease-out md:flex',
        sidebarCollapsed ? 'w-0 overflow-hidden border-r-0' : 'w-56'
      ]"
    />

    <main class="min-w-0 flex-1 overflow-hidden">
      <slot />
    </main>
  </div>
</template>
