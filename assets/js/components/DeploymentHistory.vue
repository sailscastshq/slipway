<script setup>
import { Link, router } from '@inertiajs/vue3'
import { onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps({
  history: {
    type: Object,
    required: true
  },
  title: {
    type: String,
    default: 'Deployments'
  },
  showEnvironment: {
    type: Boolean,
    default: false
  },
  showStatus: {
    type: Boolean,
    default: true
  },
  hideWhenEmpty: {
    type: Boolean,
    default: false
  },
  emptyMessage: {
    type: String,
    default: 'No deployments yet.'
  },
  emptyHelp: {
    type: String,
    default: 'Slide to deploy your first version.'
  }
})

function orderedDeployments(history) {
  const seen = new Set()
  const ordered = []
  const newestFirst = (left, right) =>
    Number(right.createdAt) - Number(left.createdAt) ||
    Number(right.id) - Number(left.id)

  for (const group of [
    history.activeDeployments || [],
    history.currentReleases || [],
    history.items || []
  ]) {
    for (const deployment of [...group].sort(newestFirst)) {
      if (seen.has(deployment.id)) continue
      seen.add(deployment.id)
      ordered.push(deployment)
    }
  }

  return ordered
}

const deployments = ref(orderedDeployments(props.history))
const activeDeployments = ref([...(props.history.activeDeployments || [])])
const activeSources = new Map()

function refreshHistory() {
  router.reload({
    only: ['deploymentHistory'],
    preserveScroll: true
  })
}

function patchStatus(deploymentId, status) {
  const patch = (deployment) =>
    deployment.id === deploymentId ? { ...deployment, status } : deployment

  deployments.value = deployments.value.map(patch)
  activeDeployments.value = activeDeployments.value.map(patch)
}

function connectActiveDeployments() {
  const activeIds = new Set(
    activeDeployments.value
      .filter((item) =>
        ['pending', 'building', 'pushing', 'deploying'].includes(item.status)
      )
      .map((item) => item.id)
  )

  for (const [id, source] of activeSources) {
    if (!activeIds.has(id)) {
      source.close()
      activeSources.delete(id)
    }
  }

  for (const deployment of activeDeployments.value.filter((item) =>
    activeIds.has(item.id)
  )) {
    if (activeSources.has(deployment.id)) continue

    const source = new EventSource(
      `/api/v1/deployments/${deployment.id}/stream`
    )

    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (!data.status) return

        patchStatus(deployment.id, data.status)

        if (
          ['running', 'failed', 'cancelled', 'stopped'].includes(data.status)
        ) {
          source.close()
          activeSources.delete(deployment.id)
          refreshHistory()
        }
      } catch {
        // Ignore malformed events and allow EventSource to reconnect.
      }
    }
    source.onerror = () => {
      // EventSource reconnects automatically while the deployment is active.
    }
    activeSources.set(deployment.id, source)
  }
}

watch(
  () => props.history,
  (history) => {
    deployments.value = orderedDeployments(history)
    activeDeployments.value = [...(history.activeDeployments || [])]
    connectActiveDeployments()
  },
  { deep: true }
)

watch(
  activeDeployments,
  () => {
    connectActiveDeployments()
  },
  { deep: true, immediate: true }
)

onBeforeUnmount(() => {
  for (const source of activeSources.values()) source.close()
  activeSources.clear()
})

function statusBadge(status) {
  const map = {
    running: {
      label: 'Running',
      classes:
        'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
    },
    building: {
      label: 'Building',
      classes:
        'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
    },
    pushing: {
      label: 'Pushing',
      classes:
        'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
    },
    deploying: {
      label: 'Deploying',
      classes:
        'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
    },
    pending: {
      label: 'Pending',
      classes:
        'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
    },
    failed: {
      label: 'Failed',
      classes: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
    },
    stopped: {
      label: 'Stopped',
      classes: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
    },
    cancelled: {
      label: 'Cancelled',
      classes: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
    },
    creating: {
      label: 'Creating',
      classes:
        'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
    }
  }

  return (
    map[status] || {
      label: status,
      classes: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
    }
  )
}

function statusDotClasses(status) {
  if (status === 'running') return 'bg-green-500'
  if (status === 'failed') return 'bg-red-500'
  if (['building', 'pushing', 'deploying'].includes(status)) {
    return 'bg-blue-500'
  }
  if (['cancelled', 'stopped'].includes(status)) return 'bg-gray-400'
  return 'bg-yellow-500'
}

function timeAgo(date) {
  if (!date) return 'Never'
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
  return 'Just now'
}

function deploymentTestId(deployment) {
  if (deployment.status === 'failed') return 'failed-deployment-row'
  if (
    ['pending', 'building', 'pushing', 'deploying'].includes(deployment.status)
  ) {
    return 'active-deployment-row'
  }
  return 'deployment-history-row'
}
</script>

<template>
  <div v-if="deployments.length > 0 || !hideWhenEmpty">
    <h2 class="mb-4 text-sm font-medium text-gray-900 dark:text-white">
      {{ title }}
    </h2>

    <div
      v-if="deployments.length > 0"
      class="rounded-lg border border-gray-200 dark:border-gray-800"
      data-testid="deployment-history"
    >
      <div
        class="divide-y divide-gray-200 rounded-lg bg-white dark:divide-gray-800 dark:bg-gray-950"
      >
        <Link
          v-for="deployment in deployments"
          :key="deployment.id"
          :href="deployment.href"
          :class="[
            'flex items-center justify-between py-3 hover:bg-gray-50 dark:hover:bg-gray-900/50',
            showEnvironment ? 'px-6' : 'px-4'
          ]"
          data-testid="deployment-row"
          :data-test="deploymentTestId(deployment)"
        >
          <div class="flex items-center space-x-3">
            <span
              :class="[
                'h-2 w-2 rounded-full',
                statusDotClasses(deployment.status)
              ]"
            ></span>
            <span
              v-if="showEnvironment"
              class="text-sm text-gray-900 dark:text-white"
            >
              {{ deployment.environment?.name || 'Unknown' }}
            </span>
            <span
              v-if="showStatus"
              :class="[
                'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
                statusBadge(deployment.status).classes
              ]"
            >
              {{ statusBadge(deployment.status).label }}
            </span>
            <span
              v-if="deployment.app?.name"
              class="inline-flex rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400"
            >
              {{ deployment.app.name }}
            </span>
            <span
              v-if="deployment.gitBranch"
              class="text-xs text-gray-500 dark:text-gray-400"
            >
              {{ deployment.gitBranch }}
            </span>
            <span
              v-if="showStatus && deployment.gitCommit"
              class="font-mono text-xs text-gray-400 dark:text-gray-500"
            >
              {{ deployment.gitCommit.slice(0, 7) }}
            </span>
          </div>
          <div class="flex items-center space-x-4">
            <span class="text-xs text-gray-500 dark:text-gray-400">
              {{ deployment.actor }}
            </span>
            <span class="text-xs text-gray-400 dark:text-gray-500">
              {{ timeAgo(deployment.createdAt) }}
            </span>
          </div>
        </Link>
      </div>
    </div>

    <div
      v-else
      class="rounded-lg border border-dashed border-gray-300 px-6 py-8 text-center dark:border-gray-700"
      data-testid="empty-deployment-history"
    >
      <p class="text-sm text-gray-500 dark:text-gray-400">
        {{ emptyMessage }}
      </p>
      <p class="mt-1 text-sm text-gray-400 dark:text-gray-500">
        {{ emptyHelp }}
      </p>
    </div>
  </div>
</template>
