<script setup>
import { Head, router, useForm } from '@inertiajs/vue3'
import { computed, inject, ref } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'
import Breadcrumb from '@/components/Breadcrumb.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  project: Object,
  environment: Object,
  app: Object,
  access: Array,
  hookDetected: Boolean
})

const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')
const openMenu = ref(null)
const revoking = ref(null)
const disabling = ref(false)
const resending = ref(null)

const basePath = computed(
  () =>
    `/projects/${props.project.slug}/environments/${props.environment.slug}/apps/${props.app.slug}`
)
const bridgePath = computed(() => `${basePath.value}/bridge`)
const accessPath = computed(() => `${bridgePath.value}/access`)

const inviteForm = useForm({
  email: '',
  role: 'viewer'
})

const validEmail = computed(() =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteForm.email.trim())
)
const canInvite = computed(
  () => props.app.bridgeEnabled && validEmail.value && !inviteForm.processing
)

function invite() {
  if (!canInvite.value) return
  inviteForm
    .transform((data) => ({
      email: data.email.trim().toLowerCase(),
      role: data.role
    }))
    .post(`${accessPath.value}/invitations`, {
      preserveScroll: true,
      onSuccess: () => inviteForm.reset('email')
    })
}

function setEnabled(enabled) {
  router.patch(
    accessPath.value,
    { enabled },
    {
      preserveScroll: true
    }
  )
}

function changeRole(grant, role) {
  openMenu.value = null
  if (grant.role === role) return
  router.patch(
    `${accessPath.value}/${grant.id}`,
    { role },
    { preserveScroll: true }
  )
}

function resend(grant) {
  openMenu.value = null
  resending.value = grant.id
  router.post(
    `${accessPath.value}/invitations`,
    {
      email: grant.email,
      role: grant.role
    },
    {
      preserveScroll: true,
      onFinish: () => {
        resending.value = null
      }
    }
  )
}

function confirmRevoke(grant) {
  openMenu.value = null
  revoking.value = grant
}

function revoke() {
  router.delete(`${accessPath.value}/${revoking.value.id}`, {
    preserveScroll: true,
    onFinish: () => {
      revoking.value = null
    }
  })
}

function disableBridge() {
  setEnabled(false)
  disabling.value = false
}

function closeMenus() {
  openMenu.value = null
}

function statusLabel(grant) {
  if (
    grant.status === 'pending' &&
    grant.inviteExpiresAt &&
    grant.inviteExpiresAt < Date.now()
  ) {
    return 'Expired'
  }
  return grant.status.charAt(0).toUpperCase() + grant.status.slice(1)
}

function statusClass(grant) {
  const status = statusLabel(grant).toLowerCase()
  if (status === 'active') {
    return 'bg-emerald-500'
  }
  if (status === 'revoked' || status === 'expired') {
    return 'bg-gray-300 dark:bg-gray-700'
  }
  return 'bg-amber-400'
}

function roleLabel(role) {
  return role.charAt(0).toUpperCase() + role.slice(1)
}

function timeAgo(timestamp) {
  if (!timestamp) return ''
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - Number(timestamp)) / 1000)
  )
  const intervals = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60]
  ]
  for (const [label, size] of intervals) {
    const count = Math.floor(seconds / size)
    if (count >= 1) return `${count} ${label}${count > 1 ? 's' : ''} ago`
  }
  return 'just now'
}
</script>

