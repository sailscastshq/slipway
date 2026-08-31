<script setup>
import SidebarOpen from '@/components/ui/icons/SidebarOpen.vue'
import SidebarClose from '@/components/ui/icons/SidebarClose.vue'
import ExternalLink from '@/components/ui/icons/ExternalLink.vue'
import Input from '@/components/ui/input/Input.vue'
import Checkbox from '@/components/ui/checkbox/Checkbox.vue'
import { Link, Head, router, useForm } from '@inertiajs/vue3'
import { inject, ref, computed } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'
import Breadcrumb from '@/components/ui/breadcrumb/Breadcrumb.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import { useToast } from '@/composables/toast'
import { usePrecognitionValidation } from '@/composables/precognition'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  project: Object,
  environment: Object,
  isOnlyEnvironment: Boolean
})

const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')
const toast = useToast()

const settingsUrl = `/api/v1/projects/${props.project.slug}/environments/${props.environment.slug}`
const form = useForm({
  name: props.environment.name,
  isProduction: props.environment.isProduction
})
  .withPrecognition('patch', settingsUrl)
  .setValidationTimeout(350)
const { applyResponseProblems, revalidateWhenInvalid, validateOnBlur } =
  usePrecognitionValidation(form)
const saving = ref(false)

const isDirty = computed(
  () =>
    form.name !== props.environment.name ||
    form.isProduction !== props.environment.isProduction
)
const showDeleteConfirm = ref(false)
const deleting = ref(false)
const purgeData = ref(false)

async function save() {
  if (saving.value) return
  saving.value = true

  try {
    const res = await fetch(settingsUrl, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name,
        isProduction: form.isProduction
      })
    })

    if (res.ok) {
      toast({ message: 'Environment updated', type: 'success' })
      router.reload()
    } else {
      const err = await res.json().catch(() => null)
      applyResponseProblems(err?.problems)
      toast({
        message: err?.message || 'Failed to update environment',
        type: 'error'
      })
    }
  } finally {
    saving.value = false
  }
}

async function deleteEnvironment() {
  deleting.value = true

  try {
    const res = await fetch(
      `/api/v1/projects/${props.project.slug}/environments/${props.environment.slug}`,
      {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purgeData: purgeData.value })
      }
    )

    if (res.ok) {
      toast({ message: 'Environment deleted', type: 'success' })
      router.visit(`/projects/${props.project.slug}`)
    } else {
      const err = await res.json().catch(() => null)
      toast({
        message: err?.message || 'Failed to delete environment',
        type: 'error'
      })
      deleting.value = false
      showDeleteConfirm.value = false
    }
  } catch (error) {
    toast({
      message: error.message || 'Failed to delete environment',
      type: 'error'
    })
    deleting.value = false
    showDeleteConfirm.value = false
  }
}

function openDeleteEnvironment() {
  purgeData.value = false
  showDeleteConfirm.value = true
}
</script>

<template>
  <Head :title="`Settings - ${environment.name} | Slipway`"></Head>
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
        <Breadcrumb
          :items="[
            { label: 'projects', href: '/' },
            {
              label: project.name.toLowerCase(),
              href: `/projects/${project.slug}`
            },
            {
              label: environment.slug,
              href: `/projects/${project.slug}/environments/${environment.slug}`
            },
            { label: 'settings' }
          ]"
        />
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
      <div class="mx-auto max-w-2xl">
        <h1 class="mb-8 text-xl font-semibold text-gray-900 dark:text-white">
          Environment settings
        </h1>

        <!-- Settings Form -->
        <form @submit.prevent="save" class="space-y-6">
          <div>
            <label
              for="name"
              class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Environment
            </label>
            <Input
              id="name"
              v-model="form.name"
              type="text"
              :aria-invalid="form.invalid('name')"
              :aria-describedby="
                form.errors.name ? 'environment-name-error' : null
              "
              class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
              @blur="validateOnBlur('name', $event)"
              @input="revalidateWhenInvalid('name')"
            />
            <p
              v-if="form.errors.name"
              id="environment-name-error"
              class="mt-1 text-sm text-red-600 dark:text-red-400"
            >
              {{ form.errors.name }}
            </p>
          </div>

          <div
            class="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3 dark:border-gray-800"
          >
            <div>
              <label
                for="isProduction"
                class="text-sm font-medium text-gray-900 dark:text-white"
              >
                Production environment
              </label>
              <p class="text-sm text-gray-500 dark:text-gray-400">
                Mark this as a production environment for visual distinction
              </p>
            </div>
            <button
              type="button"
              @click="form.isProduction = !form.isProduction"
              :class="[
                'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none',
                form.isProduction ? 'bg-brand' : 'bg-gray-200 dark:bg-gray-700'
              ]"
            >
              <span
                :class="[
                  'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
                  form.isProduction ? 'translate-x-5' : 'translate-x-0'
                ]"
              />
            </button>
          </div>

          <div class="flex justify-end">
            <button
              type="submit"
              :disabled="saving || form.hasErrors || !isDirty"
              class="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
            >
              {{ saving ? 'Saving...' : 'Save changes' }}
            </button>
          </div>
        </form>

        <!-- Danger Zone -->
        <div
          class="mt-12 rounded-lg border border-red-200 dark:border-red-900/50"
        >
          <div class="px-4 py-3">
            <h2 class="text-sm font-medium text-red-600 dark:text-red-400">
              Danger Zone
            </h2>
          </div>
          <div class="border-t border-red-200 px-4 py-4 dark:border-red-900/50">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm font-medium text-gray-900 dark:text-white">
                  Delete environment
                </p>
                <p class="text-sm text-gray-500 dark:text-gray-400">
                  Delete this environment and stop its apps and services.
                </p>
              </div>
              <button
                @click="openDeleteEnvironment"
                :disabled="isOnlyEnvironment"
                class="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Delete
              </button>
            </div>
            <p
              v-if="isOnlyEnvironment"
              class="mt-2 text-xs text-gray-500 dark:text-gray-400"
            >
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
      :message="`Are you sure you want to delete '${environment.name}'? Recovery data is retained unless you choose to purge it.`"
      confirm-label="Delete environment"
      :destructive="true"
      :loading="deleting"
      @confirm="deleteEnvironment"
      @cancel="showDeleteConfirm = false"
    >
      <template #form>
        <label class="mt-4 flex cursor-pointer items-start gap-3">
          <Checkbox
            v-model="purgeData"
            class="mt-0.5 h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500 dark:border-gray-600 dark:bg-gray-800"
          />
          <span>
            <span class="block text-sm text-gray-700 dark:text-gray-300">
              Also permanently delete retained data
            </span>
            <span class="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
              Purges service volumes, backups, and Docker images.
            </span>
          </span>
        </label>
      </template>
    </ConfirmModal>
  </div>
</template>
