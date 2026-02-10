<script setup>
import { Link, Head, router } from '@inertiajs/vue3'
import { inject, ref, computed } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  team: Object,
  members: Array,
  currentUserRole: String
})

const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')

const search = ref('')

const filtered = computed(() => {
  const q = search.value.toLowerCase().trim()
  if (!q) return props.members
  return props.members.filter(m =>
    m.fullName.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)
  )
})

const canManage = computed(() => ['owner', 'admin'].includes(props.currentUserRole))
const isOwner = computed(() => props.currentUserRole === 'owner')

// Invite
const showInvite = ref(false)
const inviteEmail = ref('')
const inviteRole = ref('member')
const inviting = ref(false)

function submitInvite() {
  if (!inviteEmail.value.trim()) return
  inviting.value = true
  router.post('/settings/team/invite', {
    email: inviteEmail.value.trim(),
    role: inviteRole.value
  }, {
    preserveScroll: true,
    onSuccess: () => {
      showInvite.value = false
      inviteEmail.value = ''
      inviteRole.value = 'member'
    },
    onFinish: () => { inviting.value = false }
  })
}

// Actions menu
const openMenu = ref(null)

function toggleMenu(memberId) {
  openMenu.value = openMenu.value === memberId ? null : memberId
}

function closeMenu() {
  openMenu.value = null
}

// Role change
function changeRole(member, newRole) {
  openMenu.value = null
  router.patch(`/settings/team/${member.id}/role`, {
    role: newRole
  }, { preserveScroll: true })
}

// Remove member
const removingMember = ref(null)

function confirmRemove(member) {
  removingMember.value = member
  openMenu.value = null
}

function executeRemove() {
  router.delete(`/settings/team/${removingMember.value.id}`, {
    preserveScroll: true,
    onSuccess: () => { removingMember.value = null }
  })
}

function cancelRemove() {
  removingMember.value = null
}

function roleBadgeClass(role) {
  if (role === 'owner') return 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
  if (role === 'admin') return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
  return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
}

