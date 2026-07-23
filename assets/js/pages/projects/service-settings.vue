<script setup>
import { Link, Head, router, usePage } from '@inertiajs/vue3'
import { ref, computed, inject, onMounted } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'
import Breadcrumb from '@/components/Breadcrumb.vue'
import Tooltip from '@/components/Tooltip.vue'
import { useToast } from '@/composables/toast'
import { useEventSource } from '@/composables/sse'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  project: Object,
  environment: Object,
  service: Object,
  versionPolicy: Object,
  availableUpgrades: Array,
  backupConfigured: Boolean
})

const page = usePage()
const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')
const toast = useToast()

// Recommended defaults per service type
const typeDefaults = {
  postgresql: { cpus: '1', memory: '512m' },
  mysql: { cpus: '1', memory: '512m' },
  mongodb: { cpus: '1', memory: '512m' },
  redis: { cpus: '0.25', memory: '128m' }
}
const defaults = typeDefaults[props.service.type] || {
  cpus: '0.5',
  memory: '256m'
}

// Form state
const cpus = ref(props.service.resourceLimits?.cpus || defaults.cpus)
const memory = ref(props.service.resourceLimits?.memory || defaults.memory)
const saving = ref(false)
const savingAndRestarting = ref(false)
const upgradeOpen = ref(false)
const upgradeConfirmation = ref('')
const upgradeStarting = ref(false)
const upgradeState = ref(props.service.upgradeState || null)
const selectedUpgrade = computed(() => props.availableUpgrades?.[0] || null)
const upgradeInProgress = computed(
  () =>
    upgradeState.value?.status === 'queued' ||
    upgradeState.value?.status === 'running'
)
const displayedImageReference = computed(() => {
  const reference = props.service.imageReference
  if (!reference) return 'Not resolved'
  if (reference.length <= 54) return reference
  return `${reference.slice(0, 26)}…${reference.slice(-20)}`
})

const { connect: connectUpgrade, close: closeUpgrade } = useEventSource(
  `/api/v1/services/${props.service.id}/upgrade/stream`,
  {
    immediate: false,
    autoReconnect: false,
    onMessage(state) {
      upgradeState.value = state
      if (state.status === 'completed' || state.status === 'failed') {
        closeUpgrade()
        router.reload()
      }
    }
  }
)

const isDirty = computed(
  () =>
    cpus.value !== (props.service.resourceLimits?.cpus || defaults.cpus) ||
    memory.value !== (props.service.resourceLimits?.memory || defaults.memory)
)

