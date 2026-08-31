<script setup>
import SidebarOpen from '@/components/ui/icons/SidebarOpen.vue'
import SidebarClose from '@/components/ui/icons/SidebarClose.vue'
import ExternalLink from '@/components/ui/icons/ExternalLink.vue'
import EllipsisVertical from '@/components/ui/icons/EllipsisVertical.vue'
import Search from '@/components/ui/icons/Search.vue'
import Input from '@/components/ui/input/Input.vue'
import { Link, Head, router, useForm } from '@inertiajs/vue3'
import { inject, ref, computed, watch, onUnmounted } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import Menu from '@/components/ui/menu/Menu.vue'
import Select from '@/components/ui/select/Select.vue'
import { usePrecognitionValidation } from '@/composables/precognition'

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
  return props.members.filter(
    (m) =>
      m.fullName.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)
  )
})

const canManage = computed(() =>
  ['owner', 'admin'].includes(props.currentUserRole)
)
const isOwner = computed(() => props.currentUserRole === 'owner')

// Invite
const showInvite = ref(false)
const inviteForm = useForm({
  email: '',
  role: 'member'
})
  .withPrecognition('post', '/settings/team/invite')
  .setValidationTimeout(350)
const { revalidateWhenInvalid, validateOnBlur } =
  usePrecognitionValidation(inviteForm)

function submitInvite() {
  if (!inviteForm.email.trim()) return
  inviteForm.post('/settings/team/invite', {
    preserveScroll: true,
    onSuccess: () => {
      showInvite.value = false
      inviteForm.reset()
    }
  })
}

function closeInvite() {
  if (!inviteForm.processing) {
    showInvite.value = false
    inviteForm.resetAndClearErrors()
  }
}

function handleInviteKeydown(e) {
  if (e.key === 'Escape') closeInvite()
}

watch(showInvite, (isShown) => {
  if (isShown) {
    document.addEventListener('keydown', handleInviteKeydown)
  } else {
    document.removeEventListener('keydown', handleInviteKeydown)
  }
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleInviteKeydown)
})

// Role change
const roleMemberId = ref(null)
const roleForm = useForm({ role: 'member' }).withPrecognition(
  'patch',
  () => `/settings/team/${roleMemberId.value}/role`
)

function changeRole(member, newRole) {
  roleMemberId.value = member.id
  roleForm.role = newRole
  roleForm.validate('role', {
    onPrecognitionSuccess: () => {
      roleForm.patch(`/settings/team/${member.id}/role`, {
        preserveScroll: true
      })
    }
  })
}

// Remove member
const removingMember = ref(null)

function confirmRemove(member) {
  removingMember.value = member
}

function executeRemove() {
  router.delete(`/settings/team/${removingMember.value.id}`, {
    preserveScroll: true,
    onSuccess: () => {
      removingMember.value = null
    }
  })
}

function cancelRemove() {
  removingMember.value = null
}

