<script setup>
import SidebarOpen from '@/components/ui/icons/SidebarOpen.vue'
import SidebarClose from '@/components/ui/icons/SidebarClose.vue'
import ExternalLink from '@/components/ui/icons/ExternalLink.vue'
import EllipsisHorizontal from '@/components/ui/icons/EllipsisHorizontal.vue'
import Edit from '@/components/ui/icons/Edit.vue'
import Check from '@/components/ui/icons/Check.vue'
import Input from '@/components/ui/input/Input.vue'
import Button from '@/components/ui/button/Button.vue'
import Checkbox from '@/components/ui/checkbox/Checkbox.vue'
import { Link, Head, useForm } from '@inertiajs/vue3'
import { inject, ref, computed, nextTick } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import Menu from '@/components/ui/menu/Menu.vue'
import EmptyState from '@/components/ui/empty-state/EmptyState.vue'
import Copy from '@/components/ui/icons/Copy.vue'
import Folder from '@/components/ui/icons/Folder.vue'
import Trash from '@/components/ui/icons/Trash.vue'

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
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')
const searchQuery = ref('')
const searchInput = ref()
const copiedSlug = ref(null)

const filteredProjects = computed(() => {
  if (!searchQuery.value) return props.projects
  const query = searchQuery.value.toLowerCase()
  return props.projects.filter(
    (project) =>
      project.name.toLowerCase().includes(query) ||
      (project.description && project.description.toLowerCase().includes(query))
  )
})

async function clearProjectSearch() {
  searchQuery.value = ''
  await nextTick()
  searchInput.value?.focus()
}

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

function copySlug(e, slug) {
  e.preventDefault()
  e.stopPropagation()
  navigator.clipboard.writeText(slug)
  copiedSlug.value = slug
  setTimeout(() => {
    copiedSlug.value = null
  }, 2000)
}

const deletingProject = ref(null)
const deleteProjectForm = useForm({
  purgeData: false
})

function deleteProject(e, project) {
  e.preventDefault()
  e.stopPropagation()
  deletingProject.value = project
  deleteProjectForm.reset()
}

function executeDeleteProject() {
  if (!deletingProject.value) return
  deleteProjectForm.delete(`/projects/${deletingProject.value.slug}`, {
    onFinish: () => {
      deletingProject.value = null
    }
  })
}

