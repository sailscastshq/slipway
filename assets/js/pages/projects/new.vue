<script setup>
import { useForm, Head, Link } from '@inertiajs/vue3'
import AppLayout from '@/layouts/AppLayout.vue'

defineOptions({
  layout: AppLayout
})

const form = useForm({
  name: '',
  description: ''
})

const submit = () => {
  form.post('/projects')
}
</script>
<template>
  <Head title="Create Project | Slipway"></Head>
  <div class="flex h-full flex-col">
    <!-- Top Bar -->
    <div class="flex items-center justify-end border-b border-gray-200 px-8 py-3 dark:border-gray-800">
      <div class="flex items-center space-x-4 text-sm">
        <a
          href="https://docs.sailscasts.com/slipway"
          target="_blank"
          class="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
        >
          Docs
        </a>
      </div>
    </div>

    <!-- Page Header -->
    <div class="mx-auto w-full max-w-5xl px-8 py-8">
      <div class="flex items-center space-x-4">
        <Link
          href="/"
          class="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
        >
          <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
        </Link>
        <h1 class="text-2xl font-semibold text-gray-900 dark:text-white">Create Project</h1>
      </div>
    </div>

    <!-- Content -->
    <div class="mx-auto w-full max-w-5xl flex-1 px-8">
      <div class="flex justify-center">
        <div class="w-full max-w-md">
          <!-- Error message -->
          <div
            v-if="form.errors.name"
            class="mb-6 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400"
          >
            {{ form.errors.name }}
          </div>

          <form @submit.prevent="submit" class="space-y-4">
            <input
              id="name"
              v-model="form.name"
              type="text"
              placeholder="Project name"
              class="h-12 w-full rounded-md border border-gray-200 bg-white px-4 text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none dark:border-gray-800 dark:bg-black dark:text-white dark:placeholder-gray-500"
            />

            <textarea
              id="description"
              v-model="form.description"
              rows="3"
              placeholder="Description (optional)"
              class="w-full resize-none rounded-md border border-gray-200 bg-white px-4 py-3 text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none dark:border-gray-800 dark:bg-black dark:text-white dark:placeholder-gray-500"
            ></textarea>

            <div class="flex items-center justify-end space-x-3 pt-4">
              <Link
                href="/"
                class="rounded-md px-3 py-1.5 text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
              >
                Cancel
              </Link>
              <button
                type="submit"
                :disabled="form.processing || !form.name"
                class="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
              >
                {{ form.processing ? 'Creating...' : 'Create' }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  </div>
</template>
