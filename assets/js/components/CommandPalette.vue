<script setup>
import { ref, computed, watch, nextTick, inject, onMounted, onUnmounted } from 'vue'
import { router, usePage } from '@inertiajs/vue3'
import { useCommandPalette } from '@/composables/useCommandPalette'
import { useToast } from '@/composables/toast'
import { fuzzySearch } from '@/lib/fuzzySearch'

const { isOpen, history, register, unregister, getAll, execute, close } = useCommandPalette()
const toast = useToast()
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')

const query = ref('')
const selectedIndex = ref(0)
const inputRef = ref(null)
const resultsRef = ref(null)
const mode = ref('root')
const parentCommand = ref(null)

const page = usePage()
const currentUrl = computed(() => page.url)
const navProjects = computed(() => page.props.navProjects || [])
const navApps = computed(() => page.props.navApps || [])
const navServices = computed(() => page.props.navServices || [])

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
  children: () => navProjects.value.map(project => ({
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
  title: 'View Logs',
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
    navApps.value.forEach(app => {
      items.push({
        id: `nav.logs.app.${app.projectSlug}.${app.envSlug}.${app.slug}`,
        title: app.name,
        subtitle: `${app.projectName} / ${app.envName}`,
        keywords: [app.slug, app.projectName, app.envName],
        group: 'Apps',
        icon: 'server',
        action: () => router.visit(`/projects/${app.projectSlug}/environments/${app.envSlug}/apps/${app.slug}`)
      })
    })

    // Service logs
    navServices.value.forEach(service => {
      items.push({
        id: `nav.logs.service.${service.projectSlug}.${service.envSlug}.${service.id}`,
        title: `${service.name} (${service.type})`,
        subtitle: `${service.projectName} / ${service.envName}`,
        keywords: [service.name, service.type, service.projectName, service.envName],
        group: 'Services',
        icon: 'database',
        action: () => router.visit(`/projects/${service.projectSlug}/environments/${service.envSlug}/services/${service.id}`)
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
  action: () => window.open('https://github.com/sponsors/DominusKelvin', '_blank')
})

// ─── Action submenus (deploy, restart, stop, copy URL) ──────────────

register({
  id: 'action.deploy',
  title: 'Deploy App',
  keywords: ['deploy', 'build', 'ship', 'release', 'push'],
  group: 'Actions',
  icon: 'rocket',
  children: () => navApps.value.map(app => ({
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
          router.visit(`/projects/${app.projectSlug}/deployments/${data.deployment.id}`)
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
  children: () => navApps.value.map(app => ({
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
  children: () => navApps.value.map(app => ({
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
  children: () => navApps.value.filter(app => app.domain).map(app => ({
    id: `action.copy-url.${app.projectSlug}.${app.envSlug}.${app.slug}`,
    title: app.name,
    subtitle: `https://${app.domain}`,
    keywords: [app.slug, app.projectName, app.envName, app.domain],
    group: `${app.projectName} / ${app.envName}`,
    icon: 'clipboard',
    action: async () => {
      try {
        await navigator.clipboard.writeText(`https://${app.domain}`)
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
  children: () => navApps.value.map(app => ({
    id: `nav.env-vars.${app.projectSlug}.${app.envSlug}.${app.slug}`,
    title: app.name,
    subtitle: `${app.projectName} / ${app.envName}`,
    keywords: [app.slug, app.projectName, app.envName],
    group: `${app.projectName} / ${app.envName}`,
    icon: 'code',
    action: () => router.visit(`/projects/${app.projectSlug}/environments/${app.envSlug}/apps/${app.slug}/settings`)
  }))
})

register({
  id: 'nav.project-settings',
  title: 'Go to Project Settings',
  keywords: ['project', 'settings', 'configure'],
  group: 'Navigation',
  icon: 'settings',
  children: () => navProjects.value.map(project => ({
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

watch(navProjects, (projects) => {
  // Remove old project commands
  registeredProjectIds.value.forEach(id => unregister(id))

  // Register new ones
  const ids = projects.map(project => {
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
}, { immediate: true })

// ─── Dynamic app commands ───────────────────────────────────────────

const registeredAppIds = ref([])

watch(navApps, (apps) => {
  registeredAppIds.value.forEach(id => unregister(id))

  const ids = apps.map(app => {
    const id = `nav.app.${app.projectSlug}.${app.envSlug}.${app.slug}`
    register({
      id,
      title: app.name,
      keywords: [app.slug, app.projectName, app.envName],
      group: 'Apps',
      icon: 'server',
      action: () => router.visit(`/projects/${app.projectSlug}/environments/${app.envSlug}/apps/${app.slug}`)
    })
    return id
  })
  registeredAppIds.value = ids
}, { immediate: true })

// ─── Filtering & grouping ────────────────────────────────────────────

const allCommands = computed(() => {
  let cmds = getAll()
  // Context filtering based on current URL
  return cmds.filter(cmd => {
    if (!cmd.context) return true
    return cmd.context(currentUrl.value)
  })
})

const results = computed(() => {
  let cmds = mode.value === 'submenu' && parentCommand.value?.children
    ? parentCommand.value.children()
    : allCommands.value

  if (query.value) {
    cmds = fuzzySearch(query.value, cmds, c => c._searchText || c.title)
  }

  const groups = {}

  // Show recent first when no query
  if (!query.value && mode.value === 'root') {
    const recent = history.value
      .map(id => cmds.find(c => c.id === id))
      .filter(Boolean)
      .slice(0, 3)

    if (recent.length) {
      groups['Recent'] = recent
    }
  }

  // Group remaining by their group property
  cmds.forEach(cmd => {
    if (!query.value && history.value.includes(cmd.id)) return
    const group = cmd.group || 'Other'
    if (!groups[group]) groups[group] = []
    groups[group].push(cmd)
  })

  return groups
})

const flatResults = computed(() => Object.values(results.value).flat())

// ─── Keyboard navigation ─────────────────────────────────────────────

function handleKeydown(e) {
  // Global: toggle palette
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault()
    if (isOpen.value) {
      close()
    } else {
      isOpen.value = true
    }
    return
  }

  if (!isOpen.value) return

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault()
      selectedIndex.value = Math.min(selectedIndex.value + 1, flatResults.value.length - 1)
      scrollToSelected()
      break

    case 'ArrowUp':
      e.preventDefault()
      selectedIndex.value = Math.max(selectedIndex.value - 1, 0)
      scrollToSelected()
      break

    case 'Enter':
      e.preventDefault()
      if (flatResults.value[selectedIndex.value]) {
        selectCommand(flatResults.value[selectedIndex.value])
      }
      break

    case 'Escape':
      e.preventDefault()
      if (mode.value === 'submenu') {
        mode.value = 'root'
        parentCommand.value = null
        query.value = ''
      } else {
        close()
      }
      break

    case 'Backspace':
      if (!query.value && mode.value === 'submenu') {
        mode.value = 'root'
        parentCommand.value = null
      }
      break
  }
}

function scrollToSelected() {
  nextTick(() => {
    const container = resultsRef.value
    if (!container) return
    const selected = container.querySelector('[data-selected="true"]')
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' })
    }
  })
}

function selectCommand(cmd) {
  if (cmd.children) {
    mode.value = 'submenu'
    parentCommand.value = cmd
    query.value = ''
    selectedIndex.value = 0
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
    selectedIndex.value = 0
    mode.value = 'root'
    parentCommand.value = null
    nextTick(() => inputRef.value?.focus())
  }
})

watch(query, () => {
  selectedIndex.value = 0
})

// ─── Lifecycle ───────────────────────────────────────────────────────

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
})

// ─── Icons ───────────────────────────────────────────────────────────
// Using inline SVG paths to match codebase style (no emoji)

const icons = computed(() => ({
  folder: 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z',
  chart: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
  settings: 'M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75',
  globe: 'M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9',
  server: 'M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01',
  bell: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9',
  cloud: 'M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z',
  users: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z',
  key: 'M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z',
  download: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4',
  user: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
  plus: 'M12 4v16m8-8H4',
  book: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
  sidebar: {
    viewBox: '-0.5 -0.5 16 16',
    paths: sidebarCollapsed.value
      ? [
          'M12.777 14.285H2.223c-.833 0-1.508-.675-1.508-1.508V2.223c0-.833.675-1.508 1.508-1.508h10.554c.833 0 1.508.675 1.508 1.508v10.554c0 .833-.675 1.508-1.508 1.508Z',
          'M5.615 14.285V.715',
          'M2.6 5.992 3.919 7.5 2.6 9.008'
        ]
      : [
          'M12.777 14.285H2.223c-.833 0-1.508-.675-1.508-1.508V2.223c0-.833.675-1.508 1.508-1.508h10.554c.833 0 1.508.675 1.508 1.508v10.554c0 .833-.675 1.508-1.508 1.508Z',
          'M5.615 14.285V.715',
          'M3.919 5.992 2.6 7.5l1.319 1.508'
        ]
  },
  database: 'M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4',
  heart: 'M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z',
  logout: 'M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1',
  rocket: 'M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.63 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z',
  refresh: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15',
  stop: 'M5.25 7.5A2.25 2.25 0 017.5 5.25h9a2.25 2.25 0 012.25 2.25v9a2.25 2.25 0 01-2.25 2.25h-9a2.25 2.25 0 01-2.25-2.25v-9z',
  clipboard: 'M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184',
  code: 'M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5',
  terminal: 'M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z',
  search: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z',
  chevronRight: 'M9 5l7 7-7 7'
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
        <div class="absolute inset-0 bg-black/50 backdrop-blur-sm" @click="close()" />

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
          <div class="relative w-full max-w-lg rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900">
            <!-- Search input -->
            <div class="flex items-center border-b border-gray-100 px-4 dark:border-gray-800">
              <svg class="h-4 w-4 shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="icons.search" />
              </svg>
              <input
                ref="inputRef"
                v-model="query"
                type="text"
                class="w-full bg-transparent px-3 py-3.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:text-white dark:placeholder-gray-500"
                :placeholder="mode === 'submenu' ? parentCommand?.title + '...' : 'Type a command or search...'"
              />
              <kbd class="hidden shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-400 dark:bg-gray-800 dark:text-gray-500 sm:inline">
                ESC
              </kbd>
            </div>

            <!-- Results -->
            <div ref="resultsRef" class="max-h-72 overflow-y-auto overscroll-contain p-1.5">
              <!-- Breadcrumb for submenu -->
              <div v-if="mode === 'submenu'" class="mb-1 flex items-center gap-1 px-2 py-1 text-xs text-gray-400 dark:text-gray-500">
                <button @click="mode = 'root'; parentCommand = null; query = ''" class="hover:text-gray-600 dark:hover:text-gray-300">
                  Commands
                </button>
                <svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="icons.chevronRight" />
                </svg>
                <span class="text-gray-600 dark:text-gray-300">{{ parentCommand?.title }}</span>
              </div>

              <template v-for="(commands, group) in results" :key="group">
                <div class="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">
                  {{ group }}
                </div>
                <button
                  v-for="cmd in commands"
                  :key="cmd.id"
                  @click="selectCommand(cmd)"
                  @mouseenter="selectedIndex = flatResults.indexOf(cmd)"
                  :data-selected="flatResults.indexOf(cmd) === selectedIndex"
                  :class="[
                    'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                    cmd.destructive
                      ? flatResults.indexOf(cmd) === selectedIndex
                        ? 'bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400'
                        : 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/50'
                      : flatResults.indexOf(cmd) === selectedIndex
                        ? 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-white'
                        : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800/50'
                  ]"
                >
                  <span :class="['flex h-7 w-7 shrink-0 items-center justify-center rounded-md', cmd.destructive ? 'bg-red-50 dark:bg-red-950' : 'bg-gray-100 dark:bg-gray-800']">
                    <svg v-if="typeof icons[cmd.icon] === 'object'" :class="['h-3.5 w-3.5', cmd.destructive ? 'text-red-500 dark:text-red-400' : 'text-gray-500 dark:text-gray-400']" fill="none" stroke="currentColor" :viewBox="icons[cmd.icon].viewBox">
                      <path v-for="(d, i) in icons[cmd.icon].paths" :key="i" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" :d="d" />
                    </svg>
                    <svg v-else :class="['h-3.5 w-3.5', cmd.destructive ? 'text-red-500 dark:text-red-400' : 'text-gray-500 dark:text-gray-400']" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" :d="icons[cmd.icon] || icons.folder" />
                    </svg>
                  </span>
                  <span class="flex min-w-0 flex-1 flex-col">
                    <span class="truncate">{{ cmd.title }}</span>
                    <span v-if="cmd.subtitle" class="truncate text-xs text-gray-400 dark:text-gray-500">{{ cmd.subtitle }}</span>
                  </span>
                  <svg v-if="cmd.children" class="h-3.5 w-3.5 shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="icons.chevronRight" />
                  </svg>
                </button>
              </template>

              <!-- Empty state -->
              <div v-if="!flatResults.length && query" class="py-10 text-center">
                <svg class="mx-auto h-6 w-6 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" :d="icons.search" />
                </svg>
                <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">No results for "{{ query }}"</p>
              </div>
            </div>

            <!-- Footer -->
            <div class="flex items-center gap-4 border-t border-gray-100 px-4 py-2 text-[11px] text-gray-400 dark:border-gray-800 dark:text-gray-500">
              <span class="flex items-center gap-1">
                <kbd class="rounded bg-gray-100 px-1 py-0.5 font-mono dark:bg-gray-800">&uarr;&darr;</kbd>
                navigate
              </span>
              <span class="flex items-center gap-1">
                <kbd class="rounded bg-gray-100 px-1 py-0.5 font-mono dark:bg-gray-800">&crarr;</kbd>
                select
              </span>
              <span class="flex items-center gap-1">
                <kbd class="rounded bg-gray-100 px-1 py-0.5 font-mono dark:bg-gray-800">esc</kbd>
                close
              </span>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>
