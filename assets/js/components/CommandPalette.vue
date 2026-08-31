<script setup>
import Command from '@/components/ui/command/Command.vue'
import Bell from '@/components/ui/icons/Bell.vue'
import BookOpen from '@/components/ui/icons/BookOpen.vue'
import ChartBar from '@/components/ui/icons/ChartBar.vue'
import ChevronRight from '@/components/ui/icons/ChevronRight.vue'
import CloudUpload from '@/components/ui/icons/CloudUpload.vue'
import Code from '@/components/ui/icons/Code.vue'
import Copy from '@/components/ui/icons/Copy.vue'
import Database from '@/components/ui/icons/Database.vue'
import Download from '@/components/ui/icons/Download.vue'
import Folder from '@/components/ui/icons/Folder.vue'
import Globe from '@/components/ui/icons/Globe.vue'
import Heart from '@/components/ui/icons/Heart.vue'
import Key from '@/components/ui/icons/Key.vue'
import Plus from '@/components/ui/icons/Plus.vue'
import Refresh from '@/components/ui/icons/Refresh.vue'
import Rocket from '@/components/ui/icons/Rocket.vue'
import Search from '@/components/ui/icons/Search.vue'
import Server from '@/components/ui/icons/Server.vue'
import Settings from '@/components/ui/icons/Settings.vue'
import SidebarClose from '@/components/ui/icons/SidebarClose.vue'
import SidebarOpen from '@/components/ui/icons/SidebarOpen.vue'
import SignOut from '@/components/ui/icons/SignOut.vue'
import Stop from '@/components/ui/icons/Stop.vue'
import Terminal from '@/components/ui/icons/Terminal.vue'
import User from '@/components/ui/icons/User.vue'
import Users from '@/components/ui/icons/Users.vue'
import {
  ref,
  computed,
  watch,
  nextTick,
  inject,
  onMounted,
  onUnmounted
} from 'vue'
import { router, usePage } from '@inertiajs/vue3'
import { useCommandPalette } from '@/composables/useCommandPalette'
import { useToast } from '@/composables/toast'
import { fuzzySearch } from '@/lib/fuzzySearch'
import { LOCAL_STORAGE_KEYS } from '@/lib/localStorageKeys'

const { isOpen, history, register, unregister, getAll, execute, open, close } =
  useCommandPalette()
const toast = useToast()
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')

const query = ref('')
const commandRef = ref(null)
const mode = ref('root')
const parentCommand = ref(null)

const page = usePage()
const currentUrl = computed(() => page.url)
const navProjects = computed(() => page.props.navProjects || [])
const navApps = computed(() => page.props.navApps || [])
const navServices = computed(() => page.props.navServices || [])

function returnToRootMode() {
  mode.value = 'root'
  parentCommand.value = null
  query.value = ''
}

// ─── Register core commands ──────────────────────────────────────────

register({
  id: 'nav.projects',
  title: 'Go to Projects',
  keywords: ['dashboard', 'home', 'apps'],
  group: 'Navigation',
  icon: 'folder',
  action: () => router.visit('/')
})

register({
  id: 'nav.lookout',
  title: 'Go to Lookout',
  keywords: ['monitoring', 'metrics', 'observability', 'cpu', 'memory'],
  group: 'Navigation',
  icon: 'chart',
  children: () =>
    navProjects.value.map((project) => ({
      id: `nav.lookout.${project.slug}`,
      title: project.name,
      keywords: [project.slug],
      group: 'Projects',
      icon: 'chart',
      action: () => router.visit(`/projects/${project.slug}/lookout`)
    }))
})

register({
  id: 'nav.settings',
  title: 'Go to Settings',
  keywords: ['preferences', 'config', 'configuration'],
  group: 'Navigation',
  icon: 'settings',
  action: () => router.visit('/settings')
})

register({
  id: 'nav.settings.global-env',
  title: 'Global Environment Variables',
  keywords: ['env', 'variables', 'secrets', 'environment'],
  group: 'Navigation',
  icon: 'globe',
  action: () => router.visit('/settings/global-env')
})

register({
  id: 'nav.settings.instance',
  title: 'Instance Settings',
  keywords: ['domain', 'server', 'hostname'],
  group: 'Navigation',
  icon: 'server',
  action: () => router.visit('/settings/instance')
})