async function saveSettings({ restart = false } = {}) {
  if (restart) {
    savingAndRestarting.value = true
  } else {
    saving.value = true
  }

  try {
    const res = await fetch(`/api/v1/services/${props.service.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': page.props._csrf || ''
      },
      body: JSON.stringify({
        resourceLimits: { cpus: cpus.value, memory: memory.value }
      })
    })

    if (res.ok) {
      if (restart) {
        await fetch(`/api/v1/services/${props.service.id}/restart`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-csrf-token': page.props._csrf || ''
          }
        })
        toast({
          message: 'Settings saved and service restarted',
          type: 'success'
        })
      } else {
        toast({ message: 'Settings saved', type: 'success' })
      }
      router.reload()
    } else {
      const data = await res.json()
      toast({
        message: data.message || 'Failed to save settings',
        type: 'error'
      })
    }
  } catch (err) {
    toast({ message: 'Failed to save settings', type: 'error' })
  } finally {
    saving.value = false
    savingAndRestarting.value = false
  }
}

async function startUpgrade() {
  if (
    !selectedUpgrade.value ||
    upgradeConfirmation.value !== props.service.name ||
    upgradeStarting.value
  ) {
    return
  }

  upgradeStarting.value = true
  try {
    const response = await fetch(
      `/api/v1/services/${props.service.id}/upgrade`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': page.props._csrf || ''
        },
        body: JSON.stringify({
          targetVersion: selectedUpgrade.value.toVersion,
          confirmation: upgradeConfirmation.value
        })
      }
    )
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.message || 'Could not start the upgrade.')
    }

    upgradeState.value = data.upgrade
    upgradeOpen.value = false
    connectUpgrade()
  } catch (error) {
    toast({
      message: error.message || 'Could not start the upgrade.',
      type: 'error'
    })
  } finally {
    upgradeStarting.value = false
  }
}

function cancelUpgrade() {
  upgradeOpen.value = false
  upgradeConfirmation.value = ''
}

onMounted(() => {
  if (upgradeInProgress.value) connectUpgrade()
})

const serviceTypeLabel = {
  postgresql: 'PostgreSQL',
  mysql: 'MySQL',
  redis: 'Redis',
  mongodb: 'MongoDB'
}
</script>

<template>
  <Head
    :title="`${service.name} Settings - ${environment.name} | Slipway`"
  ></Head>
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
            {
              label: service.name,
              href: `/projects/${project.slug}/environments/${environment.slug}/services/${service.id}`
            },
            { label: 'settings' }
          ]"
        />
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
      <div class="mx-auto max-w-2xl">
        <div class="mb-8">
          <h1 class="text-xl font-semibold text-gray-900 dark:text-white">
            {{ service.name }} settings
          </h1>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Manage the version and resource limits for this
            {{ serviceTypeLabel[service.type] || service.type }} service.
          </p>
        </div>

        <section
          aria-labelledby="service-version-heading"
          class="mb-8 space-y-4 border-b border-gray-100 pb-8 dark:border-gray-800"
        >
          <div class="flex items-start justify-between gap-4">
            <div>
              <h2
                id="service-version-heading"
                class="text-sm font-medium text-gray-900 dark:text-white"
              >
                Service version
              </h2>
              <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Slipway recreates this service from the same immutable image.
              </p>
            </div>
            <span
              class="rounded-md bg-gray-100 px-2.5 py-1 font-mono text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-200"
            >
              {{ versionPolicy?.label }} {{ service.version }}
            </span>
          </div>

          <dl class="grid gap-3 text-sm sm:grid-cols-[8rem_1fr]">
            <dt class="text-gray-400 dark:text-gray-500">Image</dt>
            <dd
              class="min-w-0 truncate font-mono text-xs text-gray-600 dark:text-gray-300"
              :title="service.imageReference || 'Not resolved'"
            >
              {{ displayedImageReference }}
            </dd>
            <dt class="text-gray-400 dark:text-gray-500">Support</dt>
            <dd class="text-gray-700 dark:text-gray-300">
              <span v-if="service.versionSupport === 'supported'">
                Tested by Slipway
              </span>
              <span
                v-else-if="service.versionSupport === 'custom'"
                class="text-amber-700 dark:text-amber-400"
              >
                Custom version outside the tested matrix
              </span>
              <span v-else class="text-amber-700 dark:text-amber-400">
                Legacy version has not been resolved from Docker
              </span>
            </dd>
          </dl>

          <div
            v-if="upgradeState"
            :class="[
              'rounded-lg border px-4 py-3',
              upgradeState.status === 'failed'
                ? 'border-red-200 bg-red-50 dark:border-red-900/60 dark:bg-red-950/20'
                : upgradeState.status === 'completed'
                ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/20'
                : 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900'
            ]"
            aria-live="polite"
          >
            <div class="flex items-center justify-between gap-3">
              <p class="text-sm font-medium text-gray-900 dark:text-gray-100">
                {{
                  upgradeState.status === 'failed'
                    ? 'Upgrade stopped safely'
                    : upgradeState.status === 'completed'
                    ? 'Upgrade completed'
                    : `Upgrading to ${upgradeState.targetVersion}`
                }}
              </p>
              <span
                v-if="upgradeInProgress"
                class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-300 border-t-gray-800 dark:border-gray-700 dark:border-t-white"
                aria-hidden="true"
              ></span>
            </div>
            <p
              class="mt-1 text-sm text-gray-600 dark:text-gray-400"
              :class="{
                'text-red-700 dark:text-red-400':
                  upgradeState.status === 'failed'
              }"
            >
              {{ upgradeState.message }}
            </p>
            <ol
              v-if="upgradeState.steps"
              class="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6"
              aria-label="Upgrade progress"
            >
              <li
                v-for="step in upgradeState.steps"
                :key="step.name"
                class="min-w-0"
              >
                <span
                  :class="[
                    'mb-1 block h-1 rounded-full',
                    step.status === 'failed'
                      ? 'bg-red-500'
                      : step.status === 'completed'
                      ? 'bg-emerald-500'
                      : step.status === 'running'
                      ? 'bg-gray-900 dark:bg-white'
                      : 'bg-gray-200 dark:bg-gray-700'
                  ]"
                ></span>
                <span
                  class="block truncate text-[10px] capitalize text-gray-500 dark:text-gray-400"
                >
                  {{ step.name }}
                </span>
              </li>
            </ol>
            <p
              v-if="upgradeState.recovery?.instructions"
              class="mt-3 text-xs leading-5 text-gray-500 dark:text-gray-400"
            >
              {{ upgradeState.recovery.instructions }}
            </p>
          </div>

          <div
            v-if="selectedUpgrade && !upgradeInProgress"
            class="flex justify-end"
          >
            <button
              v-if="!upgradeOpen"
              type="button"
              class="rounded-md bg-gray-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
              @click="upgradeOpen = true"
            >
              Upgrade to {{ versionPolicy.label }}
              {{ selectedUpgrade.toVersion }}
            </button>

            <div
              v-else
              class="w-full rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900"
            >
              <h3 class="text-sm font-medium text-gray-900 dark:text-white">
                Upgrade {{ service.version }} →
                {{ selectedUpgrade.toVersion }}
              </h3>
              <p
                class="mt-1 text-sm leading-6 text-gray-600 dark:text-gray-400"
              >
                {{ selectedUpgrade.guidance }}
              </p>

              <div
                v-if="!backupConfigured"
                class="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300"
              >
                Configure backup storage before upgrading.
                <Link
                  href="/settings/uploads"
                  class="font-medium underline underline-offset-2"
                >
                  Open storage settings
                </Link>
              </div>

              <label
                for="upgrade-confirmation"
                class="mt-4 block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                Type <span class="font-mono">{{ service.name }}</span> to
                confirm
              </label>
              <input
                id="upgrade-confirmation"
                v-model="upgradeConfirmation"
                type="text"
                autocomplete="off"
                class="focus:border-brand mt-1.5 w-full border-b border-dashed border-gray-300 bg-transparent px-1 py-2 font-mono text-sm text-gray-900 focus:outline-none dark:border-gray-600 dark:text-white"
              />

              <div class="mt-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  class="rounded-md px-3 py-2 text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                  @click="cancelUpgrade"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  :disabled="
                    !backupConfigured ||
                    upgradeConfirmation !== service.name ||
                    upgradeStarting
                  "
                  class="rounded-md bg-gray-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
                  @click="startUpgrade"
                >
                  {{ upgradeStarting ? 'Starting…' : 'Back up and upgrade' }}
                </button>
              </div>
            </div>
          </div>
        </section>

        <form @submit.prevent="saveSettings()" class="space-y-6">
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
                :placeholder="defaults.cpus"
                class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
              />
              <p class="mt-1 text-xs text-gray-400 dark:text-gray-500">
                Number of CPU cores, e.g.
                <code class="text-gray-500 dark:text-gray-400">0.5</code> or
                <code class="text-gray-500 dark:text-gray-400">2</code>
              </p>
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
                :placeholder="defaults.memory"
                class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
              />
              <p class="mt-1 text-xs text-gray-400 dark:text-gray-500">
                e.g. <code class="text-gray-500 dark:text-gray-400">256m</code>,
                <code class="text-gray-500 dark:text-gray-400">512m</code>,
                <code class="text-gray-500 dark:text-gray-400">1g</code>
              </p>
            </div>
          </div>

          <!-- Compound button -->
          <div class="flex justify-end">
            <div class="inline-flex rounded-md shadow-sm">
              <button
                type="submit"
                :disabled="!isDirty || saving || savingAndRestarting"
                class="rounded-l-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
              >
                {{ saving ? 'Saving...' : 'Save changes' }}
              </button>
              <Tooltip text="Save and restart service">
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
      </div>
    </div>
  </div>
</template>
