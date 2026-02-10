<script setup>
import { Link, Head, router } from '@inertiajs/vue3'
import { inject, ref } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import { useToast } from '@/composables/toast'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  project: Object,
  environment: Object,
  canDelete: Boolean,
  isOnlyEnvironment: Boolean,
  hasApp: Boolean,
  serviceCount: Number
})

const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')
const toast = useToast()

const name = ref(props.environment.name)
const isProduction = ref(props.environment.isProduction)
const saving = ref(false)
const showDeleteConfirm = ref(false)
const deleting = ref(false)

async function save() {
  if (saving.value) return
  saving.value = true

  try {
    const res = await fetch(`/api/v1/projects/${props.project.slug}/environments/${props.environment.slug}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.value,
        isProduction: isProduction.value
      })
    })

    if (res.ok) {
      toast({ message: 'Environment updated', type: 'success' })
      // If name changed, redirect to new slug
      if (name.value !== props.environment.name) {
        const newSlug = name.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
        router.visit(`/projects/${props.project.slug}/environments/${newSlug}/settings`)
      } else {
        router.reload()
      }
    } else {
      const err = await res.json().catch(() => null)
      toast({ message: err?.message || 'Failed to update environment', type: 'error' })
    }
  } finally {
    saving.value = false
  }
}

async function deleteEnvironment() {
  deleting.value = true

  try {
    const res = await fetch(`/api/v1/projects/${props.project.slug}/environments/${props.environment.slug}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' }
    })

    if (res.ok) {
      toast({ message: 'Environment deleted', type: 'success' })
      router.visit(`/projects/${props.project.slug}`)
    } else {
      const err = await res.json().catch(() => null)
      toast({ message: err?.message || 'Failed to delete environment', type: 'error' })
      deleting.value = false
      showDeleteConfirm.value = false
    }
  } catch {
    deleting.value = false
    showDeleteConfirm.value = false
  }
}

// Build reason why deletion is blocked
const deleteBlockedReason = ref('')
if (!props.canDelete) {
  const reasons = []
  if (props.hasApp) reasons.push('has a deployed app')
  if (props.serviceCount > 0) reasons.push(`has ${props.serviceCount} service${props.serviceCount > 1 ? 's' : ''}`)
  deleteBlockedReason.value = `This environment ${reasons.join(' and ')}.`
}
</script>

<template>
  <Head :title="`Settings - ${environment.name} | Slipway`"></Head>
  <div class="flex h-full flex-col">
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
          <Link href="/" class="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">
            projects
          </Link>
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <Link
            :href="`/projects/${project.slug}`"
            class="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >
            {{ project.name.toLowerCase() }}
          </Link>
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <Link
            :href="`/projects/${project.slug}/environments/${environment.slug}`"
            class="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >
            {{ environment.slug }}
          </Link>
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <span class="font-medium text-gray-900 dark:text-white">settings</span>
        </nav>
      </div>
      <div class="flex items-center space-x-4">
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
      <div class="mx-auto max-w-2xl">
        <h1 class="mb-8 text-xl font-semibold text-gray-900 dark:text-white">Environment settings</h1>

        <!-- Settings Form -->
        <form @submit.prevent="save" class="space-y-6">
          <div>
            <label for="name" class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Environment name
            </label>
            <input
              id="name"
              v-model="name"
              type="text"
              class="w-full rounded-md border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none dark:border-gray-800 dark:bg-black dark:text-white dark:placeholder-gray-500"
            />
          </div>

          <div class="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3 dark:border-gray-800">
            <div>
              <label for="isProduction" class="text-sm font-medium text-gray-900 dark:text-white">
                Production environment
              </label>
              <p class="text-sm text-gray-500 dark:text-gray-400">
                Mark this as a production environment for visual distinction
              </p>
            </div>
            <button
              type="button"
              @click="isProduction = !isProduction"
              :class="[
                'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none',
                isProduction ? 'bg-brand' : 'bg-gray-200 dark:bg-gray-700'
              ]"
            >
              <span
                :class="[
                  'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
                  isProduction ? 'translate-x-5' : 'translate-x-0'
                ]"
              />
            </button>
          </div>

          <div class="flex justify-end">
            <button
              type="submit"
              :disabled="saving"
              class="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
            >
              {{ saving ? 'Saving...' : 'Save changes' }}
            </button>
          </div>
        </form>

        <!-- Danger Zone -->
        <div class="mt-12 rounded-lg border border-red-200 dark:border-red-900/50">
          <div class="px-4 py-3">
            <h2 class="text-sm font-medium text-red-600 dark:text-red-400">Danger Zone</h2>
          </div>
          <div class="border-t border-red-200 px-4 py-4 dark:border-red-900/50">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm font-medium text-gray-900 dark:text-white">Delete environment</p>
                <p class="text-sm text-gray-500 dark:text-gray-400">
                  <template v-if="canDelete">
                    Permanently delete this environment and all its data.
                  </template>
                  <template v-else>
                    {{ deleteBlockedReason }} Remove them first to delete.
                  </template>
                </p>
              </div>
              <button
                @click="showDeleteConfirm = true"
                :disabled="!canDelete || isOnlyEnvironment"
                class="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Delete
              </button>
            </div>
            <p v-if="isOnlyEnvironment" class="mt-2 text-xs text-gray-500 dark:text-gray-400">
              Cannot delete the only environment in a project.
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- Delete Confirmation Modal -->
    <ConfirmModal
      :show="showDeleteConfirm"
      title="Delete environment"
      :message="`Are you sure you want to delete '${environment.name}'? This action cannot be undone.`"
      confirm-label="Delete environment"
      :destructive="true"
      :loading="deleting"
      @confirm="deleteEnvironment"
      @cancel="showDeleteConfirm = false"
    />
  </div>
</template>
