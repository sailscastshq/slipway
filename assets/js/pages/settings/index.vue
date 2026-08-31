<script setup>
import Users from '@/components/ui/icons/Users.vue'
import SidebarOpen from '@/components/ui/icons/SidebarOpen.vue'
import SidebarClose from '@/components/ui/icons/SidebarClose.vue'
import ShieldCheck from '@/components/ui/icons/ShieldCheck.vue'
import Refresh from '@/components/ui/icons/Refresh.vue'
import Key from '@/components/ui/icons/Key.vue'
import Globe from '@/components/ui/icons/Globe.vue'
import ExternalLink from '@/components/ui/icons/ExternalLink.vue'
import CloudUpload from '@/components/ui/icons/CloudUpload.vue'
import Building from '@/components/ui/icons/Building.vue'
import Input from '@/components/ui/input/Input.vue'
import { Link, Head, usePage } from '@inertiajs/vue3'
import { inject, ref, computed } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'
import Bell from '@/components/ui/icons/Bell.vue'
import ChevronRight from '@/components/ui/icons/ChevronRight.vue'
import Server from '@/components/ui/icons/Server.vue'

defineOptions({
  layout: AppLayout
})

const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')
const page = usePage()

const search = ref('')
const canManage = computed(() =>
  ['owner', 'admin'].includes(page.props.loggedInUser?.teamRole)
)

const rawCategories = [
  {
    name: 'Instance',
    items: [
      {
        title: 'Instance',
        description: 'Configure your Slipway instance domain and branding.',
        href: '/settings/instance',
        icon: 'server'
      },
      {
        title: 'File Storage',
        description:
          'S3-compatible storage for team logos and database backups.',
        href: '/settings/uploads',
        icon: 'cloud'
      },
      {
        title: 'Notifications',
        description: 'Deployment alerts via Telegram and email.',
        href: '/settings/notifications',
        icon: 'bell'
      },
      {
        title: 'Global Environment',
        description:
          'Instance-wide variables injected into all deployed applications.',
        href: '/settings/global-env',
        icon: 'globe'
      }
    ]
  },
  {
    name: 'Team',
    items: [
      {
        title: 'Team Profile',
        description: 'Customize your team name and logo.',
        href: '/settings/team-profile',
        icon: 'building'
      },
      {
        title: 'Team Members',
        description: 'Invite and manage who has access to your team.',
        href: '/settings/team',
        icon: 'users'
      }
    ]
  },
  {
    name: 'Developer',
    items: [
      {
        title: 'Git',
        description:
          'Connect GitHub for push-to-deploy and manage deploy tokens.',
        href: '/settings/git',
        icon: 'git'
      },
      {
        title: 'CLI Tokens',
        description: 'Manage tokens used to authenticate the Slipway CLI.',
        href: '/settings/cli-tokens',
        icon: 'key'
      }
    ]
  },
  {
    name: 'System',
    items: [
      {
        title: 'Updates',
        description:
          'Check for Slipway updates and view installation instructions.',
        href: '/settings/update',
        icon: 'update'
      },
      {
        title: 'Audit Log',
        description:
          'Search operational events, production Helm runs, and write arms.',
        href: '/settings/audit-log',
        icon: 'audit',
        adminOnly: true
      }
    ]
  }
]