<template>
  <Head :title="`Bridge access - ${app.name} | Slipway`"></Head>
  <div class="flex h-full flex-col" @click="closeMenus">
    <header
      class="flex items-center justify-between border-b border-gray-200 py-4 pl-4 pr-4 dark:border-gray-800 sm:pr-8"
    >
      <div class="flex min-w-0 items-center gap-3">
        <button
          type="button"
          class="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white md:hidden"
          aria-label="Open navigation"
          @click.stop="toggleMobileMenu"
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
            />
            <path d="M5.615 14.285V.715" />
          </svg>
        </button>
        <button
          type="button"
          class="hidden text-gray-400 dark:text-gray-500 md:block"
          :aria-label="sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
          @click.stop="toggleSidebar"
        >
          <svg
            class="h-5 w-5"
            viewBox="-0.5 -0.5 16 16"
            fill="none"
            stroke="currentColor"
          >
            <path
              d="M12.777 14.285H2.223c-.833 0-1.508-.675-1.508-1.508V2.223c0-.833.675-1.508 1.508-1.508h10.554c.833 0 1.508.675 1.508 1.508v10.554c0 .833-.675 1.508-1.508 1.508Z"
            />
            <path d="M5.615 14.285V.715" />
          </svg>
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
            { label: app.name.toLowerCase(), href: basePath },
            { label: 'bridge access' }
          ]"
        />
      </div>
    </header>

    <main class="flex-1 overflow-y-auto px-4 py-8 sm:px-8 sm:py-12">
      <div class="mx-auto max-w-3xl">
        <div
          class="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between"
        >
          <div>
            <h1 class="text-xl font-semibold text-gray-950 dark:text-white">
              Bridge access
            </h1>
            <p
              class="mt-1 max-w-xl text-sm leading-6 text-gray-500 dark:text-gray-400"
            >
              Invite people by email. Bridge grants access only after they sign
              in to {{ app.name }} with that verified address.
            </p>
          </div>
          <div class="flex shrink-0 items-center">
            <a
              v-if="app.bridgeEnabled && app.bridgeUrl"
              :href="app.bridgeUrl"
              target="_blank"
              rel="noopener"
              class="min-h-9 inline-flex items-center rounded-lg bg-gray-950 px-3.5 text-sm font-medium text-white hover:bg-gray-800 dark:bg-white dark:text-gray-950 dark:hover:bg-gray-100"
            >
              Open public Bridge
            </a>
            <button
              v-if="!app.bridgeEnabled"
              type="button"
              class="min-h-9 inline-flex items-center rounded-lg bg-gray-950 px-3.5 text-sm font-medium text-white hover:bg-gray-800 dark:bg-white dark:text-gray-950 dark:hover:bg-gray-100"
              @click="setEnabled(true)"
            >
              Enable Bridge
            </button>
          </div>
        </div>

        <section
          v-if="app.bridgeEnabled && !hookDetected"
          class="mt-8 rounded-lg bg-amber-50 px-4 py-3 dark:bg-amber-950/30"
          role="status"
          data-test="bridge-hook-warning"
        >
          <p class="text-sm font-medium text-amber-900 dark:text-amber-200">
            Install sails-hook-slipway, then redeploy this app.
          </p>
          <p class="mt-1 text-sm leading-6 text-amber-700 dark:text-amber-300">
            The hook adds the secure <code>/bridge</code> entry point. Existing
            dashboard Bridge tools continue to work while you update.
          </p>
        </section>

        <section
          v-else-if="app.bridgeEnabled"
          class="mt-8 flex items-start gap-3 rounded-lg bg-gray-50 px-4 py-3 dark:bg-gray-900"
          data-test="bridge-enabled-notice"
        >
          <span
            class="mt-1 h-2 w-2 shrink-0 rounded-full bg-emerald-500"
          ></span>
          <div class="min-w-0">
            <p class="text-sm font-medium text-gray-900 dark:text-gray-100">
              App-local Bridge is enabled
            </p>
            <p
              class="mt-0.5 text-sm leading-6 text-gray-500 dark:text-gray-400"
            >
              Redeploy after changing this setting so the app receives its
              scoped exchange credential.
            </p>
          </div>
        </section>

        <section
          v-if="app.bridgeEnabled"
          class="mt-6"
          aria-label="Public Bridge URL"
          data-test="bridge-urls"
        >
          <a
            v-if="app.bridgeUrl"
            :href="app.bridgeUrl"
            target="_blank"
            rel="noopener"
            data-test="public-bridge-url"
            class="block min-w-0 rounded-lg border border-gray-200 px-4 py-3 hover:border-gray-300 dark:border-gray-800 dark:hover:border-gray-700"
          >
            <span
              class="block text-xs font-medium text-gray-500 dark:text-gray-400"
            >
              Public Bridge URL
            </span>
            <code
              class="mt-1 block truncate text-sm text-gray-900 dark:text-gray-100"
            >
              {{ app.bridgeUrl }}
            </code>
          </a>
        </section>

        <section class="mt-10" aria-labelledby="invite-title">
          <div>
            <h2
              id="invite-title"
              class="text-sm font-semibold text-gray-950 dark:text-white"
            >
              Invite someone
            </h2>
            <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Their verified host-app email must match the invitation.
            </p>
          </div>

          <form
            class="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_auto]"
            @submit.prevent="invite"
          >
            <div>
              <label for="bridge-invite-email" class="sr-only">
                Email address
              </label>
              <input
                id="bridge-invite-email"
                v-model="inviteForm.email"
                type="email"
                autocomplete="email"
                placeholder="editor@example.com"
                :disabled="!app.bridgeEnabled || inviteForm.processing"
                class="min-h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-950 placeholder-gray-400 outline-none focus:border-gray-400 focus:ring-2 focus:ring-gray-100 disabled:cursor-not-allowed disabled:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:text-white dark:focus:border-gray-600 dark:focus:ring-gray-900 dark:disabled:bg-gray-900"
              />
              <p
                v-if="inviteForm.errors.email"
                class="mt-1.5 text-sm text-red-600 dark:text-red-400"
              >
                {{ inviteForm.errors.email }}
              </p>
            </div>
            <div>
              <label for="bridge-invite-role" class="sr-only">
                Bridge role
              </label>
              <select
                id="bridge-invite-role"
                v-model="inviteForm.role"
                :disabled="!app.bridgeEnabled || inviteForm.processing"
                class="min-h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 outline-none focus:border-gray-400 focus:ring-2 focus:ring-gray-100 disabled:cursor-not-allowed disabled:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200 dark:focus:border-gray-600 dark:focus:ring-gray-900 dark:disabled:bg-gray-900"
              >
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
                <option value="administrator">Administrator</option>
              </select>
            </div>
            <button
              type="submit"
              :disabled="!canInvite"
              class="min-h-10 inline-flex items-center justify-center rounded-lg bg-gray-950 px-4 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500 dark:bg-white dark:text-gray-950 dark:hover:bg-gray-100 dark:disabled:bg-gray-800 dark:disabled:text-gray-500"
            >
              {{ inviteForm.processing ? 'Sending…' : 'Send invite' }}
            </button>
          </form>
        </section>

        <section class="mt-12" aria-labelledby="people-title">
          <div class="flex items-baseline justify-between gap-4">
            <div>
              <h2
                id="people-title"
                class="text-sm font-semibold text-gray-950 dark:text-white"
              >
                People
              </h2>
              <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {{ access.length }}
                {{ access.length === 1 ? 'person' : 'people' }}
              </p>
            </div>
          </div>

          <div
            v-if="access.length"
            class="mt-3 divide-y divide-gray-100 dark:divide-gray-900"
          >
            <article
              v-for="grant in access"
              :key="grant.id"
              class="min-h-16 flex items-center gap-3 py-3"
              :data-test="`bridge-access-${grant.id}`"
            >
              <span
                :class="['h-2 w-2 shrink-0 rounded-full', statusClass(grant)]"
                :title="statusLabel(grant)"
              ></span>
              <div class="min-w-0 flex-1">
                <p
                  class="truncate text-sm font-medium text-gray-900 dark:text-gray-100"
                >
                  {{ grant.hostUserName || grant.email }}
                </p>
                <p
                  class="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-500"
                >
                  <span v-if="grant.hostUserName">{{ grant.email }} · </span>
                  {{ statusLabel(grant) }}
                  <span v-if="grant.lastUsedAt">
                    · used {{ timeAgo(grant.lastUsedAt) }}</span
                  >
                </p>
              </div>
              <span
                class="hidden text-sm text-gray-500 dark:text-gray-400 sm:block"
              >
                {{ roleLabel(grant.role) }}
              </span>
              <div class="relative">
                <button
                  type="button"
                  class="rounded-md p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-900 dark:hover:text-gray-200"
                  :aria-label="`Manage ${grant.email}`"
                  :aria-expanded="openMenu === grant.id"
                  @click.stop="
                    openMenu = openMenu === grant.id ? null : grant.id
                  "
                >
                  <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                    <circle cx="6" cy="12" r="1.5" />
                    <circle cx="12" cy="12" r="1.5" />
                    <circle cx="18" cy="12" r="1.5" />
                  </svg>
                </button>
                <div
                  v-if="openMenu === grant.id"
                  class="absolute right-0 top-full z-20 mt-1 w-44 rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-800 dark:bg-gray-900"
                  @click.stop
                >
                  <p
                    class="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-gray-400"
                  >
                    Role
                  </p>
                  <button
                    v-for="role in ['viewer', 'editor', 'administrator']"
                    :key="role"
                    type="button"
                    class="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"
                    @click="changeRole(grant, role)"
                  >
                    {{ roleLabel(role) }}
                    <span v-if="grant.role === role">✓</span>
                  </button>
                  <button
                    v-if="grant.status !== 'active'"
                    type="button"
                    :disabled="resending === grant.id"
                    class="mt-1 w-full border-t border-gray-100 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 disabled:text-gray-400 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800"
                    @click="resend(grant)"
                  >
                    {{
                      resending === grant.id
                        ? 'Sending…'
                        : grant.status === 'revoked'
                        ? 'Re-invite'
                        : 'Resend invitation'
                    }}
                  </button>
                  <button
                    v-if="grant.status !== 'revoked'"
                    type="button"
                    :class="[
                      'w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30',
                      grant.status === 'active'
                        ? 'mt-1 border-t border-gray-100 dark:border-gray-800'
                        : ''
                    ]"
                    @click="confirmRevoke(grant)"
                  >
                    Revoke access
                  </button>
                </div>
              </div>
            </article>
          </div>

          <div v-else class="mt-5 py-8 text-center">
            <p class="text-sm text-gray-500 dark:text-gray-400">
              No one has been invited yet.
            </p>
          </div>
        </section>

        <div
          v-if="app.bridgeEnabled"
          class="mt-12 flex items-center justify-between gap-4 border-t border-gray-100 pt-6 dark:border-gray-900"
        >
          <p class="text-sm text-gray-500 dark:text-gray-400">
            Disabling Bridge immediately blocks new and existing Bridge
            sessions.
          </p>
          <button
            type="button"
            class="shrink-0 text-sm font-medium text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
            @click="disabling = true"
          >
            Disable Bridge
          </button>
        </div>
      </div>
    </main>

    <ConfirmModal
      :show="Boolean(revoking)"
      title="Revoke Bridge access?"
      :message="
        revoking
          ? `${revoking.email} will immediately lose access to this app's Bridge.`
          : ''
      "
      confirm-text="Revoke access"
      confirm-variant="danger"
      @confirm="revoke"
      @cancel="revoking = null"
    />
    <ConfirmModal
      :show="disabling"
      title="Disable Bridge?"
      message="Everyone will immediately lose access to this app's Bridge. You will need to redeploy after enabling it again."
      confirm-text="Disable Bridge"
      confirm-variant="danger"
      @confirm="disableBridge"
      @cancel="disabling = false"
    />
  </div>
</template>