function timeAgo(date) {
  if (!date) return 'N/A'
  const seconds = Math.floor((new Date() - new Date(date)) / 1000)
  const intervals = [
    { label: 'year', seconds: 31536000 },
    { label: 'month', seconds: 2592000 },
    { label: 'week', seconds: 604800 },
    { label: 'day', seconds: 86400 },
    { label: 'hour', seconds: 3600 },
    { label: 'minute', seconds: 60 }
  ]
  for (const interval of intervals) {
    const count = Math.floor(seconds / interval.seconds)
    if (count >= 1) return `${count} ${interval.label}${count > 1 ? 's' : ''} ago`
  }
  return 'just now'
}
</script>
<template>
  <Head :title="`Team Members | ${team.name} | Slipway`"></Head>
  <div class="flex h-full flex-col" @click="closeMenu">
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-gray-200 py-4 pl-4 pr-4 dark:border-gray-800 sm:pl-4 sm:pr-8">
      <div class="flex items-center space-x-3">
        <button
          @click="toggleMobileMenu"
          class="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white md:hidden"
        >
          <svg class="h-5 w-5" viewBox="-0.5 -0.5 16 16" fill="none" stroke="currentColor">
            <path d="M12.777 14.285H2.223c-.833 0-1.508-.675-1.508-1.508V2.223c0-.833.675-1.508 1.508-1.508h10.554c.833 0 1.508.675 1.508 1.508v10.554c0 .833-.675 1.508-1.508 1.508Z" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" />
            <path d="M5.615 14.285V.715" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" />
            <path d="M2.6 5.992 3.919 7.5 2.6 9.008" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" />
          </svg>
        </button>
        <!-- Desktop sidebar toggle -->
        <button
          @click="toggleSidebar"
          class="hidden text-gray-400 dark:text-gray-500 md:block"
        >
          <svg v-if="sidebarCollapsed" class="h-5 w-5" viewBox="-0.5 -0.5 16 16" fill="none" stroke="currentColor">
            <path d="M12.777 14.285H2.223c-.833 0-1.508-.675-1.508-1.508V2.223c0-.833.675-1.508 1.508-1.508h10.554c.833 0 1.508.675 1.508 1.508v10.554c0 .833-.675 1.508-1.508 1.508Z" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" />
            <path d="M5.615 14.285V.715" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" />
            <path d="M2.6 5.992 3.919 7.5 2.6 9.008" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" />
          </svg>
          <svg v-else class="h-5 w-5" viewBox="-0.5 -0.5 16 16" fill="none" stroke="currentColor">
            <path d="M12.777 14.285H2.223c-.833 0-1.508-.675-1.508-1.508V2.223c0-.833.675-1.508 1.508-1.508h10.554c.833 0 1.508.675 1.508 1.508v10.554c0 .833-.675 1.508-1.508 1.508Z" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" />
            <path d="M5.615 14.285V.715" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" />
            <path d="M3.919 5.992 2.6 7.5l1.319 1.508" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" />
          </svg>
        </button>
        <nav class="flex items-center space-x-2 text-sm">
          <Link href="/settings" class="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">
            settings
          </Link>
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <span class="font-medium text-gray-900 dark:text-white">team</span>
        </nav>
      </div>
      <div class="flex items-center space-x-4">
        <button
          v-if="canManage"
          @click="showInvite = !showInvite"
          class="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
        >
          Invite member
        </button>
        <a
          href="https://docs.sailscasts.com/slipway"
          target="_blank"
          class="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
        >
          Docs
          <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
      <div class="mx-auto max-w-6xl">
        <!-- Invite form -->
        <Transition
          enter-active-class="transition duration-200 ease-out"
          enter-from-class="opacity-0 -translate-y-2"
          enter-to-class="opacity-100 translate-y-0"
          leave-active-class="transition duration-150 ease-in"
          leave-from-class="opacity-100 translate-y-0"
          leave-to-class="opacity-0 -translate-y-2"
        >
          <div v-if="showInvite" class="mb-6 rounded-lg border border-gray-200 bg-gray-50/50 p-4 dark:border-gray-800 dark:bg-gray-900/50">
            <form @submit.prevent="submitInvite" class="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div class="flex-1">
                <label class="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">Email</label>
                <input
                  v-model="inviteEmail"
                  type="email"
                  placeholder="teammate@example.com"
                  required
                  class="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:placeholder-gray-500"
                />
              </div>
              <div class="w-full sm:w-32">
                <label class="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">Role</label>
                <select
                  v-model="inviteRole"
                  class="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div class="flex space-x-2">
                <button
                  type="submit"
                  :disabled="inviting"
                  class="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
                >
                  {{ inviting ? 'Inviting...' : 'Send invite' }}
                </button>
                <button
                  type="button"
                  @click="showInvite = false"
                  class="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  Cancel
                </button>
              </div>
            </form>
            <p class="mt-2 text-xs text-gray-400 dark:text-gray-500">
              The invited person can set up their account by visiting your Slipway URL and using Forgot Password.
            </p>
          </div>
        </Transition>

        <!-- Search -->
        <div v-if="members.length > 1" class="mb-6">
          <input
            v-model="search"
            type="text"
            placeholder="Search members..."
            class="w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500 sm:w-64"
          />
        </div>

        <!-- Members table -->
        <div v-if="filtered.length > 0" class="rounded-lg border border-gray-200 dark:border-gray-800">
          <!-- Table Header (hidden on mobile) -->
          <div class="hidden grid-cols-12 gap-4 border-b border-gray-200 bg-gray-50/50 px-6 py-2 text-xs font-medium text-gray-500 dark:border-gray-800 dark:bg-gray-900/50 sm:grid">
            <div class="col-span-4">Member</div>
            <div class="col-span-3">Role</div>
            <div class="col-span-3">Joined</div>
            <div class="col-span-2"></div>
          </div>

          <!-- Table Body -->
          <div class="divide-y divide-gray-200 bg-white dark:divide-gray-800 dark:bg-gray-950">
            <div
              v-for="member in filtered"
              :key="member.id"
              class="flex flex-col gap-3 px-6 py-4 sm:grid sm:grid-cols-12 sm:items-center sm:gap-4"
            >
              <!-- Member info -->
              <div class="col-span-4 flex items-center space-x-3">
                <span
                  class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-medium text-white"
                >
                  {{ member.initials }}
                </span>
                <div class="min-w-0">
                  <p class="truncate text-sm font-medium text-gray-900 dark:text-white">{{ member.fullName }}</p>
                  <p class="truncate text-xs text-gray-500 dark:text-gray-400">{{ member.email }}</p>
                </div>
              </div>

              <!-- Role -->
              <div class="col-span-3">
                <span :class="['inline-flex rounded-full px-2 py-0.5 text-xs font-medium', roleBadgeClass(member.teamRole)]">
                  {{ member.teamRole }}
                </span>
                <span
                  v-if="member.emailStatus === 'unverified'"
                  class="ml-1 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                >
                  pending
                </span>
              </div>

              <!-- Joined -->
              <div class="col-span-3">
                <span class="text-sm text-gray-500 dark:text-gray-400">
                  {{ timeAgo(member.createdAt) }}
                </span>
              </div>

              <!-- Actions -->
              <div class="col-span-2 flex justify-end">
                <div v-if="canManage && member.teamRole !== 'owner'" class="relative">
                  <button
                    @click.stop="toggleMenu(member.id)"
                    class="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                  >
                    <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                    </svg>
                  </button>

                  <!-- Dropdown menu -->
                  <div
                    v-if="openMenu === member.id"
                    class="absolute right-0 z-10 mt-1 w-40 rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
                  >
                    <template v-if="isOwner">
                      <button
                        v-if="member.teamRole === 'member'"
                        @click.stop="changeRole(member, 'admin')"
                        class="flex w-full items-center px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"
                      >
                        Make admin
                      </button>
                      <button
                        v-if="member.teamRole === 'admin'"
                        @click.stop="changeRole(member, 'member')"
                        class="flex w-full items-center px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"
                      >
                        Make member
                      </button>
                    </template>
                    <button
                      @click.stop="confirmRemove(member)"
                      class="flex w-full items-center px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- No search results -->
        <div v-else-if="members.length > 0" class="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
          No members matching "{{ search }}"
        </div>
      </div>
    </div>

    <ConfirmModal
      :show="!!removingMember"
      title="Remove team member"
      :message="`Remove ${removingMember?.fullName} from the team? They will lose access to all projects.`"
      confirm-label="Remove"
      :destructive="true"
      @confirm="executeRemove"
      @cancel="cancelRemove"
    />
  </div>
</template>
