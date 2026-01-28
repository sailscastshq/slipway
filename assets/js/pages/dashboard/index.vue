<script setup>
import { Link, Head } from '@inertiajs/vue3'
import AppLayout from '@/layouts/AppLayout.vue'

defineOptions({
  layout: AppLayout
})

defineProps({
  projects: {
    type: Array,
    default: () => []
  }
})
</script>
<template>
  <Head title="Projects | Slipway"></Head>
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
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-semibold text-gray-900 dark:text-white">Projects</h1>
        <div v-if="projects.length > 0" class="flex items-center space-x-2">
          <Link
            href="/projects/new"
            class="flex items-center space-x-1 rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
          >
            <span>+</span>
            <span>Create Project</span>
          </Link>
        </div>
      </div>
    </div>

    <!-- Content -->
    <div class="mx-auto w-full max-w-5xl flex-1 px-8">
      <!-- Projects Table -->
      <div v-if="projects.length > 0" class="border border-gray-200 dark:border-gray-800">
        <!-- Table Header -->
        <div
          class="grid grid-cols-12 gap-4 border-b border-gray-200 px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-500 dark:border-gray-800"
        >
          <div class="col-span-5">Name</div>
          <div class="col-span-3">Status</div>
          <div class="col-span-4 text-right">Created</div>
        </div>

        <!-- Table Body -->
        <div class="divide-y divide-gray-200 dark:divide-gray-800">
          <Link
            v-for="project in projects"
            :key="project.id"
            :href="`/projects/${project.slug}`"
            class="grid grid-cols-12 gap-4 px-4 py-4 transition-colors hover:bg-gray-100/50 dark:hover:bg-gray-900/50"
          >
            <div class="col-span-5">
              <div class="flex items-center space-x-3">
                <div
                  class="flex h-8 w-8 items-center justify-center bg-gray-100 text-sm text-gray-500 dark:bg-gray-800 dark:text-gray-400"
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
                      stroke-width="1.5"
                      d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                    />
                  </svg>
                </div>
                <div>
                  <p class="font-medium text-gray-900 dark:text-white">{{ project.name }}</p>
                  <p
                    v-if="project.description"
                    class="text-sm text-gray-500"
                  >
                    {{ project.description }}
                  </p>
                </div>
              </div>
            </div>
            <div class="col-span-3 flex items-center">
              <span
                class="inline-flex items-center bg-gray-100 px-2 py-1 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400"
              >
                No deployments
              </span>
            </div>
            <div class="col-span-4 flex items-center justify-end text-sm text-gray-500">
              {{ new Date(project.createdAt).toLocaleDateString() }}
            </div>
          </Link>
        </div>
      </div>

      <!-- Empty State -->
      <div
        v-else
        class="flex flex-col items-center justify-center py-24"
      >
        <div
          class="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800"
        >
          <svg
            class="h-6 w-6 text-gray-500 dark:text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.5"
              d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
            />
          </svg>
        </div>
        <h3 class="mb-1 text-lg font-medium text-gray-900 dark:text-white">No projects yet</h3>
        <p class="mb-6 text-sm text-gray-500">
          Get started by creating your first project.
        </p>
        <Link
          href="/projects/new"
          class="flex items-center space-x-1 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
        >
          <span>+</span>
          <span>Create Project</span>
        </Link>
      </div>
    </div>
  </div>
</template>