register({
  id: 'nav.settings.notifications',
  title: 'Notification Settings',
  keywords: ['telegram', 'email', 'alerts', 'smtp'],
  group: 'Navigation',
  icon: 'bell',
  action: () => router.visit('/settings/notifications')
})

register({
  id: 'nav.settings.uploads',
  title: 'File Storage Settings',
  keywords: ['s3', 'r2', 'storage', 'uploads', 'backup'],
  group: 'Navigation',
  icon: 'cloud',
  action: () => router.visit('/settings/uploads')
})

register({
  id: 'nav.settings.team-profile',
  title: 'Team Profile',
  keywords: ['team', 'name', 'logo', 'organization'],
  group: 'Navigation',
  icon: 'users',
  action: () => router.visit('/settings/team-profile')
})

register({
  id: 'nav.settings.team',
  title: 'Team Members',
  keywords: ['invite', 'users', 'members', 'roles'],
  group: 'Navigation',
  icon: 'users',
  action: () => router.visit('/settings/team')
})

register({
  id: 'nav.settings.cli-tokens',
  title: 'CLI Tokens',
  keywords: ['api', 'keys', 'tokens', 'authentication'],
  group: 'Navigation',
  icon: 'key',
  action: () => router.visit('/settings/cli-tokens')
})

register({
  id: 'nav.settings.update',
  title: 'System Updates',
  keywords: ['version', 'update', 'upgrade'],
  group: 'Navigation',
  icon: 'download',
  action: () => router.visit('/settings/update')
})

register({
  id: 'nav.profile',
  title: 'Profile',
  keywords: ['account', 'user', 'email', 'password'],
  group: 'Navigation',
  icon: 'user',
  action: () => router.visit('/profile')
})

register({
  id: 'nav.new-project',
  title: 'Create New Project',
  keywords: ['new', 'create', 'add', 'project'],
  group: 'Actions',
  icon: 'plus',
  action: () => router.visit('/projects/new')
})

register({
  id: 'action.docs',
  title: 'Open Documentation',
  keywords: ['docs', 'help', 'guide', 'manual'],
  group: 'Actions',
  icon: 'book',
  action: () => window.open('https://docs.sailscasts.com/slipway', '_blank')
})

register({
  id: 'action.toggle-sidebar',
  title: 'Toggle Sidebar',
  keywords: ['sidebar', 'panel', 'collapse', 'expand', 'hide', 'show'],
  group: 'Actions',
  icon: 'sidebar',
  action: () => toggleSidebar()
})

register({
  id: 'nav.bosun',
  title: 'Go to Bosun',
  keywords: ['bosun', 'database', 'sql', 'console', 'query'],
  group: 'Navigation',
  icon: 'database',
  action: () => router.visit('/bosun')
})

register({
  id: 'nav.logs',
  title: 'Go to Logs',
  keywords: ['logs', 'output', 'stdout', 'stderr', 'console', 'tail', 'stream'],
  group: 'Navigation',
  icon: 'terminal',
  children: () => {
    const items = []

    // Bosun (instance) logs — always first
    items.push({
      id: 'nav.logs.bosun',
      title: 'Slipway instance',
      keywords: ['bosun', 'instance', 'system'],
      group: 'Instance',
      icon: 'terminal',
      action: () => router.visit('/bosun?logs=1')
    })

    // App logs
    navApps.value.forEach((app) => {
      items.push({
        id: `nav.logs.app.${app.projectSlug}.${app.envSlug}.${app.slug}`,
        title: app.name,
        subtitle: `${app.projectName} / ${app.envName}`,
        keywords: [app.slug, app.projectName, app.envName],
        group: 'Apps',
        icon: 'server',
        action: () =>
          router.visit(
            `/projects/${app.projectSlug}/environments/${app.envSlug}/apps/${app.slug}`
          )
      })
    })

    // Service logs
    navServices.value.forEach((service) => {
      items.push({
        id: `nav.logs.service.${service.projectSlug}.${service.envSlug}.${service.id}`,
        title: `${service.name} (${service.type})`,
        subtitle: `${service.projectName} / ${service.envName}`,
        keywords: [
          service.name,
          service.type,
          service.projectName,
          service.envName
        ],
        group: 'Services',
        icon: 'database',
        action: () =>
          router.visit(
            `/projects/${service.projectSlug}/environments/${service.envSlug}/services/${service.id}`
          )
      })
    })

    return items
  }
})

