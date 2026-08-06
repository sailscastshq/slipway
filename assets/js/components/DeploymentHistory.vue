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
  const oldestFirst = (left, right) =>
    Number(left.createdAt) - Number(right.createdAt) ||
    Number(left.id) - Number(right.id)
  const active = history.activeDeployments || []
  const executing = active.filter((item) => item.status !== 'pending')
  const queued = active.filter((item) => item.status === 'pending')

  for (const [group, sort] of [
    [executing, newestFirst],
    [history.currentReleases || [], newestFirst],
    [queued, oldestFirst],
    [history.items || [], newestFirst]
  ]) {
    for (const deployment of [...group].sort(sort)) {
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

function patchState(deploymentId, state) {
  const patch = (deployment) => {
    const sameApp =
      state.appId && String(deployment.app?.id || '') === String(state.appId)
    const demoted =
      state.isCurrent && sameApp && deployment.id !== deploymentId
        ? {
            ...deployment,
            isCurrent: false,
            outcome: 'succeeded',
            outcomeLabel: 'Succeeded'
          }
        : deployment

    return deployment.id === deploymentId ? { ...demoted, ...state } : demoted
  }

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

        patchState(deployment.id, {
          status: data.status,
          outcome: data.outcome,
          outcomeLabel: data.outcomeLabel,
          isCurrent: data.isCurrent,
          isActive: data.isActive,
          appId: data.appId
        })

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

function outcomeBadge(deployment) {
  const map = {
    current: {
      classes:
        'bg-emerald-100 text-emerald-800 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-400/20'
    },
    succeeded: {
      classes:
        'bg-gray-100 text-gray-700 ring-1 ring-inset ring-gray-500/15 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-400/20'
    },
    'in-progress': {
      classes:
        'bg-blue-100 text-blue-700 ring-1 ring-inset ring-blue-600/20 dark:bg-blue-900/30 dark:text-blue-300 dark:ring-blue-400/20'
    },
    failed: {
      classes:
        'bg-red-100 text-red-700 ring-1 ring-inset ring-red-600/20 dark:bg-red-900/30 dark:text-red-300 dark:ring-red-400/20'
    },
    cancelled: {
      classes:
        'bg-gray-100 text-gray-600 ring-1 ring-inset ring-gray-500/15 dark:bg-gray-800 dark:text-gray-400 dark:ring-gray-400/20'
    }
  }

  return {
    label: deployment.outcomeLabel || deployment.status,
    classes:
      map[deployment.outcome]?.classes ||
      'bg-gray-100 text-gray-600 ring-1 ring-inset ring-gray-500/15 dark:bg-gray-800 dark:text-gray-400 dark:ring-gray-400/20'
  }
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
  if (deployment.outcome === 'failed') return 'failed-deployment-row'
  if (deployment.isActive) return 'active-deployment-row'
  return 'deployment-history-row'
}
</script>

<template>
  <div
    v-if="deployments.length > 0 || !hideWhenEmpty"
    data-testid="deployment-history-section"
  >
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
              v-if="showEnvironment"
              class="text-sm text-gray-900 dark:text-white"
            >
              {{ deployment.environment?.name || 'Unknown' }}
            </span>
            <span
              v-if="showStatus"
              :class="[
                'inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium',
                outcomeBadge(deployment).classes
              ]"
            >
              {{ outcomeBadge(deployment).label }}
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
