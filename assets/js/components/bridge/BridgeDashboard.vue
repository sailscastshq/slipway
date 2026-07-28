<script setup>
import { computed } from 'vue'
import { Link } from '@inertiajs/vue3'
import BridgeActionMenu from '@/components/bridge/BridgeActionMenu.vue'
import BridgeFieldValue from '@/components/bridge/BridgeFieldValue.vue'

const props = defineProps({
  dashboard: {
    type: Object,
    required: true
  },
  resources: {
    type: Object,
    required: true
  },
  project: {
    type: Object,
    required: true
  },
  environment: {
    type: Object,
    required: true
  },
  app: {
    type: Object
  },
  appScoped: {
    type: Boolean,
    default: false
  }
})

const actionCards = computed(() =>
  props.dashboard.cards.filter((card) => card.type === 'action')
)
const quickActions = computed(() =>
  actionCards.value.map((card) => ({
    key: card.id,
    label: card.label,
    href: actionUrl(card)
  }))
)
const valueCards = computed(() =>
  props.dashboard.cards.filter((card) =>
    ['metric', 'custom'].includes(card.type)
  )
)
const detailCards = computed(() =>
  props.dashboard.cards.filter((card) =>
    ['recent', 'trend', 'partition'].includes(card.type)
  )
)

function resourceUrl(identity) {
  const base =
    props.appScoped && props.app?.slug
      ? `/projects/${props.project.slug}/environments/${props.environment.slug}/apps/${props.app.slug}/bridge`
      : `/projects/${props.project.slug}/environments/${props.environment.slug}/bridge`
  return `${base}/${identity}`
}

function actionUrl(card) {
  return `${resourceUrl(card.resource)}/new`
}

function recordUrl(card, record) {
  const resource = props.resources[card.resource]
  const id = record?.[resource?.primaryKey]
  return `${resourceUrl(card.resource)}/${encodeURIComponent(String(id))}`
}

function cardResource(card) {
  return props.resources[card.resource]
}

function recentTitle(card, record) {
  const resource = cardResource(card)
  const title = record?.[resource?.title]
  return title ?? record?.[resource?.primaryKey] ?? 'Record'
}

function recentDetailFields(card) {
  const resource = cardResource(card)
  return card.fields
    .filter(
      (field) =>
        field !== resource?.primaryKey &&
        field !== resource?.title &&
        resource?.attributes?.[field]
    )
    .slice(0, 2)
}

function formatValue(card) {
  if (card.error || card.value === null || card.value === undefined) return '—'
  if (card.type === 'custom') return String(card.value)

  const value = Number(card.value)
  if (!Number.isFinite(value)) return '—'
  let formatted
  if (card.format === 'currency') {
    formatted = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: card.currency,
      maximumFractionDigits: 2
    }).format(value)
  } else if (card.format === 'compact') {
    formatted = new Intl.NumberFormat(undefined, {
      notation: 'compact',
      maximumFractionDigits: 1
    }).format(value)
  } else if (card.format === 'percent') {
    formatted = new Intl.NumberFormat(undefined, {
      style: 'percent',
      maximumFractionDigits: 1
    }).format(value)
  } else {
    formatted = new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 2
    }).format(value)
  }
  return `${card.prefix || ''}${formatted}${card.suffix || ''}`
}

function trendPath(points) {
  if (!Array.isArray(points) || points.length === 0) return ''
  if (points.length === 1) return 'M 0 32 L 240 32'
  const values = points.map((point) => Number(point.value))
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  return points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * 240
      const y = 58 - ((Number(point.value) - min) / range) * 52
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(' ')
}

function partitionWidth(card, value) {
  const max = Math.max(
    1,
    ...(card.segments || []).map((segment) => Number(segment.value) || 0)
  )
  return `${Math.max(2, (Number(value) / max) * 100)}%`
}
</script>