register({
  id: 'action.logout',
  title: 'Sign out',
  keywords: ['logout', 'sign out', 'exit'],
  group: 'Actions',
  icon: 'logout',
  destructive: true,
  action: () => router.delete('/logout')
})

register({
  id: 'action.sponsor',
  title: 'Sponsor Slipway',
  keywords: ['sponsor', 'donate', 'support', 'funding'],
  group: 'Actions',
  icon: 'heart',
  action: () =>
    window.open('https://github.com/sponsors/DominusKelvin', '_blank')
})

// ─── Action submenus (deploy, restart, stop, copy URL) ──────────────

register({
  id: 'action.deploy',
  title: 'Deploy App',
  keywords: ['deploy', 'build', 'ship', 'release', 'push'],
  group: 'Actions',
  icon: 'rocket',
  children: () =>
    navApps.value.map((app) => ({
      id: `action.deploy.${app.projectSlug}.${app.envSlug}.${app.slug}`,
      title: app.name,
      subtitle: `${app.projectName} / ${app.envName}`,
      keywords: [app.slug, app.projectName, app.envName],
      group: `${app.projectName} / ${app.envName}`,
      icon: 'rocket',
      action: async () => {
        try {
          const res = await fetch(
            `/api/v1/projects/${app.projectSlug}/environments/${app.envSlug}/apps/${app.slug}/deploy`,
            { method: 'POST', headers: { 'Content-Type': 'application/json' } }
          )
          const data = await res.json()
          if (data.deployment) {
            router.visit(
              `/projects/${app.projectSlug}/deployments/${data.deployment.id}`
            )
          } else {
            toast({ message: `Failed to deploy ${app.name}`, type: 'error' })
          }
        } catch {
          toast({ message: `Failed to deploy ${app.name}`, type: 'error' })
        }
      }
    }))
})

register({
  id: 'action.restart',
  title: 'Restart App',
  keywords: ['restart', 'reboot', 'reload'],
  group: 'Actions',
  icon: 'refresh',
  children: () =>
    navApps.value.map((app) => ({
      id: `action.restart.${app.projectSlug}.${app.envSlug}.${app.slug}`,
      title: app.name,
      subtitle: `${app.projectName} / ${app.envName}`,
      keywords: [app.slug, app.projectName, app.envName],
      group: `${app.projectName} / ${app.envName}`,
      icon: 'refresh',
      action: async () => {
        try {
          await fetch(
            `/api/v1/projects/${app.projectSlug}/environments/${app.envSlug}/apps/${app.slug}/restart`,
            { method: 'POST', headers: { 'Content-Type': 'application/json' } }
          )
          toast({ message: `${app.name} restarted`, type: 'success' })
        } catch {
          toast({ message: `Failed to restart ${app.name}`, type: 'error' })
        }
      }
    }))
})

register({
  id: 'action.stop',
  title: 'Stop App',
  keywords: ['stop', 'shutdown', 'kill', 'halt'],
  group: 'Actions',
  icon: 'stop',
  destructive: true,
  children: () =>
    navApps.value.map((app) => ({
      id: `action.stop.${app.projectSlug}.${app.envSlug}.${app.slug}`,
      title: app.name,
      subtitle: `${app.projectName} / ${app.envName}`,
      keywords: [app.slug, app.projectName, app.envName],
      group: `${app.projectName} / ${app.envName}`,
      icon: 'stop',
      destructive: true,
      action: async () => {
        try {
          await fetch(
            `/api/v1/projects/${app.projectSlug}/environments/${app.envSlug}/apps/${app.slug}/stop`,
            { method: 'POST', headers: { 'Content-Type': 'application/json' } }
          )
          toast({ message: `${app.name} stopped`, type: 'success' })
        } catch {
          toast({ message: `Failed to stop ${app.name}`, type: 'error' })
        }
      }
    }))
})