function roleBadgeClass(role) {
  if (role === 'owner')
    return 'bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400'
  if (role === 'admin')
    return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
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
    if (count >= 1)
      return `${count} ${interval.label}${count > 1 ? 's' : ''} ago`
  }
  return 'just now'
}
</script>
<template>
  <Head :title="`Team Members | ${team.name} | Slipway`"></Head>
  <div class="flex h-full flex-col">
    <!-- Header -->
    <div
      class="flex items-center justify-between border-b border-gray-200 py-4 pl-4 pr-4 dark:border-gray-800 sm:pl-4 sm:pr-8"
    >
      <div class="flex items-center space-x-3">
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
        <nav class="flex items-center space-x-2 text-sm">
          <Link
            href="/settings"
            class="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >
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
          <ExternalLink class="h-3.5 w-3.5" stroke-width="2" />
        </a>
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
      <div class="mx-auto max-w-6xl">
        <!-- Page Header -->
        <div class="mb-6">
          <h1 class="text-xl font-semibold text-gray-900 dark:text-white">
            Team Members
          </h1>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Manage who has access to {{ team.name }}'s projects and resources.
          </p>
        </div>

        <!-- Search -->
        <div class="mb-6">
          <Input
            v-model="search"
            type="text"
            placeholder="Search members..."
            class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500 sm:max-w-xs"
          />
        </div>

        <!-- Members table -->
        <div
          v-if="members.length > 0"
          class="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800"
        >
          <!-- Table Header (hidden on mobile) -->
          <div
            class="hidden grid-cols-12 gap-4 border-b border-gray-200 bg-gray-50/30 px-6 py-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:bg-gray-900/30 sm:grid"
          >
            <div class="col-span-5">Member</div>
            <div class="col-span-2">Role</div>
            <div class="col-span-3">Joined</div>
            <div class="col-span-2"></div>
          </div>

          <!-- Table Body -->
          <div
            v-if="filtered.length > 0"
            class="divide-y divide-gray-200 bg-white dark:divide-gray-800 dark:bg-gray-950"
          >
            <div
              v-for="member in filtered"
              :key="member.id"
              class="flex flex-col gap-3 px-6 py-4 sm:grid sm:grid-cols-12 sm:items-center sm:gap-4"
            >
              <!-- Member info -->
              <div class="col-span-5 flex items-center space-x-3">
                <span
                  class="bg-brand flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-medium text-white"
                >
                  {{ member.initials }}
                </span>
                <div class="min-w-0">
                  <p
                    class="truncate text-sm font-medium text-gray-900 dark:text-white"
                  >
                    {{ member.fullName }}
                  </p>
                  <p class="truncate text-xs text-gray-500 dark:text-gray-400">
                    {{ member.email }}
                  </p>
                </div>
              </div>

              <!-- Role -->
              <div class="col-span-2">
                <span
                  :class="[
                    'inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium',
                    roleBadgeClass(member.teamRole)
                  ]"
                >
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
                <div
                  v-if="canManage && member.teamRole !== 'owner'"
                  class="relative"
                >
                  <button
                    type="button"
                    :popovertarget="`team-member-actions-${member.id}`"
                    :aria-label="`Actions for ${member.fullName}`"
                    class="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                  >
                    <EllipsisVertical class="h-5 w-5" />
                  </button>

                  <!-- Dropdown menu -->
                  <Menu
                    :id="`team-member-actions-${member.id}`"
                    :aria-label="`Actions for ${member.fullName}`"
                    placement="bottom-end"
                    :offset="4"
                    class="w-40 rounded-md border-gray-200 bg-white px-0 py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
                  >
                    <template v-if="isOwner">
                      <button
                        v-if="member.teamRole === 'member'"
                        @click="changeRole(member, 'admin')"
                        class="flex w-full items-center px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"
                      >
                        Make admin
                      </button>
                      <button
                        v-if="member.teamRole === 'admin'"
                        @click="changeRole(member, 'member')"
                        class="flex w-full items-center px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"
                      >
                        Make member
                      </button>
                    </template>
                    <button
                      @click="confirmRemove(member)"
                      class="flex w-full items-center px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                    >
                      Remove
                    </button>
                  </Menu>
                </div>
              </div>
            </div>
          </div>

          <!-- No search results -->
          <div v-else class="px-6 py-12 text-center">
            <Search class="mx-auto h-8 w-8 text-gray-300 dark:text-gray-600" />
            <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
              No members matching "{{ search }}"
            </p>
          </div>
        </div>

        <!-- No members at all (shouldn't happen but just in case) -->
        <div
          v-else
          class="rounded-lg border border-gray-200 px-6 py-12 text-center dark:border-gray-800"
        >
          <p class="text-sm text-gray-500 dark:text-gray-400">
            No team members yet.
          </p>
        </div>
      </div>
    </div>

    <!-- Invite modal -->
    <Teleport to="body">
      <Transition
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="opacity-0"
        enter-to-class="opacity-100"
        leave-active-class="transition duration-150 ease-in"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
      >
        <div
          v-if="showInvite"
          class="fixed inset-0 z-50 flex items-center justify-center"
        >
          <div class="fixed inset-0 bg-black/50" @click="closeInvite" />
          <Transition
            enter-active-class="transition duration-200 ease-out"
            enter-from-class="scale-95 opacity-0"
            enter-to-class="scale-100 opacity-100"
            leave-active-class="transition duration-150 ease-in"
            leave-from-class="scale-100 opacity-100"
            leave-to-class="scale-95 opacity-0"
          >
            <div
              v-if="showInvite"
              class="relative w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6 shadow-xl dark:border-gray-700 dark:bg-gray-900"
            >
              <h3 class="text-lg font-semibold text-gray-900 dark:text-white">
                Invite member
              </h3>
              <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                They'll receive an email to set up their account.
              </p>
              <form @submit.prevent="submitInvite" class="mt-4 space-y-4">
                <div>
                  <label
                    class="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400"
                    >Email</label
                  >
                  <Input
                    v-model="inviteForm.email"
                    type="email"
                    placeholder="teammate@example.com"
                    required
                    :aria-invalid="inviteForm.invalid('email')"
                    :aria-describedby="
                      inviteForm.errors.email ? 'invite-email-error' : null
                    "
                    class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
                    @blur="validateOnBlur('email', $event)"
                    @input="revalidateWhenInvalid('email')"
                  />
                  <p
                    v-if="inviteForm.errors.email"
                    id="invite-email-error"
                    class="mt-1 text-sm text-red-600 dark:text-red-400"
                  >
                    {{ inviteForm.errors.email }}
                  </p>
                </div>
                <div>
                  <label
                    class="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400"
                    >Role</label
                  >
                  <Select
                    v-model="inviteForm.role"
                    :options="[
                      { value: 'member', label: 'Member' },
                      { value: 'admin', label: 'Admin' }
                    ]"
                    class="focus:border-brand w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                  />
                </div>
                <div class="flex justify-end space-x-3">
                  <button
                    type="button"
                    @click="closeInvite"
                    :disabled="inviteForm.processing"
                    class="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    :disabled="
                      inviteForm.processing ||
                      inviteForm.hasErrors ||
                      !inviteForm.email.trim()
                    "
                    class="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
                  >
                    {{ inviteForm.processing ? 'Sending...' : 'Send invite' }}
                  </button>
                </div>
              </form>
            </div>
          </Transition>
        </div>
      </Transition>
    </Teleport>

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
