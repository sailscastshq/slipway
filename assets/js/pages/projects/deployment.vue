<script setup>
import Button from '@/components/ui/button/Button.vue'
import Checkbox from '@/components/ui/checkbox/Checkbox.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import AppNavbarVersion from '@/components/AppNavbarVersion.vue'
import WarningTriangle from '@/components/ui/icons/WarningTriangle.vue'
import SidebarOpen from '@/components/ui/icons/SidebarOpen.vue'
import SidebarClose from '@/components/ui/icons/SidebarClose.vue'
import ExternalLink from '@/components/ui/icons/ExternalLink.vue'
import ChevronLeft from '@/components/ui/icons/ChevronLeft.vue'
import { Link, Head, router, usePage } from '@inertiajs/vue3'
import { inject, ref, computed, onMounted, onBeforeUnmount } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'
import Breadcrumb from '@/components/ui/breadcrumb/Breadcrumb.vue'
import DeploymentOutcome from '@/components/DeploymentOutcome.vue'
import LogViewer from '@/components/LogViewer.vue'
import Spinner from '@/components/SlipwaySpinner.vue'
import Alert from '@/components/ui/alert/Alert.vue'
import { useEventSource } from '@/composables/sse'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  project: Object,
  environment: Object,
  deployment: Object,
  recovery: Object
})

const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')

// SSE-powered real-time updates
const sseState = ref(null)
const sseBuildLogs = ref('')
const sseDeployLogs = ref('')

const deployment = computed(() => ({
  ...props.deployment,
  ...(sseState.value || {})
}))

const isInProgress = computed(
  () =>
    deployment.value.isActive ??
    ['pending', 'building', 'pushing', 'deploying'].includes(
      deployment.value.status
    )
)

const initialBuildLogLength = (props.deployment.buildLogs || '').length
const initialDeployLogLength = (props.deployment.deployLogs || '').length
const deploymentStreamUrl = `/api/v1/deployments/${props.deployment.id}/stream?buildOffset=${initialBuildLogLength}&deployOffset=${initialDeployLogLength}`

const allLogs = computed(() => {
  const build = (props.deployment.buildLogs || '') + sseBuildLogs.value
  const deploy = (props.deployment.deployLogs || '') + sseDeployLogs.value
  return joinLogSections(build, deploy)
})
const allLogLines = computed(() => {
  if (!allLogs.value) return []
  const lines = allLogs.value.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
})

const {
  connected: deploymentStreamConnected,
  close: disconnectDeploymentStream
} = useEventSource(deploymentStreamUrl, {
  immediate: isInProgress.value,
  onMessage(data) {
    if (data.status) {
      sseState.value = {
        status: data.status,
        outcome: data.outcome,
        outcomeLabel: data.outcomeLabel,
        stage: data.stage,
        stageLabel: data.stageLabel,
        isCurrent: data.isCurrent,
        isCurrentDeployment: data.isCurrent,
        isActive: data.isActive,
        appId: data.appId
      }
      if (['running', 'stopped', 'failed', 'cancelled'].includes(data.status)) {
        disconnectDeploymentStream()
        router.reload()
      }
    }
    if (data.output) {
      if (data.source === 'deploy') sseDeployLogs.value += data.output
      else sseBuildLogs.value += data.output
    }
  }
})

function joinLogSections(...sections) {
  return sections.filter(Boolean).reduce((combined, section) => {
    if (!combined) return section
    if (combined.endsWith('\n') || section.startsWith('\n')) {
      return combined + section
    }
    return `${combined}\n${section}`
  }, '')
}