register({
  id: 'action.copy-app-url',
  title: 'Copy App URL',
  keywords: ['copy', 'url', 'link', 'domain', 'clipboard'],
  group: 'Actions',
  icon: 'clipboard',
  children: () =>
    navApps.value
      .filter((app) => app.url)
      .map((app) => ({
        id: `action.copy-url.${app.projectSlug}.${app.envSlug}.${app.slug}`,
        title: app.name,
        subtitle: app.url,
        keywords: [app.slug, app.projectName, app.envName, app.url],
        group: `${app.projectName} / ${app.envName}`,
        icon: 'clipboard',
        action: async () => {
          try {
            await navigator.clipboard.writeText(app.url)
            toast({ message: `Copied URL for ${app.name}`, type: 'success' })
          } catch {
            toast({ message: 'Failed to copy URL', type: 'error' })
          }
        }
      }))
})

// ─── Navigation submenus ────────────────────────────────────────────

register({
  id: 'nav.app-env-vars',
  title: 'Go to App Env Vars',
  keywords: ['env', 'variables', 'secrets', 'environment', 'config'],
  group: 'Navigation',
  icon: 'code',
  children: () =>
    navApps.value.map((app) => ({
      id: `nav.env-vars.${app.projectSlug}.${app.envSlug}.${app.slug}`,
      title: app.name,
      subtitle: `${app.projectName} / ${app.envName}`,
      keywords: [app.slug, app.projectName, app.envName],
      group: `${app.projectName} / ${app.envName}`,
      icon: 'code',
      action: () =>
        router.visit(
          `/projects/${app.projectSlug}/environments/${app.envSlug}/apps/${app.slug}/settings`
        )
    }))
})

register({
  id: 'nav.project-settings',
  title: 'Go to Project Settings',
  keywords: ['project', 'settings', 'configure'],
  group: 'Navigation',
  icon: 'settings',
  children: () =>
    navProjects.value.map((project) => ({
      id: `nav.project-settings.${project.slug}`,
      title: project.name,
      keywords: [project.slug],
      group: 'Projects',
      icon: 'settings',
      action: () => router.visit(`/projects/${project.slug}/settings`)
    }))
})

// ─── Dynamic project commands ───────────────────────────────────────

const registeredProjectIds = ref([])

watch(
  navProjects,
  (projects) => {
    // Remove old project commands
    registeredProjectIds.value.forEach((id) => unregister(id))

    // Register new ones
    const ids = projects.map((project) => {
      const id = `nav.project.${project.slug}`
      register({
        id,
        title: project.name,
        keywords: [project.slug],
        group: 'Projects',
        icon: 'folder',
        action: () => router.visit(`/projects/${project.slug}`)
      })
      return id
    })
    registeredProjectIds.value = ids
  },
  { immediate: true }
)

// ─── Dynamic app commands ───────────────────────────────────────────

const registeredAppIds = ref([])

watch(
  navApps,
  (apps) => {
    registeredAppIds.value.forEach((id) => unregister(id))

    const ids = apps.map((app) => {
      const id = `nav.app.${app.projectSlug}.${app.envSlug}.${app.slug}`
      register({
        id,
        title: app.name,
        keywords: [app.slug, app.projectName, app.envName],
        group: 'Apps',
        icon: 'server',
        action: () =>
          router.visit(
            `/projects/${app.projectSlug}/environments/${app.envSlug}/apps/${app.slug}`
          )
      })
      return id
    })
    registeredAppIds.value = ids
  },
  { immediate: true }
)

// ─── Filtering & grouping ────────────────────────────────────────────

const allCommands = computed(() => {
  let cmds = getAll()
  // Context filtering based on current URL
  return cmds.filter((cmd) => {
    if (!cmd.context) return true
    return cmd.context(currentUrl.value)
  })
})

const results = computed(() => {
  let cmds =
    mode.value === 'submenu' && parentCommand.value?.children
      ? parentCommand.value.children()
      : allCommands.value

  if (query.value) {
    cmds = fuzzySearch(query.value, cmds, (c) => c._searchText || c.title)
  }

  const groups = {}

  // Show recent first when no query
  if (!query.value && mode.value === 'root') {
    const recent = history.value
      .map((id) => cmds.find((c) => c.id === id))
      .filter(Boolean)
      .slice(0, 3)

    if (recent.length) {
      groups['Recent'] = recent
    }
  }

  // Group remaining by their group property
  cmds.forEach((cmd) => {
    if (!query.value && mode.value === 'root' && history.value.includes(cmd.id))
      return
    const group = cmd.group || 'Other'
    if (!groups[group]) groups[group] = []
    groups[group].push(cmd)
  })

  return groups
})

