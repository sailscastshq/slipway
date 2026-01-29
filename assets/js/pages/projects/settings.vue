<script setup>
import { Link, Head, useForm, router } from '@inertiajs/vue3'
import { inject, ref } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  project: Object
})

const toggleMobileMenu = inject('toggleMobileMenu')

const form = useForm({
  name: props.project.name,
  description: props.project.description || '',
  repositoryUrl: props.project.repositoryUrl || ''
})

const showDeleteConfirm = ref(false)

function save() {
  form.patch(`/projects/${props.project.slug}`)
}

function deleteProject() {
  router.delete(`/projects/${props.project.slug}`)
}
</script>
<template>
  <Head :title="`Settings - ${project.name} | Slipway`"></Head>
  <div class="flex h-full flex-col">
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-gray-200 px-4 py-4 dark:border-gray-800 sm:px-8">
      <div class="flex items-center space-x-3">
        <button
          @click="toggleMobileMenu"
          class="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white md:hidden"
        >
          <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <nav class="flex items-center space-x-2 text-sm">
          <Link href="/" class="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">
            Projects
          </Link>
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <Link
            :href="`/projects/${project.slug}`"
            class="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >
            {{ project.name }}
          </Link>
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <span class="font-medium text-gray-900 dark:text-white">Settings</span>
        </nav>
      </div>
      <a
        href="https://docs.sailscasts.com/slipway"
        target="_blank"
        class="text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
      >
        Docs
      </a>
    </div>

    <!-- Content -->
    <div class="flex-1 px-4 py-6 sm:px-8 sm:py-8">
      <div class="mx-auto max-w-2xl">
        <h1 class="mb-8 text-xl font-semibold text-gray-900 dark:text-white">Project settings</h1>

        <!-- Settings Form -->
        <form @submit.prevent="save" class="space-y-6">
          <div>
            <label for="name" class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Project name
            </label>
            <input
              id="name"
              v-model="form.name"
              type="text"
              class="w-full rounded-md border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none dark:border-gray-800 dark:bg-black dark:text-white dark:placeholder-gray-500"
            />
            <p v-if="form.errors.name" class="mt-1 text-sm text-red-600">{{ form.errors.name }}</p>
          </div>

          <div>
            <label for="description" class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Description
            </label>
            <textarea
              id="description"
              v-model="form.description"
              rows="3"
              placeholder="A brief description about your project"
              class="w-full resize-none rounded-md border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none dark:border-gray-800 dark:bg-black dark:text-white dark:placeholder-gray-500"
            ></textarea>
          </div>

          <div>
            <label for="repositoryUrl" class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Repository URL
            </label>
            <input
              id="repositoryUrl"
              v-model="form.repositoryUrl"
              type="url"
              placeholder="https://github.com/your-org/your-repo"
              class="w-full rounded-md border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none dark:border-gray-800 dark:bg-black dark:text-white dark:placeholder-gray-500"
            />
          </div>

          <div class="flex justify-end">
            <button
              type="submit"
              :disabled="form.processing"
              class="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
            >
              {{ form.processing ? 'Saving...' : 'Save changes' }}
            </button>
          </div>
        </form>

        <!-- Danger Zone -->
        <div class="mt-16 rounded-lg border border-red-200 p-6 dark:border-red-900/50">
          <h3 class="text-sm font-medium text-red-600 dark:text-red-400">Danger zone</h3>
          <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Permanently delete this project and all of its environments, deployments, and services. This action cannot be undone.
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
