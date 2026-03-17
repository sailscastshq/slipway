<script setup>
import { Link, Head, router, usePage, useForm } from '@inertiajs/vue3'
import { ref, computed, inject, onMounted } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'
import Breadcrumb from '@/components/Breadcrumb.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import Tooltip from '@/components/Tooltip.vue'
import { useToast } from '@/composables/toast'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  project: Object,
  environment: Object,
  app: Object,
  connectedRepo: Object,
  githubConnected: Boolean
})

const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')
const toast = useToast()

const page = usePage()

const basePath = computed(
  () =>
    `/projects/${props.project.slug}/environments/${props.environment.slug}/apps/${props.app.slug}`
)

// --- Form state ---
const name = ref(props.app.name)
const dockerfilePath = ref(props.app.dockerfilePath || 'Dockerfile')
const routePath = ref(
  props.app.routePath === null ? 'none' : props.app.routePath || '/'
)
const cpus = ref(props.app.resourceLimits?.cpus || '1')
const memory = ref(props.app.resourceLimits?.memory || '512m')
const saving = ref(false)
const savingAndRestarting = ref(false)

const isDirty = computed(
  () =>
    name.value !== props.app.name ||
    dockerfilePath.value !== (props.app.dockerfilePath || 'Dockerfile') ||
    routePath.value !==
      (props.app.routePath === null ? 'none' : props.app.routePath || '/') ||
    cpus.value !== (props.app.resourceLimits?.cpus || '1') ||
    memory.value !== (props.app.resourceLimits?.memory || '512m')
)