// ─── Keyboard navigation ─────────────────────────────────────────────

function handleGlobalKeydown(e) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault()
    if (isOpen.value) {
      close()
    } else {
      open()
    }
  }
}

function handleCommandKeydown(event) {
  if (event.key !== 'Escape' || event.isComposing || event.keyCode === 229) {
    return
  }

  event.preventDefault()
  event.stopPropagation()
  if (mode.value === 'submenu') {
    returnToRootMode()
  } else {
    close()
  }
}

function handleCommandBack(event) {
  if (mode.value !== 'submenu') return
  event.preventDefault()
  returnToRootMode()
}

function selectCommand(cmd) {
  if (cmd.children) {
    // Track parent commands in history so they appear in Recent
    history.value = [
      cmd.id,
      ...history.value.filter((h) => h !== cmd.id)
    ].slice(0, 10)
    localStorage.setItem(
      LOCAL_STORAGE_KEYS.commandHistory,
      JSON.stringify(history.value)
    )
    mode.value = 'submenu'
    parentCommand.value = cmd
    query.value = ''
  } else {
    query.value = ''
    mode.value = 'root'
    parentCommand.value = null
    execute(cmd)
  }
}

// ─── State watchers ──────────────────────────────────────────────────

watch(isOpen, (open) => {
  if (open) {
    query.value = ''
    mode.value = 'root'
    parentCommand.value = null
    nextTick(() => commandRef.value?.focus())
  }
})

// ─── Lifecycle ───────────────────────────────────────────────────────

onMounted(() => {
  document.addEventListener('keydown', handleGlobalKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleGlobalKeydown)
})

// ─── Icons ───────────────────────────────────────────────────────────

