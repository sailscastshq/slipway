<script setup>
import { Link, Head, router } from '@inertiajs/vue3'
import { inject, ref, computed } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  tokens: Array
})

const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')

const search = ref('')

const filtered = computed(() => {
  const q = search.value.toLowerCase().trim()
  if (!q) return props.tokens
  return props.tokens.filter(
    (t) => t.name.toLowerCase().includes(q) || t.token.toLowerCase().includes(q)
  )
})

// Actions menu
const openMenu = ref(null)

function toggleMenu(tokenId) {
  openMenu.value = openMenu.value === tokenId ? null : tokenId
}

function closeMenu() {
  openMenu.value = null
}

// Rename
const renamingId = ref(null)
const renameValue = ref('')

function startRename(token) {
  renamingId.value = token.id
  renameValue.value = token.name
  openMenu.value = null
}

function submitRename(tokenId) {
  if (!renameValue.value.trim()) return
  router.patch(
    `/settings/cli-tokens/${tokenId}`,
    {
      name: renameValue.value.trim()
    },
    {
      preserveScroll: true,
      onSuccess: () => {
        renamingId.value = null
      }
    }
  )
}

function cancelRename() {
  renamingId.value = null
}

// Delete
const deletingId = ref(null)

function confirmDelete(token) {
  deletingId.value = token.id
  openMenu.value = null
}

function executeDelete() {
  router.delete(`/settings/cli-tokens/${deletingId.value}`, {
    preserveScroll: true,
    onSuccess: () => {
      deletingId.value = null
    }
  })
}

function cancelDelete() {
  deletingId.value = null
}