async function saveSettings({ restart = false } = {}) {
  if (restart) {
    savingAndRestarting.value = true
  } else {
    saving.value = true
  }
  try {
    const res = await fetch(
      `/api/v1/projects/${props.project.slug}/environments/${props.environment.slug}/apps/${props.app.slug}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': page.props._csrf || ''
        },
        body: JSON.stringify({
          name: name.value,
          dockerfilePath: dockerfilePath.value,
          routePath: routePath.value === 'none' ? null : routePath.value,
          resourceLimits: { cpus: cpus.value, memory: memory.value }
        })
      }
    )

    if (res.ok && restart) {
      await fetch(
        `/api/v1/projects/${props.project.slug}/environments/${props.environment.slug}/apps/${props.app.slug}/restart`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-csrf-token': page.props._csrf || ''
          }
        }
      )
      toast({ message: 'Settings saved and app restarted', type: 'success' })
    } else {
      toast({ message: 'App settings saved', type: 'success' })
    }
    router.reload()
  } finally {
    saving.value = false
    savingAndRestarting.value = false
  }
}

// --- Git Integration ---
const disconnectConfirm = ref(false)

const autoDeployForm = useForm({
  autoDeploy: props.connectedRepo?.autoDeploy ?? true
})

const disconnectForm = useForm({})

function toggleAutoDeploy() {
  autoDeployForm.autoDeploy = !autoDeployForm.autoDeploy
  autoDeployForm.patch(`${basePath.value}/repo`, { preserveScroll: true })
}

function disconnectRepo() {
  disconnectForm.delete(`${basePath.value}/disconnect-repo`, {
    preserveScroll: true,
    onSuccess: () => {
      disconnectConfirm.value = false
    }
  })
}

// --- Repo picker (for connecting when disconnected) ---
const connectForm = useForm({
  repoId: null,
  branch: null
})

const repos = ref([])
const loadingRepos = ref(false)
const repoSearch = ref('')
const repoDropdownOpen = ref(false)
const selectedRepo = ref(null)

// --- Branch picker state ---
const branches = ref([])
const loadingBranches = ref(false)
const selectedBranch = ref(null)

const filteredRepos = computed(() => {
  if (!repoSearch.value) return repos.value
  const q = repoSearch.value.toLowerCase()
  return repos.value.filter((r) => r.fullName.toLowerCase().includes(q))
})

async function fetchRepos() {
  if (!props.githubConnected || repos.value.length > 0) return
  loadingRepos.value = true
  try {
    const res = await fetch('/api/v1/git/repos')
    const data = await res.json()
    repos.value = data.repos || []
  } catch {
    repos.value = []
  } finally {
    loadingRepos.value = false
  }
}

async function fetchBranches(repo) {
  loadingBranches.value = true
  branches.value = []
  try {
    const res = await fetch(
      `/api/v1/git/branches?owner=${repo.owner}&repo=${repo.name}`
    )
    const data = await res.json()
    branches.value = data.branches || []
    selectedBranch.value = repo.defaultBranch
    connectForm.branch = repo.defaultBranch
  } catch {
    branches.value = []
  } finally {
    loadingBranches.value = false
  }
}

function selectRepo(repo) {
  selectedRepo.value = repo
  connectForm.repoId = repo.id
  repoDropdownOpen.value = false
  repoSearch.value = ''
  fetchBranches(repo)
}

function clearSelectedRepo() {
  selectedRepo.value = null
  connectForm.repoId = null
  connectForm.branch = null
  selectedBranch.value = null
  branches.value = []
}

function selectBranch(branchName) {
  selectedBranch.value = branchName
  connectForm.branch = branchName
}

function connectRepo() {
  if (!connectForm.repoId) return
  connectForm.post(`${basePath.value}/connect-repo`, {
    onSuccess: () => {
      selectedRepo.value = null
      selectedBranch.value = null
      branches.value = []
    }
  })
}

onMounted(() => {
  if (!props.connectedRepo && props.githubConnected) {
    fetchRepos()
  }
})

// --- Delete ---
const deleteConfirm = ref(false)
const deleting = ref(false)

async function deleteApp() {
  deleting.value = true
  try {
    const res = await fetch(
      `/api/v1/projects/${props.project.slug}/environments/${props.environment.slug}/apps/${props.app.slug}`,
      {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' }
      }
    )
    if (res.ok) {
      router.visit(
        `/projects/${props.project.slug}/environments/${props.environment.slug}`
      )
    } else {
      const data = await res.json()
      toast({
        message: data.problems?.[0]?.app || 'Failed to delete app',
        type: 'error'
      })
    }
  } finally {
    deleting.value = false
    deleteConfirm.value = false
  }
}
</script>

<template>
  <Head :title="`${app.name} Settings - ${environment.name} | Slipway`"></Head>
  <div class="flex h-full flex-col" @click="repoDropdownOpen = false">
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
          </svg>
        </button>
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
            {
              label: environment.name.toLowerCase(),
              href: `/projects/${project.slug}/environments/${environment.slug}`
            },
            { label: `${app.name} settings` }
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
    <div class="flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
      <div class="mx-auto max-w-2xl">
        <div class="mb-8">
          <h1 class="text-xl font-semibold text-gray-900 dark:text-white">
            {{ app.name }} settings
          </h1>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Configure this app's Dockerfile, routing, and resource limits.
          </p>
        </div>

        <!-- General Settings -->
        <form @submit.prevent="saveSettings()" class="space-y-6">
          <div>
            <label
              for="appName"
              class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Name
            </label>
            <input
              id="appName"
              v-model="name"
              type="text"
              class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
            />
          </div>

          <div>
            <label
              for="dockerfilePath"
              class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Dockerfile path
            </label>
            <input
              id="dockerfilePath"
              v-model="dockerfilePath"
              type="text"
              placeholder="Dockerfile"
              class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
            />
            <p class="mt-1 text-xs text-gray-400 dark:text-gray-500">
              Relative to your project root, e.g.
              <code class="text-gray-500 dark:text-gray-400"
                >Dockerfile.worker</code
              >
            </p>
          </div>

          <div>
            <label
              for="routePath"
              class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Route path
            </label>
            <select
              id="routePath"
              v-model="routePath"
              class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 focus:outline-none dark:border-gray-700 dark:text-white"
            >
              <option value="/">/ (root)</option>
              <option value="/api">/api</option>
              <option value="/admin">/admin</option>
              <option value="none">None (worker)</option>
            </select>
            <p class="mt-1 text-xs text-gray-400 dark:text-gray-500">
              URL prefix this app handles. Choose "None" for background workers.
            </p>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label
                for="cpuLimit"
                class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                CPU limit
              </label>
              <input
                id="cpuLimit"
                v-model="cpus"
                type="text"
                placeholder="1"
                class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
              />
            </div>
            <div>
              <label
                for="memoryLimit"
                class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                Memory limit
              </label>
              <input
                id="memoryLimit"
                v-model="memory"
                type="text"
                placeholder="512m"
                class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
              />
            </div>
          </div>

          <div class="flex justify-end">
            <div class="inline-flex rounded-md shadow-sm">
              <button
                type="submit"
                :disabled="!isDirty || saving || savingAndRestarting"
                class="rounded-l-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
              >
                {{ saving ? 'Saving...' : 'Save changes' }}
              </button>
              <Tooltip text="Save and restart app">
                <button
                  type="button"
                  @click="saveSettings({ restart: true })"
                  :disabled="!isDirty || saving || savingAndRestarting"
                  class="rounded-r-md border-l border-gray-700 bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:border-gray-200 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
                >
                  <template v-if="savingAndRestarting">
                    <svg
                      class="h-4 w-4 animate-spin"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        class="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        stroke-width="4"
                      ></circle>
                      <path
                        class="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      ></path>
                    </svg>
                  </template>
                  <template v-else>
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
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                      />
                    </svg>
                  </template>
                </button>
              </Tooltip>
            </div>
          </div>
        </form>

        <!-- Git Integration -->
        <div class="mt-12">
          <h2 class="text-lg font-medium text-gray-900 dark:text-white">
            Git Integration
          </h2>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Connect a GitHub repository for automatic deployments.
          </p>

          <div class="mt-4">
            <!-- Connected repo card -->
            <div
              v-if="connectedRepo"
              class="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
            >
              <div class="flex items-center justify-between px-4 py-3">
                <div class="flex items-center space-x-3">
                  <svg
                    class="h-6 w-6 text-gray-900 dark:text-white"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path
                      d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
                    />
                  </svg>
                  <div>
                    <a
                      :href="connectedRepo.htmlUrl"
                      target="_blank"
                      class="text-sm font-medium text-gray-900 hover:underline dark:text-white"
                    >
                      {{ connectedRepo.fullName }}
                    </a>
                    <p
                      class="mt-0.5 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400"
                    >
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
                          d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
                        />
                      </svg>
                      {{
                        connectedRepo.deployBranch ||
                        connectedRepo.defaultBranch
                      }}
                    </p>
                  </div>
                </div>
                <span
                  class="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400"
                >
                  Connected
                </span>
              </div>

              <div
                class="flex items-center justify-between border-t border-gray-200 px-4 py-3 dark:border-gray-700"
              >
                <div class="flex items-center gap-3">
                  <button
                    @click="toggleAutoDeploy"
                    :disabled="autoDeployForm.processing"
                    :class="[
                      'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none',
                      autoDeployForm.autoDeploy
                        ? 'bg-brand'
                        : 'bg-gray-200 dark:bg-gray-700'
                    ]"
                  >
                    <span
                      :class="[
                        'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
                        autoDeployForm.autoDeploy
                          ? 'translate-x-4'
                          : 'translate-x-0'
                      ]"
                    />
                  </button>
                  <span class="text-sm text-gray-700 dark:text-gray-300"
                    >Auto-deploy on push</span
                  >
                </div>
                <button
                  @click="disconnectConfirm = true"
                  class="text-sm text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                >
                  Disconnect
                </button>
              </div>
            </div>

            <!-- Disconnected: GitHub connected, show picker -->
            <div v-else-if="githubConnected">
              <div class="relative" @click.stop>
                <!-- Selected repo — show as card with branch picker -->
                <div v-if="selectedRepo" class="space-y-4">
                  <div
                    class="rounded-lg border border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-900"
                  >
                    <div class="flex items-center justify-between">
                      <div class="flex items-center space-x-3">
                        <svg
                          class="h-6 w-6 text-gray-900 dark:text-white"
                          viewBox="0 0 24 24"
                          fill="currentColor"
                        >
                          <path
                            d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
                          />
                        </svg>
                        <div>
                          <p
                            class="text-sm font-medium text-gray-900 dark:text-white"
                          >
                            {{ selectedRepo.fullName }}
                          </p>
                          <p class="text-xs text-gray-500 dark:text-gray-400">
                            {{ selectedRepo.isPrivate ? 'Private' : 'Public' }}
                            repository
                          </p>
                        </div>
                      </div>
                      <button
                        @click="clearSelectedRepo"
                        class="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
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
                  </div>

                  <!-- Branch select -->
                  <div>
                    <label
                      class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
                      >Deploy branch</label
                    >
                    <div
                      v-if="loadingBranches"
                      class="flex items-center gap-2 py-1.5"
                    >
                      <svg
                        class="h-4 w-4 animate-spin text-gray-400"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          class="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          stroke-width="4"
                        ></circle>
                        <path
                          class="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                        ></path>
                      </svg>
                      <span class="text-sm text-gray-500 dark:text-gray-400"
                        >Loading branches...</span
                      >
                    </div>
                    <select
                      v-else-if="branches.length > 0"
                      :value="selectedBranch"
                      @change="selectBranch($event.target.value)"
                      class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 focus:outline-none dark:border-gray-700 dark:text-white"
                    >
                      <option
                        v-for="b in branches"
                        :key="b.name"
                        :value="b.name"
                      >
                        {{ b.name }}
                      </option>
                    </select>
                    <p
                      v-else
                      class="py-1.5 text-sm text-gray-500 dark:text-gray-400"
                    >
                      {{ selectedRepo.defaultBranch }}
                    </p>
                    <p class="mt-1 text-xs text-gray-400 dark:text-gray-500">
                      Pushes to this branch will trigger a deployment.
                    </p>
                  </div>

                  <!-- Connect button -->
                  <div class="flex justify-end">
                    <button
                      @click="connectRepo"
                      :disabled="connectForm.processing"
                      class="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
                    >
                      {{
                        connectForm.processing
                          ? 'Connecting...'
                          : 'Connect repository'
                      }}
                    </button>
                  </div>
                </div>

                <!-- Repo search combobox -->
                <div v-else>
                  <div class="relative">
                    <div
                      class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-1"
                    >
                      <svg
                        class="h-4 w-4 text-gray-400"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
                        />
                      </svg>
                    </div>
                    <input
                      v-model="repoSearch"
                      @focus="repoDropdownOpen = true"
                      placeholder="Search repositories..."
                      class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent py-1.5 pl-7 pr-8 text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
                    />
                    <div
                      class="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-1"
                    >
                      <svg
                        v-if="loadingRepos"
                        class="h-4 w-4 animate-spin text-gray-400"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          class="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          stroke-width="4"
                        ></circle>
                        <path
                          class="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                        ></path>
                      </svg>
                      <svg
                        v-else
                        class="h-4 w-4 text-gray-400"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M19 9l-7 7-7-7"
                        />
                      </svg>
                    </div>
                  </div>

                  <!-- Dropdown -->
                  <Transition
                    enter-active-class="transition ease-out duration-100"
                    enter-from-class="transform opacity-0 scale-95"
                    enter-to-class="transform opacity-100 scale-100"
                    leave-active-class="transition ease-in duration-75"
                    leave-from-class="transform opacity-100 scale-100"
                    leave-to-class="transform opacity-0 scale-95"
                  >
                    <div
                      v-if="repoDropdownOpen && !loadingRepos"
                      class="absolute left-0 right-0 z-30 mt-1 max-h-48 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900"
                    >
                      <div
                        v-if="filteredRepos.length === 0"
                        class="px-3 py-4 text-center text-sm text-gray-500 dark:text-gray-400"
                      >
                        No repositories found
                      </div>
                      <button
                        v-for="repo in filteredRepos"
                        :key="repo.id"
                        @click="selectRepo(repo)"
                        :disabled="repo.isConnected"
                        class="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-gray-50 disabled:opacity-50 dark:hover:bg-gray-800"
                      >
                        <div class="flex items-center gap-2">
                          <span class="text-gray-400 dark:text-gray-500"
                            >{{ repo.owner }}/</span
                          >
                          <span
                            class="font-medium text-gray-900 dark:text-white"
                            >{{ repo.name }}</span
                          >
                          <svg
                            v-if="repo.isPrivate"
                            class="h-3.5 w-3.5 text-gray-400"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                            />
                          </svg>
                        </div>
                        <span
                          v-if="repo.isConnected"
                          class="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                          >Connected</span
                        >
                      </button>
                    </div>
                  </Transition>
                </div>
              </div>
            </div>

            <!-- GitHub not configured -->
            <div
              v-else
              class="rounded-lg border border-dashed border-gray-300 px-6 py-8 text-center dark:border-gray-700"
            >
              <svg
                class="mx-auto h-8 w-8 text-gray-400 dark:text-gray-500"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
                />
              </svg>
              <p class="mt-3 text-sm font-medium text-gray-900 dark:text-white">
                GitHub not connected
              </p>
              <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Connect your GitHub account to enable push-to-deploy.
              </p>
              <Link
                href="/settings/git"
                class="text-brand mt-3 inline-flex items-center gap-1 text-sm font-medium hover:underline"
              >
                Configure GitHub
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
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </Link>
            </div>
          </div>
        </div>

        <!-- Danger Zone -->
        <div
          v-if="!app.isDefault"
          class="mt-12 rounded-lg border border-red-200 p-6 dark:border-red-900/50"
        >
          <h3 class="text-sm font-medium text-red-600 dark:text-red-400">
            Danger zone
          </h3>
          <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Permanently delete this app. This will stop its container and remove
            all associated deployments.
          </p>
          <div class="mt-4">
            <button
              @click="deleteConfirm = true"
              class="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
            >
              Delete app
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Delete Confirm Modal -->
    <ConfirmModal
      :show="deleteConfirm"
      title="Delete app"
      :message="`Are you sure you want to delete '${app.name}'? This will stop the container and cannot be undone.`"
      confirm-label="Delete"
      :destructive="true"
      :loading="deleting"
      @confirm="deleteApp"
      @cancel="deleteConfirm = false"
    />

    <!-- Disconnect Confirm Modal -->
    <ConfirmModal
      :show="disconnectConfirm"
      title="Disconnect repository"
      :message="`Disconnect ${connectedRepo?.fullName}? This will remove the deploy key and webhook from GitHub. You can reconnect later.`"
      confirm-label="Disconnect"
      :destructive="true"
      :loading="disconnectForm.processing"
      @confirm="disconnectRepo"
      @cancel="disconnectConfirm = false"
    />
  </div>
</template>
