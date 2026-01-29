<script setup>
import { Link, Head, router } from '@inertiajs/vue3'
import { inject, ref, computed, onMounted, onUnmounted } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  projects: {
    type: Array,
    default: () => []
  }
})

const toggleMobileMenu = inject('toggleMobileMenu')
const searchQuery = ref('')
const openMenuId = ref(null)
const copiedSlug = ref(null)

const filteredProjects = computed(() => {
  if (!searchQuery.value) return props.projects
  const query = searchQuery.value.toLowerCase()
  return props.projects.filter(project =>
    project.name.toLowerCase().includes(query) ||
    (project.description && project.description.toLowerCase().includes(query))
  )
})

function timeAgo(date) {
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
    if (count >= 1) {
      return `${count} ${interval.label}${count > 1 ? 's' : ''} ago`
    }
  }

  return 'just now'
}

function toggleMenu(e, projectId) {
  e.preventDefault()
  e.stopPropagation()
  openMenuId.value = openMenuId.value === projectId ? null : projectId
}

function closeMenu() {
  openMenuId.value = null
}

function copySlug(e, slug) {
  e.preventDefault()
  e.stopPropagation()
  navigator.clipboard.writeText(slug)
  copiedSlug.value = slug
  setTimeout(() => {
    copiedSlug.value = null
  }, 2000)
  closeMenu()
}

const deletingProject = ref(null)

function deleteProject(e, project) {
  e.preventDefault()
  e.stopPropagation()
  deletingProject.value = project
  closeMenu()
}

function executeDeleteProject() {
  if (!deletingProject.value) return
  router.delete(`/projects/${deletingProject.value.slug}`)
  deletingProject.value = null
}

function cancelDeleteProject() {
  deletingProject.value = null
}

// Close menu when clicking outside
function handleClickOutside(e) {
  if (openMenuId.value && !e.target.closest('.relative')) {
    closeMenu()
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>
<template>
  <Head title="Projects | Slipway"></Head>
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
        <nav class="flex items-center text-sm">
          <span class="font-medium text-gray-900 dark:text-white">projects</span>
        </nav>
      </div>
      <div class="flex items-center space-x-4">
        <a
          href="https://docs.sailscasts.com/slipway"
          target="_blank"
          class="text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
        >
          Docs
        </a>
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 px-4 py-6 sm:px-8 sm:py-8">
      <!-- Projects Table -->
      <div v-if="projects.length > 0" class="mx-auto max-w-6xl">
        <!-- Toolbar: Search + Create Button -->
        <div class="mb-4 flex items-center justify-between">
          <div class="relative">
            <svg
              class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              v-model="searchQuery"
              type="text"
              placeholder="Search..."
              class="w-full rounded-lg border border-gray-200 bg-white py-2 pl-10 pr-4 text-sm text-gray-900 placeholder-gray-400 focus:border-gray-300 focus:outline-none focus:ring-0 dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:placeholder-gray-500 dark:focus:border-gray-600 sm:w-64"
            />
          </div>
          <Link
            href="/projects/new"
            class="flex items-center space-x-1 rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
          >
            <span>+</span>
            <span class="hidden sm:inline">Create Project</span>
            <span class="sm:hidden">New</span>
          </Link>
        </div>

        <!-- Table -->
        <div class="rounded-lg border border-gray-200 dark:border-gray-800">
          <!-- Table Header -->
          <div
            class="grid grid-cols-12 gap-4 rounded-t-lg border-b border-gray-200 bg-gray-50/50 px-6 py-2 text-xs font-medium text-gray-500 dark:border-gray-800 dark:bg-gray-900/50"
          >
            <div class="col-span-5">Name</div>
            <div class="col-span-4">Status</div>
            <div class="col-span-3 pr-10 text-right">Last updated</div>
          </div>

          <!-- Table Body -->
          <div class="divide-y divide-gray-200 rounded-b-lg bg-white dark:divide-gray-800 dark:bg-gray-950">
            <div
              v-for="project in filteredProjects"
              :key="project.id"
              class="grid grid-cols-12 items-center gap-4 px-6 py-4"
            >
              <div class="col-span-5">
                <div class="flex items-center space-x-3">
                  <div
                    class="flex h-8 w-8 items-center justify-center rounded-md bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
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
                  <div class="group/name flex min-w-0 items-center space-x-1.5">
                    <Link
                      :href="`/projects/${project.slug}`"
                      class="font-medium text-gray-900 underline decoration-dashed decoration-gray-300 underline-offset-2 hover:text-gray-700 dark:text-white dark:decoration-gray-600 dark:hover:text-gray-300"
                    >
                      {{ project.name }}
                    </Link>
                    <button
                      @click="copySlug($event, project.slug)"
                      class="opacity-0 transition-opacity group-hover/name:opacity-100"
                      :class="{ 'opacity-100': copiedSlug === project.slug }"
                    >
                      <svg
                        v-if="copiedSlug === project.slug"
                        class="h-3.5 w-3.5 text-green-500"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                      </svg>
                      <svg
                        v-else
                        class="h-3.5 w-3.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
              <div class="col-span-4">
                <span
                  class="inline-flex items-center rounded-md bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                >
                  No deployments
                </span>
              </div>
              <div class="col-span-3 flex items-center justify-end space-x-3">
                <span class="text-sm text-gray-500 dark:text-gray-400">
                  {{ timeAgo(project.updatedAt) }}
                </span>
                <!-- Actions Menu -->
                <div class="relative">
                  <button
                    @click="toggleMenu($event, project.id)"
                    class="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                  >
                    <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M6 10a2 2 0 11-4 0 2 2 0 014 0zm6 0a2 2 0 11-4 0 2 2 0 014 0zm6 0a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                  </button>
                  <!-- Dropdown -->
                  <div
                    v-if="openMenuId === project.id"
                    class="absolute right-0 z-10 mt-1 w-40 rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
                  >
                    <Link
                      :href="`/projects/${project.slug}/settings`"
                      class="flex w-full items-center px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      <svg class="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                      Edit
                    </Link>
                    <a
                      v-if="project.repositoryUrl"
                      :href="project.repositoryUrl"
                      target="_blank"
                      class="flex w-full items-center px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                      @click.stop
                    >
                      <svg class="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                      View repo
                    </a>
                    <button
                      @click="copySlug($event, project.slug)"
                      class="flex w-full items-center px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      <svg class="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      Copy slug
                    </button>
                    <div class="my-1 border-t border-gray-200 dark:border-gray-700"></div>
                    <button
                      @click="deleteProject($event, project)"
                      class="flex w-full items-center px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                    >
                      <svg class="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <!-- No results -->
            <div
              v-if="filteredProjects.length === 0"
              class="px-6 py-8 text-center text-sm text-gray-500"
            >
              No projects found matching "{{ searchQuery }}"
            </div>
          </div>
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

    <ConfirmModal
      :show="!!deletingProject"
      title="Delete project"
      :message="`Are you sure you want to delete &quot;${deletingProject?.name}&quot;? This action cannot be undone.`"
      confirm-label="Delete"
      :destructive="true"
      @confirm="executeDeleteProject"
      @cancel="cancelDeleteProject"
    />
  </div>
</template>