<template>
  <section aria-labelledby="bridge-dashboard-title">
    <div class="flex items-start justify-between gap-4">
      <div class="min-w-0">
        <h1
          id="bridge-dashboard-title"
          class="text-xl font-semibold tracking-tight text-gray-950 dark:text-white"
        >
          {{ dashboard.label }}
        </h1>
        <p
          v-if="dashboard.description"
          class="mt-1 max-w-2xl text-sm leading-6 text-gray-500 dark:text-gray-400"
        >
          {{ dashboard.description }}
        </p>
      </div>

      <BridgeActionMenu
        :items="quickActions"
        label="Quick actions"
        orientation="vertical"
        test-id="bridge-dashboard-quick-actions"
        class="shrink-0"
      />
    </div>

    <dl
      v-if="valueCards.length"
      class="mt-8 grid gap-x-10 gap-y-7 sm:grid-cols-2 lg:grid-cols-4"
    >
      <div v-for="card in valueCards" :key="card.id" class="min-w-0">
        <dt class="truncate text-sm text-gray-500 dark:text-gray-400">
          {{ card.label }}
        </dt>
        <dd
          class="mt-1 truncate text-3xl font-semibold tabular-nums tracking-tight text-gray-950 dark:text-white"
          :title="card.error || undefined"
        >
          {{ formatValue(card) }}
        </dd>
        <p
          v-if="card.error"
          class="mt-1 truncate text-xs text-red-600 dark:text-red-400"
        >
          Unavailable
        </p>
        <p
          v-else-if="card.detail || card.description"
          class="mt-1 truncate text-xs text-gray-400 dark:text-gray-500"
        >
          {{ card.detail || card.description }}
        </p>
      </div>
    </dl>

    <div
      v-if="detailCards.length"
      class="mt-10 grid gap-x-12 gap-y-10 lg:grid-cols-2"
    >
      <section
        v-for="card in detailCards"
        :key="card.id"
        :aria-labelledby="`bridge-card-${card.id}`"
        class="min-w-0"
      >
        <div class="flex items-baseline justify-between gap-4">
          <div class="min-w-0">
            <h2
              :id="`bridge-card-${card.id}`"
              class="truncate text-sm font-medium text-gray-950 dark:text-white"
            >
              {{ card.label }}
            </h2>
            <p
              v-if="card.description"
              class="mt-1 truncate text-xs text-gray-400 dark:text-gray-500"
            >
              {{ card.description }}
            </p>
          </div>
          <Link
            v-if="card.type === 'recent'"
            :href="resourceUrl(card.resource)"
            class="shrink-0 text-xs font-medium text-gray-500 hover:text-gray-950 dark:text-gray-400 dark:hover:text-white"
          >
            View all
          </Link>
        </div>

        <p
          v-if="card.error"
          class="mt-5 text-sm text-red-600 dark:text-red-400"
        >
          This card is temporarily unavailable.
        </p>

        <ol
          v-else-if="card.type === 'recent' && card.records?.length"
          class="mt-3 divide-y divide-gray-100 dark:divide-gray-900"
        >
          <li v-for="record in card.records" :key="recordUrl(card, record)">
            <Link
              :href="recordUrl(card, record)"
              class="min-h-12 group flex items-center justify-between gap-5 py-3"
            >
              <span
                class="min-w-0 truncate text-sm font-medium text-gray-800 group-hover:text-gray-950 dark:text-gray-200 dark:group-hover:text-white"
              >
                {{ recentTitle(card, record) }}
              </span>
              <span
                v-if="recentDetailFields(card).length"
                class="flex min-w-0 shrink items-center gap-3 overflow-hidden text-xs text-gray-400 dark:text-gray-500"
              >
                <span
                  v-for="field in recentDetailFields(card)"
                  :key="field"
                  class="min-w-0 truncate"
                >
                  <BridgeFieldValue
                    :name="field"
                    :attribute="cardResource(card).attributes[field]"
                    :value="record[field]"
                    context="list"
                  />
                </span>
              </span>
            </Link>
          </li>
        </ol>

        <p
          v-else-if="card.type === 'recent'"
          class="mt-5 text-sm text-gray-400 dark:text-gray-500"
        >
          No records yet.
        </p>

        <div v-else-if="card.type === 'trend'" class="mt-5">
          <svg
            v-if="card.points?.length"
            class="h-20 w-full overflow-visible text-gray-950 dark:text-white"
            viewBox="0 0 240 64"
            preserveAspectRatio="none"
            role="img"
            :aria-label="`${card.label} trend`"
          >
            <path
              :d="trendPath(card.points)"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              vector-effect="non-scaling-stroke"
            />
          </svg>
          <p v-else class="text-sm text-gray-400 dark:text-gray-500">
            No trend data yet.
          </p>
          <div
            v-if="card.points?.length"
            class="mt-2 flex justify-between text-xs text-gray-400 dark:text-gray-500"
          >
            <span>{{ card.points[0].label }}</span>
            <span>{{ card.points[card.points.length - 1].label }}</span>
          </div>
        </div>

        <div v-else-if="card.type === 'partition'" class="mt-5 space-y-3">
          <div v-for="segment in card.segments || []" :key="segment.label">
            <div
              class="mb-1.5 flex items-baseline justify-between gap-4 text-xs"
            >
              <span class="truncate text-gray-500 dark:text-gray-400">
                {{ segment.label }}
              </span>
              <span
                class="shrink-0 tabular-nums text-gray-800 dark:text-gray-200"
              >
                {{ segment.value.toLocaleString() }}
              </span>
            </div>
            <div class="h-1 rounded-full bg-gray-100 dark:bg-gray-900">
              <div
                class="h-1 rounded-full bg-gray-800 dark:bg-gray-200"
                :style="{ width: partitionWidth(card, segment.value) }"
              ></div>
            </div>
          </div>
          <p
            v-if="!card.segments?.length"
            class="text-sm text-gray-400 dark:text-gray-500"
          >
            No partition data yet.
          </p>
        </div>
      </section>
    </div>
  </section>
</template>