function formatDuration(seconds) {
  if (!seconds) return '—'
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${minutes}m ${secs}s`
}

function formatDate(timestamp) {
  if (!timestamp) return '—'
  return new Date(timestamp).toLocaleString()
}

// Cancel deployment
const cancelling = ref(false)

async function cancelDeployment() {
  if (cancelling.value) return
  cancelling.value = true

  try {
    const res = await fetch(
      `/api/v1/deployments/${props.deployment.id}/cancel`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }
    )

    if (res.ok) {
      disconnectDeploymentStream()
      sseState.value = {
        status: 'cancelled',
        outcome: 'cancelled',
        outcomeLabel: 'Cancelled',
        isCurrent: false,
        isCurrentDeployment: false,
        isActive: false
      }
      router.reload()
    } else {
      const data = await res.json()
      alert(data.message || 'Failed to cancel deployment')
    }
  } catch (e) {
    console.error('Failed to cancel:', e)
  } finally {
    cancelling.value = false
  }
}

// The same server resolver owns UI eligibility and API admission.
const canRollback = computed(() => props.recovery?.available === true)
const rollingBack = ref(false)
const rollbackError = ref('')
const page = usePage()
const rollbackReview = ref(false)
const acknowledgeUnknownCompatibility = ref(false)
function openRollbackReview() {
  acknowledgeUnknownCompatibility.value = false
  rollbackReview.value = true
}
onBeforeUnmount(() => disconnectDeploymentStream())

async function executeRollback() {
  if (
    rollingBack.value ||
    !canRollback.value ||
    (props.recovery.requiresCompatibilityAcknowledgement &&
      !acknowledgeUnknownCompatibility.value)
  )
    return
  rollingBack.value = true
  rollbackError.value = ''
  try {
    const response = await fetch(
      `/api/v1/projects/${props.project.slug}/environments/${props.environment.slug}/rollback`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-CSRF-Token': page.props._csrf || ''
        },
        body: JSON.stringify({
          deploymentId: String(props.recovery.targetDeploymentId),
          appSlug: props.recovery.appSlug,
          expectedCurrent: String(props.recovery.currentDeploymentId),
          acknowledgeUnknownCompatibility: acknowledgeUnknownCompatibility.value
        })
      }
    )
    const result = await response.json()
    if (!response.ok || !result.deployment?.id)
      throw new Error(
        typeof result.message === 'string'
          ? result.message
          : 'Rollback could not be queued. Refresh the recovery state before retrying.'
      )
    router.visit(
      `/projects/${props.project.slug}/deployments/${result.deployment.id}`
    )
  } catch (error) {
    rollbackError.value = error.message
    router.reload({ only: ['recovery'] })
  } finally {
    rollingBack.value = false
    rollbackReview.value = false
  }
}
</script>
<template>
  <Head :title="`Deployment ${deployment.id} | Slipway`"></Head>
  <div class="flex h-full flex-col">
    <!-- Header -->
    <div
      class="flex items-center justify-between gap-3 border-b border-gray-200 py-4 pl-4 pr-4 dark:border-gray-800 sm:pl-4 sm:pr-8"
    >
      <div class="flex min-w-0 items-center space-x-3">
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
              label: environment.name.toLowerCase(),
              href: `/projects/${project.slug}/environments/${environment.slug}`
            },
            { label: String(deployment.id) }
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

        <AppNavbarVersion />
      </div>
    </div>

    <p
      v-if="!isInProgress && recovery"
      class="border-b border-dashed border-gray-200 px-4 py-3 text-xs text-gray-500 dark:border-gray-800 sm:px-8"
      data-test="recovery-status"
    >
      {{
        canRollback
          ? `Previous healthy release: #${
              recovery.targetDeploymentId
            } · local immutable image available · ${
              recovery.compatibilityStatus === 'unknown'
                ? 'schema compatibility unverified'
                : 'declared compatibility ' + recovery.compatibility
            }`
          : recovery.reason
      }}
    </p>
    <p
      v-if="rollbackError"
      role="alert"
      class="px-4 py-3 text-sm text-red-600 dark:text-red-400 sm:px-8"
    >
      {{ rollbackError }}
    </p>
    <!-- Content -->
    <div class="flex flex-1 flex-col overflow-hidden px-4 py-6 sm:px-8 sm:py-8">
      <div
        class="mx-auto flex w-full max-w-5xl flex-1 flex-col overflow-hidden"
      >
        <!-- Deployment Info -->
        <div class="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div class="flex items-center gap-2">
              <h1 class="text-xl font-semibold text-gray-900 dark:text-white">
                Deployment
              </h1>
              <DeploymentOutcome :deployment="deployment" />
              <span
                v-if="isInProgress"
                class="inline-flex items-center space-x-1 text-xs text-blue-600 dark:text-blue-400"
              >
                <Spinner class="h-3 w-3" />
                <span>In progress</span>
              </span>
            </div>
          </div>
          <!-- Cancel button (for in-progress deployments) -->
          <button
            v-if="isInProgress"
            data-test="cancel-deployment"
            @click="cancelDeployment"
            :disabled="cancelling"
            class="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {{ cancelling ? 'Cancelling...' : 'Cancel' }}
          </button>
          <Button
            v-if="canRollback"
            variant="outline"
            data-test="rollback-action"
            class="w-full sm:w-auto"
            :disabled="rollingBack"
            @click="openRollbackReview"
          >
            Review rollback
          </Button>
        </div>

        <!-- Metadata -->
        <div class="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-5">
          <div>
            <dt class="text-xs text-gray-500 dark:text-gray-400">
              Triggered by
            </dt>
            <dd class="mt-1 text-sm text-gray-900 dark:text-white">
              {{
                deployment.triggeredBy?.fullName ||
                (deployment.triggerType === 'webhook' ? 'Git' : 'System')
              }}
            </dd>
          </div>
          <div>
            <dt class="text-xs text-gray-500 dark:text-gray-400">Started</dt>
            <dd class="mt-1 text-sm text-gray-900 dark:text-white">
              {{ formatDate(deployment.startedAt) }}
            </dd>
          </div>
          <div>
            <dt class="text-xs text-gray-500 dark:text-gray-400">Duration</dt>
            <dd class="mt-1 text-sm text-gray-900 dark:text-white">
              {{ formatDuration(deployment.duration) }}
            </dd>
          </div>
          <div v-if="deployment.gitBranch">
            <dt class="text-xs text-gray-500 dark:text-gray-400">Branch</dt>
            <dd class="mt-1 text-sm text-gray-900 dark:text-white">
              {{ deployment.gitBranch }}
              <span
                v-if="deployment.gitCommit"
                class="ml-1 font-mono text-xs text-gray-500"
              >
                {{ deployment.gitCommit.slice(0, 7) }}
              </span>
            </dd>
          </div>
          <div v-if="deployment.configHash" data-test="config-fingerprint">
            <dt class="text-xs text-gray-500 dark:text-gray-400">Config</dt>
            <dd
              :title="deployment.configHash"
              class="mt-1 font-mono text-sm text-gray-900 dark:text-white"
            >
              {{ deployment.configHash.slice(0, 12) }}
              <span class="font-sans text-xs text-gray-400 dark:text-gray-500">
                · {{ deployment.configManifest?.length || 0 }} vars
              </span>
            </dd>
          </div>
        </div>

        <!-- Failure summary remains visible even when the pipeline failed before logs started. -->
        <Alert
          v-if="deployment.errorMessage && deployment.status !== 'cancelled'"
          as="section"
          data-test="deployment-failure-summary"
          aria-labelledby="deployment-error-title"
          class="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-inherit dark:border-red-900/60 dark:bg-red-950/30"
        >
          <div class="flex items-start gap-3">
            <WarningTriangle
              class="mt-0.5 h-5 w-5 shrink-0 text-red-600 dark:text-red-400"
              stroke-width="2"
            />
            <div class="min-w-0">
              <h2
                id="deployment-error-title"
                class="text-sm font-semibold text-red-900 dark:text-red-200"
              >
                Deployment failed
              </h2>
              <p
                class="mt-1 break-words text-sm leading-6 text-red-800 dark:text-red-300"
              >
                {{ deployment.errorMessage }}
              </p>
              <p class="mt-2 text-xs text-red-700 dark:text-red-400">
                Review the stage logs below, correct the problem, and deploy
                again.
              </p>
            </div>
          </div>
        </Alert>

        <!-- Log Viewer -->
        <div
          data-test="deployment-log-viewer"
          class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800"
        >
          <div
            class="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-2 dark:border-gray-800 dark:bg-gray-900"
          >
            <span class="text-xs font-medium text-gray-500 dark:text-gray-400"
              >Build &amp; Deploy Logs</span
            >
          </div>
          <LogViewer
            :lines="allLogLines"
            :connected="deploymentStreamConnected"
            :complete="!isInProgress"
            :inactive-message="
              !isInProgress && allLogLines.length === 0
                ? 'No additional logs were captured.'
                : ''
            "
            height="fill"
          />
        </div>
      </div>
    </div>
    <ConfirmModal
      :show="rollbackReview"
      :loading="rollingBack"
      title="Roll back to previous successful release?"
      :message="`Use deployment #${recovery?.targetDeploymentId} (${
        recovery?.gitCommit?.slice(0, 7) || 'retained image'
      }) for ${recovery?.appSlug || 'this app'} in ${
        environment.slug
      } with current configuration. ${
        recovery?.compatibilityStatus === 'unknown'
          ? 'Schema compatibility is unverified.'
          : 'Declared compatibility: ' + recovery?.compatibility + '.'
      } Rollback does not undo database migrations, data changes, files or external effects.`"
      :confirm-disabled="
        recovery?.requiresCompatibilityAcknowledgement &&
        !acknowledgeUnknownCompatibility
      "
      confirm-label="Roll back"
      confirm-with-slide
      @confirm="executeRollback"
      @cancel="rollbackReview = false"
    >
      <template v-if="recovery?.requiresCompatibilityAcknowledgement" #form>
        <label
          class="mt-4 flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300"
        >
          <Checkbox
            v-model="acknowledgeUnknownCompatibility"
            class="mt-0.5 shrink-0"
          />
          <span
            >I confirm the previous app can use the current schema and
            configuration.</span
          >
        </label>
      </template>
    </ConfirmModal>
  </div>
</template>