function timeAgo(date) {
  if (!date) return 'No activity'
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
  <Head title="CLI Tokens | Slipway"></Head>
  <div class="flex h-full flex-col" @click="closeMenu">
    <!-- Header -->
    <div
      class="flex items-center justify-between border-b border-gray-200 py-4 pl-4 pr-4 dark:border-gray-800 sm:pl-4 sm:pr-8"
    >
      <div class="flex items-center space-x-3">
        <button
          @click="toggleMobileMenu"
          class="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white md:hidden"
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
              stroke-width="1"
            />
            <path
              d="M5.615 14.285V.715"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1"
            />
            <path
              d="M2.6 5.992 3.919 7.5 2.6 9.008"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1"
            />
          </svg>
        </button>
        <!-- Desktop sidebar toggle -->
        <button
          @click="toggleSidebar"
          class="hidden text-gray-400 dark:text-gray-500 md:block"
        >
          <svg
            v-if="sidebarCollapsed"
            class="h-5 w-5"
            viewBox="-0.5 -0.5 16 16"
            fill="none"
            stroke="currentColor"
          >
            <path
              d="M12.777 14.285H2.223c-.833 0-1.508-.675-1.508-1.508V2.223c0-.833.675-1.508 1.508-1.508h10.554c.833 0 1.508.675 1.508 1.508v10.554c0 .833-.675 1.508-1.508 1.508Z"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1"
            />
            <path
              d="M5.615 14.285V.715"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1"
            />
            <path
              d="M2.6 5.992 3.919 7.5 2.6 9.008"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1"
            />
          </svg>
          <svg
            v-else
            class="h-5 w-5"
            viewBox="-0.5 -0.5 16 16"
            fill="none"
            stroke="currentColor"
          >
            <path
              d="M12.777 14.285H2.223c-.833 0-1.508-.675-1.508-1.508V2.223c0-.833.675-1.508 1.508-1.508h10.554c.833 0 1.508.675 1.508 1.508v10.554c0 .833-.675 1.508-1.508 1.508Z"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1"
            />
            <path
              d="M5.615 14.285V.715"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1"
            />
            <path
              d="M3.919 5.992 2.6 7.5l1.319 1.508"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1"
            />
          </svg>
        </button>
        <nav class="flex items-center space-x-2 text-sm">
          <Link
            href="/settings"
            class="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >
            settings
          </Link>
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <span class="font-medium text-gray-900 dark:text-white"
            >cli tokens</span
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
          <svg
            class="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
            />
          </svg>
        </a>
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
      <div class="mx-auto max-w-6xl">
        <!-- Search -->
        <div v-if="tokens.length > 0" class="mb-6">
          <input
            v-model="search"
            type="text"
            placeholder="Search tokens..."
            class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500 sm:w-64"
          />
        </div>

        <div
          v-if="filtered.length > 0"
          class="rounded-lg border border-gray-200 dark:border-gray-800"
        >
          <!-- Table Header -->
          <div
            class="grid grid-cols-12 gap-4 rounded-t-lg border-b border-gray-200 bg-gray-50/50 px-6 py-2 text-xs font-medium text-gray-500 dark:border-gray-800 dark:bg-gray-900/50"
          >
            <div class="col-span-3">Name</div>
            <div class="col-span-3">Token</div>
            <div class="col-span-2">Last used</div>
            <div class="col-span-3">Created</div>
            <div class="col-span-1"></div>
          </div>

          <!-- Table Body -->
          <div
            class="divide-y divide-gray-200 rounded-b-lg bg-white dark:divide-gray-800 dark:bg-gray-950"
          >
            <div
              v-for="token in filtered"
              :key="token.id"
              class="grid grid-cols-12 items-center gap-4 px-6 py-4"
            >
              <!-- Name -->
              <div class="col-span-3">
                <template v-if="renamingId === token.id">
                  <div class="flex items-center space-x-2">
                    <input
                      v-model="renameValue"
                      @keydown.enter="submitRename(token.id)"
                      @keydown.escape="cancelRename"
                      ref="renameInput"
                      autofocus
                      class="focus:border-brand w-full rounded-md border border-gray-200 bg-white px-2 py-1 text-sm text-gray-900 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                    />
                    <button
                      @click="submitRename(token.id)"
                      class="rounded p-1 text-gray-400 hover:text-green-600 dark:hover:text-green-400"
                    >
                      <svg
                        class="h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    </button>
                    <button
                      @click="cancelRename"
                      class="rounded p-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400"
                    >
                      <svg
                        class="h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </div>
                </template>
                <template v-else>
                  <div class="flex items-center space-x-2">
                    <svg
                      class="h-4 w-4 text-green-600 dark:text-green-500"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="1.5"
                        d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
                      />
                    </svg>
                    <span
                      class="text-sm font-medium text-gray-900 dark:text-white"
                      >{{ token.name }}</span
                    >
                  </div>
                </template>
              </div>

              <!-- Token -->
              <div class="col-span-3">
                <code class="text-sm text-gray-500 dark:text-gray-400"
                  >{{ token.token }}••••••••</code
                >
              </div>

              <!-- Last Used -->
              <div class="col-span-2">
                <span class="text-sm text-gray-500 dark:text-gray-400">
                  {{ timeAgo(token.lastUsedAt) }}
                </span>
              </div>

              <!-- Created -->
              <div class="col-span-3">
                <span class="text-sm text-gray-500 dark:text-gray-400">
                  {{ timeAgo(token.createdAt) }}
                </span>
              </div>

              <!-- Actions -->
              <div class="col-span-1 flex justify-end">
                <div class="relative">
                  <button
                    @click.stop="toggleMenu(token.id)"
                    class="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                  >
                    <svg
                      class="h-5 w-5"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z"
                      />
                    </svg>
                  </button>

                  <!-- Dropdown menu -->
                  <div
                    v-if="openMenu === token.id"
                    class="absolute right-0 z-10 mt-1 w-36 rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
                  >
                    <button
                      @click.stop="startRename(token)"
                      class="flex w-full items-center px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      <svg
                        class="mr-2 h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                        />
                      </svg>
                      Rename
                    </button>
                    <button
                      @click.stop="confirmDelete(token)"
                      class="flex w-full items-center px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                    >
                      <svg
                        class="mr-2 h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- No search results -->
        <div
          v-else-if="tokens.length > 0"
          class="py-8 text-center text-sm text-gray-500 dark:text-gray-400"
        >
          No tokens matching "{{ search }}"
        </div>

        <!-- Empty state -->
        <div
          v-else
          class="rounded-lg border border-dashed border-gray-300 px-6 py-12 text-center dark:border-gray-700"
        >
          <svg
            class="mx-auto h-10 w-10 text-gray-400 dark:text-gray-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.5"
              d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
            />
          </svg>
          <p class="mt-3 text-sm text-gray-500 dark:text-gray-400">
            No CLI keys yet.
          </p>
          <p class="mt-1 text-sm text-gray-400 dark:text-gray-500">
            Log in with the CLI to create one:
            <code
              class="rounded bg-gray-100 px-1.5 py-0.5 text-xs dark:bg-gray-800"
              >slipway login</code
            >
          </p>
        </div>
      </div>
    </div>

    <ConfirmModal
      :show="!!deletingId"
      title="Revoke CLI key"
      message="This will permanently revoke this CLI key. Any CLI sessions using it will be disconnected."
      confirm-label="Revoke key"
      :destructive="true"
      @confirm="executeDelete"
      @cancel="cancelDelete"
    />
  </div>
</template>