function cancelDeleteProject() {
  deleteProjectForm.reset()
  deletingProject.value = null
}
</script>
<template>
  <Head title="Projects | Slipway"></Head>
  <div class="flex h-full flex-col">
    <!-- Header -->
    <div
      class="flex items-center justify-between border-b border-gray-200 py-4 pl-4 pr-4 dark:border-gray-800 sm:pl-4 sm:pr-8"
    >
      <div class="flex items-center space-x-3">
        <!-- Mobile menu button -->
        <button
          data-test="mobile-sidebar-toggle"
          aria-label="Open navigation"
          @click="toggleMobileMenu"
          class="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white md:hidden"
        >
          <SidebarOpen class="h-5 w-5" stroke-width="1" />
        </button>
        <!-- Desktop sidebar toggle -->
        <button
          data-test="desktop-sidebar-toggle"
          :aria-label="sidebarCollapsed ? 'Show navigation' : 'Hide navigation'"
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
        <nav class="flex items-center text-sm">
          <span class="font-medium text-gray-900 dark:text-white"
            >projects</span
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
          <ExternalLink class="h-3.5 w-3.5" stroke-width="2" />
        </a>
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 px-4 py-6 sm:px-8 sm:py-8">
      <!-- Projects Table -->
      <div v-if="projects.length > 0" class="mx-auto max-w-6xl">
        <!-- Toolbar: Search + Create Button -->
        <div class="mb-4 flex items-center justify-between">
          <Input
            ref="searchInput"
            v-model="searchQuery"
            type="text"
            placeholder="Search projects..."
            class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500 sm:w-64"
          />
          <Button
            :as="Link"
            href="/projects/new"
            class="min-h-0 min-w-0 gap-1 rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 active:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100 dark:active:bg-gray-200"
          >
            <span>+</span>
            <span class="hidden sm:inline">Create Project</span>
            <span class="sm:hidden">New</span>
          </Button>
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
          <div
            class="divide-y divide-gray-200 rounded-b-lg bg-white dark:divide-gray-800 dark:bg-gray-950"
          >
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
                    <Folder class="h-4 w-4" />
                  </div>
                  <div class="group/name flex min-w-0 items-center space-x-1.5">
                    <Link
                      :href="`/projects/${project.slug}`"
                      class="font-medium text-gray-900 underline decoration-gray-300 decoration-dashed underline-offset-2 hover:text-gray-700 dark:text-white dark:decoration-gray-600 dark:hover:text-gray-300"
                    >
                      {{ project.name }}
                    </Link>
                    <button
                      @click="copySlug($event, project.slug)"
                      class="opacity-0 transition-opacity group-hover/name:opacity-100"
                      :class="{ 'opacity-100': copiedSlug === project.slug }"
                    >
                      <Check
                        v-if="copiedSlug === project.slug"
                        class="h-3.5 w-3.5 text-green-500"
                        stroke-width="2"
                      />
                      <Copy
                        v-else
                        class="h-3.5 w-3.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                        stroke-width="2"
                      />
                    </button>
                  </div>
                </div>
              </div>
              <div class="col-span-4">
                <span
                  v-if="project.status === 'running'"
                  class="inline-flex items-center gap-1.5 rounded-md bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400"
                >
                  <span class="h-1.5 w-1.5 rounded-full bg-green-500"></span>
                  Running
                </span>
                <span
                  v-else-if="
                    project.status === 'building' ||
                    project.status === 'deploying'
                  "
                  class="inline-flex items-center gap-1.5 rounded-md bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                >
                  <span
                    class="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500"
                  ></span>
                  {{ project.status === 'building' ? 'Building' : 'Deploying' }}
                </span>
                <span
                  v-else-if="project.status === 'failed'"
                  class="inline-flex items-center gap-1.5 rounded-md bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400"
                >
                  <span class="h-1.5 w-1.5 rounded-full bg-red-500"></span>
                  Failed
                </span>
                <span
                  v-else-if="project.status === 'stopped'"
                  class="inline-flex items-center gap-1.5 rounded-md bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                >
                  <span class="h-1.5 w-1.5 rounded-full bg-gray-400"></span>
                  Stopped
                </span>
                <span
                  v-else
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
                    type="button"
                    :popovertarget="`project-actions-${project.id}`"
                    :data-test="`project-actions-${project.slug}`"
                    :aria-label="`Actions for ${project.name}`"
                    class="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                  >
                    <EllipsisHorizontal class="h-5 w-5" />
                  </button>
                  <!-- Dropdown -->
                  <Menu
                    :id="`project-actions-${project.id}`"
                    :aria-label="`Actions for ${project.name}`"
                    placement="bottom-end"
                    :offset="4"
                    class="w-40 rounded-md border-gray-200 bg-white px-0 py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
                  >
                    <Link
                      :href="`/projects/${project.slug}/settings`"
                      class="flex w-full items-center px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      <Edit class="mr-2 h-4 w-4" stroke-width="2" />
                      Edit
                    </Link>
                    <a
                      v-if="project.repositoryUrl"
                      :href="project.repositoryUrl"
                      target="_blank"
                      class="flex w-full items-center px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                      @click.stop
                    >
                      <ExternalLink class="mr-2 h-4 w-4" stroke-width="2" />
                      View repo
                    </a>
                    <button
                      @click="copySlug($event, project.slug)"
                      class="flex w-full items-center px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      <Copy class="mr-2 h-4 w-4" stroke-width="2" />
                      Copy slug
                    </button>
                    <div
                      role="separator"
                      class="my-1 border-t border-gray-200 dark:border-gray-700"
                    ></div>
                    <button
                      @click="deleteProject($event, project)"
                      class="flex w-full items-center px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                    >
                      <Trash class="mr-2 h-4 w-4" stroke-width="2" />
                      Delete
                    </button>
                  </Menu>
                </div>
              </div>
            </div>

            <!-- No results -->
            <EmptyState
              v-if="filteredProjects.length === 0"
              as="section"
              aria-labelledby="projects-filtered-empty-title"
              class="min-h-0 gap-2 px-6 py-8 text-sm text-gray-500 dark:text-gray-400"
            >
              <h2 id="projects-filtered-empty-title" class="font-medium">
                No projects found matching "{{ searchQuery }}"
              </h2>
              <button
                type="button"
                class="cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 dark:text-gray-300 dark:hover:bg-gray-800"
                @click="clearProjectSearch"
              >
                Clear search
              </button>
            </EmptyState>
          </div>
        </div>
      </div>

      <!-- Empty State -->
      <EmptyState
        v-else
        as="section"
        aria-labelledby="projects-empty-title"
        class="gap-0 p-0 py-24"
      >
        <div
          class="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800"
        >
          <Folder class="h-6 w-6 text-gray-500 dark:text-gray-400" />
        </div>
        <h1
          id="projects-empty-title"
          class="mb-1 text-lg font-medium text-gray-900 dark:text-white"
        >
          No projects yet
        </h1>
        <p class="mb-6 text-sm text-gray-500">
          Get started by creating your first project.
        </p>
        <Button
          :as="Link"
          href="/projects/new"
          class="min-h-0 min-w-0 gap-1 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 active:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100 dark:active:bg-gray-200"
        >
          <span>+</span>
          <span>Create Project</span>
        </Button>
      </EmptyState>
    </div>

    <ConfirmModal
      :show="!!deletingProject"
      title="Delete project"
      :message="`Are you sure you want to delete &quot;${deletingProject?.name}&quot;? Recovery data is retained unless you choose to purge it.`"
      confirm-label="Delete"
      :destructive="true"
      :loading="deleteProjectForm.processing"
      @confirm="executeDeleteProject"
      @cancel="cancelDeleteProject"
    >
      <template #form>
        <label class="mt-4 flex cursor-pointer items-start gap-3">
          <Checkbox
            v-model="deleteProjectForm.purgeData"
            class="mt-0.5 h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500 dark:border-gray-600 dark:bg-gray-800"
          />
          <span>
            <span class="block text-sm text-gray-700 dark:text-gray-300">
              Also permanently delete retained data
            </span>
            <span class="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
              Purges service volumes, backups, source, and Docker images.
            </span>
          </span>
        </label>
      </template>
    </ConfirmModal>
  </div>
</template>