const iconComponents = computed(() => ({
  bell: Bell,
  book: BookOpen,
  chart: ChartBar,
  clipboard: Copy,
  cloud: CloudUpload,
  code: Code,
  database: Database,
  download: Download,
  folder: Folder,
  globe: Globe,
  heart: Heart,
  key: Key,
  logout: SignOut,
  plus: Plus,
  refresh: Refresh,
  rocket: Rocket,
  server: Server,
  settings: Settings,
  sidebar: sidebarCollapsed.value ? SidebarOpen : SidebarClose,
  stop: Stop,
  terminal: Terminal,
  user: User,
  users: Users
}))
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-100 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="isOpen"
        class="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
      >
        <!-- Backdrop -->
        <div
          class="absolute inset-0 bg-black/50 backdrop-blur-sm"
          @click="close()"
        />

        <!-- Palette -->
        <Transition
          enter-active-class="transition duration-150 ease-out"
          enter-from-class="opacity-0 scale-95 translate-y-2"
          enter-to-class="opacity-100 scale-100 translate-y-0"
          leave-active-class="transition duration-100 ease-in"
          leave-from-class="opacity-100 scale-100 translate-y-0"
          leave-to-class="opacity-0 scale-95 translate-y-2"
          appear
        >
          <Command
            ref="commandRef"
            :groups="results"
            :query="query"
            label="Slipway commands"
            :placeholder="
              mode === 'submenu'
                ? parentCommand?.title + '...'
                : 'Type a command or search...'
            "
            class="relative w-full max-w-lg rounded-xl border-gray-200 bg-white text-gray-950 shadow-2xl dark:border-gray-700 dark:bg-gray-900 dark:text-white [&_[data-slot=command-group-heading]]:text-gray-400 dark:[&_[data-slot=command-group-heading]]:text-gray-500 [&_[data-slot=command-input]:focus-visible]:outline-none [&_[data-slot=command-input]]:py-3.5 [&_[data-slot=command-input]]:text-sm [&_[data-slot=command-input]]:placeholder:text-gray-400 dark:[&_[data-slot=command-input]]:placeholder:text-gray-500 [&_[data-slot=command-item][data-destructive][data-highlighted]]:bg-red-50 dark:[&_[data-slot=command-item][data-destructive][data-highlighted]]:bg-red-950 [&_[data-slot=command-item][data-destructive]]:text-red-600 dark:[&_[data-slot=command-item][data-destructive]]:text-red-400 [&_[data-slot=command-item][data-highlighted]]:bg-gray-100 [&_[data-slot=command-item][data-highlighted]]:text-gray-900 dark:[&_[data-slot=command-item][data-highlighted]]:bg-gray-800 dark:[&_[data-slot=command-item][data-highlighted]]:text-white [&_[data-slot=command-item]]:rounded-lg [&_[data-slot=command-item]]:px-2.5 [&_[data-slot=command-item]]:text-gray-700 [&_[data-slot=command-item]]:transition-colors dark:[&_[data-slot=command-item]]:text-gray-300 [&_[data-slot=command-search]]:border-gray-100 dark:[&_[data-slot=command-search]]:border-gray-800"
            @update:query="query = $event"
            @select="selectCommand"
            @keydown="handleCommandKeydown"
            @back="handleCommandBack"
          >
            <template #prefix>
              <Search
                class="mr-3 h-4 w-4 shrink-0 text-gray-400"
                stroke-width="2"
              />
            </template>

            <template #suffix>
              <kbd
                class="hidden shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-400 dark:bg-gray-800 dark:text-gray-500 sm:inline"
              >
                ESC
              </kbd>
            </template>

            <template #before>
              <div
                v-if="mode === 'submenu'"
                class="mx-1.5 mt-1.5 flex items-center gap-1 px-2 py-1 text-xs text-gray-400 dark:text-gray-500"
              >
                <button
                  type="button"
                  @click="returnToRootMode"
                  class="hover:text-gray-600 dark:hover:text-gray-300"
                >
                  Commands
                </button>
                <ChevronRight class="h-3 w-3" stroke-width="2" />
                <span class="text-gray-600 dark:text-gray-300">{{
                  parentCommand?.title
                }}</span>
              </div>
            </template>

            <template #item="{ command: cmd }">
              <span
                :class="[
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
                  cmd.destructive
                    ? 'bg-red-50 dark:bg-red-950'
                    : 'bg-gray-100 dark:bg-gray-800'
                ]"
              >
                <component
                  :is="iconComponents[cmd.icon] || Folder"
                  :class="[
                    'h-3.5 w-3.5',
                    cmd.destructive
                      ? 'text-red-500 dark:text-red-400'
                      : 'text-gray-500 dark:text-gray-400'
                  ]"
                />
              </span>
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="truncate">{{ cmd.title }}</span>
                <span
                  v-if="cmd.subtitle"
                  class="truncate text-xs text-gray-400 dark:text-gray-500"
                  >{{ cmd.subtitle }}</span
                >
              </span>
              <ChevronRight
                v-if="cmd.children"
                class="h-3.5 w-3.5 shrink-0 text-gray-400"
                stroke-width="2"
              />
            </template>

            <template #empty>
              <Search
                class="mx-auto h-6 w-6 text-gray-300 dark:text-gray-600"
              />
              <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
                No results for "{{ query }}"
              </p>
            </template>

            <template #footer>
              <div
                class="flex items-center gap-4 border-t border-gray-100 px-4 py-2 text-[11px] text-gray-400 dark:border-gray-800 dark:text-gray-500"
              >
                <span class="flex items-center gap-1">
                  <kbd
                    class="rounded bg-gray-100 px-1 py-0.5 font-mono dark:bg-gray-800"
                    >&uarr;&darr;</kbd
                  >
                  navigate
                </span>
                <span class="flex items-center gap-1">
                  <kbd
                    class="rounded bg-gray-100 px-1 py-0.5 font-mono dark:bg-gray-800"
                    >&crarr;</kbd
                  >
                  select
                </span>
                <span class="flex items-center gap-1">
                  <kbd
                    class="rounded bg-gray-100 px-1 py-0.5 font-mono dark:bg-gray-800"
                    >esc</kbd
                  >
                  close
                </span>
              </div>
            </template>
          </Command>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>
