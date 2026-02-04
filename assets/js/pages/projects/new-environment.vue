<script setup>
import { useForm, Head, Link } from '@inertiajs/vue3'
import { inject } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  project: Object
})

const form = useForm({
  name: ''
})

const submit = () => {
  form.post(`/projects/${props.project.slug}/environments`)
}

const toggleMobileMenu = inject('toggleMobileMenu')
</script>
<template>
  <Head :title="`Create Environment | ${project.name} | Slipway`"></Head>
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
          <span class="font-medium text-gray-900 dark:text-white">
            <span class="hidden sm:inline">create environment</span>
            <span class="sm:hidden">new</span>
          </span>
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
    <div class="mx-auto w-full max-w-5xl flex-1 px-4 pt-8 pb-8 sm:px-8 sm:pt-16">
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
              placeholder="Environment name"
              autofocus
              class="h-12 w-full rounded-md border border-gray-200 bg-white px-4 text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none dark:border-gray-800 dark:bg-black dark:text-white dark:placeholder-gray-500"
            />

            <div class="flex items-center justify-end space-x-3 pt-4">
              <Link
                :href="`/projects/${project.slug}`"
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
