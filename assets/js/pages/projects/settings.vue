<script setup>
import { Link, Head, useForm, router } from '@inertiajs/vue3'
import { inject, ref } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'
import Breadcrumb from '@/components/Breadcrumb.vue'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  project: Object,
  webhookUrl: String
})

const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')

const form = useForm({
  name: props.project.name,
  description: props.project.description || '',
  repositoryUrl: props.project.repositoryUrl || ''
})

const deployForm = useForm({
  autoDeploy: props.project.autoDeploy || false,
  autoDeployBranch: props.project.autoDeployBranch || 'main',
  generateWebhookSecret: false
})

const showDeleteConfirm = ref(false)
const copiedWebhook = ref(false)
const copiedSecret = ref(false)

function save() {
  form.patch(`/projects/${props.project.slug}`)
}

function saveDeploySettings() {
  deployForm.patch(`/projects/${props.project.slug}`, {
    onSuccess: () => {
      deployForm.generateWebhookSecret = false
    }
  })
}

function generateSecret() {
  deployForm.generateWebhookSecret = true
  saveDeploySettings()
}

function copyText(text, field) {
  navigator.clipboard.writeText(text)
  if (field === 'webhook') {
    copiedWebhook.value = true
    setTimeout(() => {
      copiedWebhook.value = false
    }, 2000)
  } else {
    copiedSecret.value = true
    setTimeout(() => {
      copiedSecret.value = false
    }, 2000)
  }
}

function deleteProject() {
  router.delete(`/projects/${props.project.slug}`)
}
</script>
<template>
  <Head :title="`Settings - ${project.name} | Slipway`"></Head>
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
        <Breadcrumb
          :items="[
            { label: 'projects', href: '/' },
            {
              label: project.name.toLowerCase(),
              href: `/projects/${project.slug}`
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
    <div class="flex-1 px-4 py-6 sm:px-8 sm:py-8">
      <div class="mx-auto max-w-2xl">
        <h1 class="mb-8 text-xl font-semibold text-gray-900 dark:text-white">
          Project settings
        </h1>

        <!-- Settings Form -->
        <form @submit.prevent="save" class="space-y-6">
          <div>
            <label
              for="name"
              class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Project name
            </label>
            <input
              id="name"
              v-model="form.name"
              type="text"
              class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
            />
            <p v-if="form.errors.name" class="mt-1 text-sm text-red-600">
              {{ form.errors.name }}
            </p>
          </div>

          <div>
            <label
              for="description"
              class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Description
            </label>
            <textarea
              id="description"
              v-model="form.description"
              placeholder="A brief description about your project"
              class="focus:border-brand w-full resize-none border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
              style="field-sizing: content"
            ></textarea>
          </div>

          <div>
            <label
              for="repositoryUrl"
              class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Repository URL
            </label>
            <input
              id="repositoryUrl"
              v-model="form.repositoryUrl"
              type="url"
              placeholder="https://github.com/your-org/your-repo"
              class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
            />
          </div>

          <div class="flex justify-end">
            <button
              type="submit"
              :disabled="form.processing || !form.isDirty"
              class="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
            >
              {{ form.processing ? 'Saving...' : 'Save changes' }}
            </button>
          </div>
        </form>

        <!-- Auto-Deploy -->
        <div
          class="mt-12 rounded-lg border border-gray-200 p-6 dark:border-gray-800"
        >
          <h3 class="text-sm font-semibold text-gray-900 dark:text-white">
            Auto-deploy
          </h3>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Automatically deploy when you push to GitHub.
          </p>

          <div class="mt-6 space-y-4">
            <!-- Enable toggle -->
            <label class="flex items-center space-x-3">
              <input
                type="checkbox"
                v-model="deployForm.autoDeploy"
                @change="saveDeploySettings"
                class="text-brand focus:ring-brand h-4 w-4 rounded border-gray-300 dark:border-gray-600 dark:bg-gray-900"
              />
              <span class="text-sm text-gray-700 dark:text-gray-300"
                >Enable auto-deploy on push</span
              >
            </label>

            <!-- Branch -->
            <div v-if="deployForm.autoDeploy">
              <label
                class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                Deploy branch
              </label>
              <div class="flex items-center space-x-2">
                <input
                  v-model="deployForm.autoDeployBranch"
                  type="text"
                  placeholder="main"
                  class="focus:border-brand w-40 border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 focus:outline-none dark:border-gray-700 dark:text-white"
                />
                <button
                  @click="saveDeploySettings"
                  :disabled="deployForm.processing"
                  class="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
                >
                  Save
                </button>
              </div>
            </div>

            <!-- Webhook URL -->
            <div v-if="deployForm.autoDeploy">
              <label
                class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                Webhook URL
              </label>
              <div class="flex items-center space-x-2">
                <code
                  class="flex-1 truncate rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300"
                >
                  {{ webhookUrl }}
                </code>
                <button
                  @click="copyText(webhookUrl, 'webhook')"
                  class="shrink-0 rounded-md border border-gray-200 px-3 py-2 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
                >
                  {{ copiedWebhook ? 'Copied!' : 'Copy' }}
                </button>
              </div>
            </div>

            <!-- Webhook Secret -->
            <div v-if="deployForm.autoDeploy">
              <label
                class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                Webhook secret
              </label>
              <div
                v-if="project.webhookSecret"
                class="flex items-center space-x-2"
              >
                <code
                  class="flex-1 truncate rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300"
                >
                  {{ project.webhookSecret.slice(0, 12) }}••••••••
                </code>
                <button
                  @click="copyText(project.webhookSecret, 'secret')"
                  class="shrink-0 rounded-md border border-gray-200 px-3 py-2 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
                >
                  {{ copiedSecret ? 'Copied!' : 'Copy' }}
                </button>
                <button
                  @click="generateSecret"
                  :disabled="deployForm.processing"
                  class="shrink-0 rounded-md border border-gray-200 px-3 py-2 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
                >
                  Regenerate
                </button>
              </div>
              <button
                v-else
                @click="generateSecret"
                :disabled="deployForm.processing"
                class="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
              >
                Generate secret
              </button>
              <p class="mt-1 text-xs text-gray-400 dark:text-gray-500">
                Add this as the webhook secret in your GitHub repo settings.
              </p>
            </div>
          </div>
        </div>

        <!-- Danger Zone -->
        <div
          class="mt-12 rounded-lg border border-red-200 p-6 dark:border-red-900/50"
        >
          <h3 class="text-sm font-medium text-red-600 dark:text-red-400">
            Danger zone
          </h3>
          <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Permanently delete this project and all of its environments,
            deployments, and services. This action cannot be undone.
          </p>
          <div class="mt-4">
            <button
              v-if="!showDeleteConfirm"
              @click="showDeleteConfirm = true"
              class="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
            >
              Delete project
            </button>
            <div v-else class="flex items-center space-x-3">
              <button
                @click="deleteProject"
                class="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                Yes, delete "{{ project.name }}"
              </button>
              <button
                @click="showDeleteConfirm = false"
                class="rounded-md px-3 py-2 text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