const filteredCategories = computed(() => {
  const q = search.value.toLowerCase().trim()
  const categories = rawCategories
    .map((category) => ({
      ...category,
      items: category.items.filter((item) => !item.adminOnly || canManage.value)
    }))
    .filter((category) => category.items.length > 0)
  if (!q) return categories

  return categories
    .map((cat) => ({
      ...cat,
      items: cat.items.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q)
      )
    }))
    .filter((cat) => cat.items.length > 0)
})
</script>
<template>
  <Head title="Settings | Slipway"></Head>
  <div class="flex h-full flex-col">
    <!-- Header -->
    <div
      class="flex items-center justify-between border-b border-gray-200 py-4 pl-4 pr-4 dark:border-gray-800 sm:pl-4 sm:pr-8"
    >
      <div class="flex items-center space-x-3">
        <!-- Mobile menu button -->
        <button
          @click="toggleMobileMenu"
          class="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white md:hidden"
        >
          <SidebarOpen class="h-5 w-5" stroke-width="1" />
        </button>
        <!-- Desktop sidebar toggle -->
        <button
          @click="toggleSidebar"
          class="hidden text-gray-400 dark:text-gray-500 md:block"
        >
          <SidebarOpen
            v-if="sidebarCollapsed"
            class="h-5 w-5"
            stroke-width="1"
          />
          <SidebarClose v-else class="h-5 w-5" stroke-width="1" />
        </button>
        <nav class="flex items-center text-sm">
          <span class="font-medium text-gray-900 dark:text-white"
            >settings</span
          >
        </nav>
      </div>
      <div class="flex items-center space-x-4">
        <a
          href="https://docs.sailscasts.com/slipway"
          target="_blank"
          class="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
        >
          Docs
          <ExternalLink class="h-3.5 w-3.5" stroke-width="2" />
        </a>
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
      <div class="mx-auto max-w-6xl">
        <!-- Search -->
        <div class="mb-6">
          <Input
            v-model="search"
            type="text"
            placeholder="Search settings..."
            class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500 sm:w-64"
          />
        </div>

        <!-- Settings list by category -->
        <div v-if="filteredCategories.length > 0" class="space-y-6">
          <div v-for="category in filteredCategories" :key="category.name">
            <h2
              class="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400"
            >
              {{ category.name }}
            </h2>
            <div class="rounded-lg border border-gray-200 dark:border-gray-800">
              <Link
                v-for="(item, i) in category.items"
                :key="item.href"
                :href="item.href"
                :class="[
                  'flex items-center justify-between px-4 py-4 transition-colors hover:bg-gray-50 dark:hover:bg-gray-900/50',
                  i > 0 ? 'border-t border-gray-200 dark:border-gray-800' : ''
                ]"
              >
                <div class="flex items-center space-x-3">
                  <Server
                    v-if="item.icon === 'server'"
                    class="h-4 w-4 text-gray-400 dark:text-gray-500"
                  />
                  <!-- Cloud icon -->
                  <CloudUpload
                    v-if="item.icon === 'cloud'"
                    class="h-4 w-4 text-gray-400 dark:text-gray-500"
                  />
                  <Bell
                    v-if="item.icon === 'bell'"
                    class="h-4 w-4 text-gray-400 dark:text-gray-500"
                  />
                  <!-- Globe icon -->
                  <Globe
                    v-if="item.icon === 'globe'"
                    class="h-4 w-4 text-gray-400 dark:text-gray-500"
                  />
                  <!-- Building icon -->
                  <Building
                    v-if="item.icon === 'building'"
                    class="h-4 w-4 text-gray-400 dark:text-gray-500"
                  />
                  <!-- Users icon -->
                  <Users
                    v-if="item.icon === 'users'"
                    class="h-4 w-4 text-gray-400 dark:text-gray-500"
                  />
                  <!-- Git icon -->
                  <svg
                    v-if="item.icon === 'git'"
                    class="h-4 w-4 text-gray-400 dark:text-gray-500"
                    fill="currentColor"
                    viewBox="0 0 92 92"
                  >
                    <path
                      d="M90.156 41.965 50.036 1.848a5.918 5.918 0 0 0-8.372 0l-8.328 8.332 10.566 10.566a7.03 7.03 0 0 1 7.23 1.684 7.034 7.034 0 0 1 1.669 7.277l10.187 10.184a7.028 7.028 0 0 1 7.278 1.672 7.04 7.04 0 0 1 0 9.957 7.05 7.05 0 0 1-9.965 0 7.044 7.044 0 0 1-1.528-7.66l-9.5-9.497V59.36a7.04 7.04 0 0 1 1.86 11.29 7.04 7.04 0 0 1-9.957 0 7.04 7.04 0 0 1 0-9.958 7.06 7.06 0 0 1 2.304-1.539V33.926a7.049 7.049 0 0 1-3.82-9.234L29.242 14.272 1.73 41.777a5.925 5.925 0 0 0 0 8.371L41.852 90.27a5.925 5.925 0 0 0 8.37 0l39.934-39.934a5.925 5.925 0 0 0 0-8.371"
                    />
                  </svg>
                  <!-- Key icon -->
                  <Key
                    v-if="item.icon === 'key'"
                    class="h-4 w-4 text-gray-400 dark:text-gray-500"
                  />
                  <!-- Update icon -->
                  <Refresh
                    v-if="item.icon === 'update'"
                    class="h-4 w-4 text-gray-400 dark:text-gray-500"
                  />
                  <!-- Audit icon -->
                  <ShieldCheck
                    v-if="item.icon === 'audit'"
                    class="h-4 w-4 text-gray-400 dark:text-gray-500"
                  />
                  <div>
                    <span
                      class="text-sm font-medium text-gray-900 dark:text-white"
                      >{{ item.title }}</span
                    >
                    <p class="text-sm text-gray-500 dark:text-gray-400">
                      {{ item.description }}
                    </p>
                  </div>
                </div>
                <ChevronRight
                  class="h-4 w-4 text-gray-300 dark:text-gray-600"
                  stroke-width="2"
                />
              </Link>
            </div>
          </div>
        </div>

        <!-- No results -->
        <div
          v-else
          class="py-8 text-center text-sm text-gray-500 dark:text-gray-400"
        >
          No settings matching "{{ search }}"
        </div>
      </div>
    </div>
  </div>
</template>
