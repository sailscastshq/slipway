<script setup>
import Input from '@/components/ui/input/Input.vue'
import Checkbox from '@/components/ui/checkbox/Checkbox.vue'
import Radio from '@/components/ui/radio/Radio.vue'
import { Head, Link, router, useForm } from '@inertiajs/vue3'
import {
  computed,
  inject,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  watch
} from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'
import Breadcrumb from '@/components/ui/breadcrumb/Breadcrumb.vue'
import MarkdownEditor from '@/components/content/MarkdownEditor.vue'
import Alert from '@/components/ui/alert/Alert.vue'
import Select from '@/components/ui/select/Select.vue'
import Tabs from '@/components/ui/tabs/Tabs.vue'
import { useQueryState } from '@/components/ui/durable-ui/useQueryState'

defineOptions({ layout: AppLayout })

const props = defineProps({
  project: Object,
  environment: Object,
  app: Object,
  bearing: Object,
  activeView: String,
  feedback: Array,
  attentionFeedback: Array,
  updates: Array,
  counts: Object,
  publicUrls: Object,
  uploadsConfigured: Boolean,
  hookDetected: Boolean
})

const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')

const basePath = computed(
  () =>
    `/projects/${props.project.slug}/environments/${props.environment.slug}/apps/${props.app.slug}`
)
const bearingPath = computed(() => `${basePath.value}/bearing`)
const updateImageUploadPath = computed(
  () =>
    `/api/v1/projects/${props.project.slug}/environments/${props.environment.slug}/apps/${props.app.slug}/bearing/updates/images`
)
const navItems = [
  ['overview', 'Overview'],
  ['feedback', 'Feedback'],
  ['roadmap', 'Roadmap'],
  ['updates', 'Updates'],
  ['settings', 'Settings']
]
const selectedView = useQueryState('view', 'overview', {
  validate: (view) => navItems.some(([candidate]) => candidate === view)
})
const tablist = ref(null)
const copiedSurface = ref(null)
let copyResetTimer
const roadmapGroups = computed(() =>
  ['planned', 'in_progress', 'shipped'].map((status) => ({
    status,
    items: props.feedback.filter((item) => item.status === status)
  }))
)
const overviewMetrics = computed(() => [
  { label: 'Feedback', value: props.counts.feedback, view: 'feedback' },
  { label: 'Votes', value: props.counts.votes, view: 'feedback' },
  { label: 'Planned', value: props.counts.planned, view: 'roadmap' },
  { label: 'People', value: props.counts.participants },
  {
    label: 'Updates',
    value: props.counts.publishedUpdates,
    view: 'updates'
  }
])
const publicSurfaces = computed(() => {
  if (!props.publicUrls) return []

  return [
    {
      key: 'feedback',
      label: 'Feedback',
      url: props.publicUrls.feedback,
      enabled: props.bearing.enabled
    },
    {
      key: 'roadmap',
      label: 'Roadmap',
      url: props.publicUrls.roadmap,
      enabled: props.bearing.enabled && props.bearing.showPublicRoadmap
    },
    {
      key: 'updates',
      label: 'Updates',
      url: props.publicUrls.updates,
      enabled: props.bearing.enabled && props.bearing.showPublicUpdates
    }
  ]
})

const form = useForm({
  enabled: props.bearing.enabled,
  acceptFeedback: props.bearing.acceptFeedback,
  allowAnonymousParticipation: props.bearing.allowAnonymousParticipation,
  feedbackCategories: props.bearing.feedbackCategories.map((category) => ({
    ...category
  })),
  showPublicRoadmap: props.bearing.showPublicRoadmap,
  showPublicUpdates: props.bearing.showPublicUpdates,
  widgetEnabled: props.bearing.widgetEnabled,
  widgetSide: props.bearing.widgetSide,
  widgetOpeningView: props.bearing.widgetOpeningView,
  showUnread: props.bearing.showUnread
})
const updateForm = useForm({
  title: '',
  excerpt: '',
  body: '',
  feedbackIds: [],
  publish: false
})

function save() {
  form.patch(bearingPath.value, { preserveScroll: true })
}

function toggle(field) {
  form[field] = !form[field]
}

function addCategory() {
  if (form.feedbackCategories.length >= 6) return
  form.feedbackCategories.push({
    key: `category_${crypto.randomUUID().slice(0, 8)}`,
    label: 'New category',
    active: true
  })
}

function moveCategory(index, offset) {
  const nextIndex = index + offset
  if (nextIndex < 0 || nextIndex >= form.feedbackCategories.length) return
  const [category] = form.feedbackCategories.splice(index, 1)
  form.feedbackCategories.splice(nextIndex, 0, category)
}

function toggleCategory(category) {
  const activeCount = form.feedbackCategories.filter(
    (item) => item.active
  ).length
  if (category.active && activeCount === 1) return
  category.active = !category.active
}

function moveFeedback(item, status) {
  router.patch(
    `${bearingPath.value}/feedback/${item.publicId}`,
    { status },
    { preserveScroll: true }
  )
}

function saveUpdate(publish) {
  updateForm.publish = publish
  updateForm.post(`${bearingPath.value}/updates`, {
    preserveScroll: true,
    onSuccess: () => updateForm.reset()
  })
}

function publishUpdate(item) {
  router.post(
    `${bearingPath.value}/updates/${item.publicId}/publish`,
    {},
    { preserveScroll: true }
  )
}

function roadmapLabel(status) {
  return {
    planned: 'Planned',
    in_progress: 'In progress',
    shipped: 'Shipped'
  }[status]
}

function selectView(view) {
  selectedView.value = view
}

function revealSelectedTab() {
  nextTick(() => {
    tablist.value
      ?.querySelector(`#bearing-tab-${selectedView.value}`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  })
}

async function copyPublicUrl(surface) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(surface.url)
    } else {
      const field = document.createElement('textarea')
      field.value = surface.url
      field.setAttribute('readonly', '')
      field.style.position = 'fixed'
      field.style.opacity = '0'
      document.body.appendChild(field)
      field.select()
      const copied = document.execCommand('copy')
      field.remove()
      if (!copied) throw new Error('Copy is unavailable')
    }

    copiedSurface.value = surface.key
    window.clearTimeout(copyResetTimer)
    copyResetTimer = window.setTimeout(() => {
      copiedSurface.value = null
    }, 2200)
  } catch {
    copiedSurface.value = null
  }
}

function publicUrlPath(url) {
  try {
    const parsed = new URL(url)
    return `${parsed.host}${parsed.pathname}`
  } catch {
    return url
  }
}

watch(selectedView, revealSelectedTab)
onMounted(() => {
  revealSelectedTab()
  window.addEventListener('resize', revealSelectedTab)
})
onUnmounted(() => {
  window.removeEventListener('resize', revealSelectedTab)
  window.clearTimeout(copyResetTimer)
})
</script>

<template>
  <Head :title="`Bearing - ${app.name} | Slipway`"></Head>
  <div class="flex h-full flex-col">
    <header
      class="flex items-center justify-between border-b border-gray-200 py-4 pl-4 pr-4 dark:border-gray-800 sm:pr-8"
    >
      <div class="flex min-w-0 items-center gap-3">
        <button
          type="button"
          class="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white md:hidden"
          aria-label="Open navigation"
          @click="toggleMobileMenu"
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
            />
            <path d="M5.615 14.285V.715" />
          </svg>
        </button>
        <button
          type="button"
          class="hidden text-gray-400 dark:text-gray-500 md:block"
          :aria-label="sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
          @click="toggleSidebar"
        >
          <svg
            class="h-5 w-5"
            viewBox="-0.5 -0.5 16 16"
            fill="none"
            stroke="currentColor"
          >
            <path
              d="M12.777 14.285H2.223c-.833 0-1.508-.675-1.508-1.508V2.223c0-.833.675-1.508 1.508-1.508h10.554c.833 0 1.508.675 1.508 1.508v10.554c0 .833-.675 1.508-1.508 1.508Z"
            />
            <path d="M5.615 14.285V.715" />
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
            { label: app.name.toLowerCase(), href: basePath },
            { label: 'bearing' }
          ]"
        />
      </div>
    </header>

    <main
      class="flex-1 overflow-y-auto px-4 py-8 text-gray-950 dark:text-white sm:px-8 sm:py-12"
    >
      <Tabs
        v-model="selectedView"
        aria-label="Bearing sections"
        class="mx-auto max-w-3xl"
      >
        <div
          class="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between"
        >
          <div>
            <div class="flex items-center gap-2.5">
              <h1 class="text-xl font-semibold text-gray-950 dark:text-white">
                Bearing
              </h1>
              <span
                :class="[
                  'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
                  form.enabled
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                    : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                ]"
              >
                <span
                  :class="[
                    'h-1.5 w-1.5 rounded-full',
                    form.enabled ? 'bg-emerald-500' : 'bg-gray-400'
                  ]"
                ></span>
                {{ form.enabled ? 'On' : 'Off' }}
              </span>
            </div>
            <p
              class="mt-1 max-w-xl text-sm leading-6 text-gray-500 dark:text-gray-400"
            >
              Collect feedback, show what is planned, and publish what shipped
              on {{ app.name }}'s own domain.
            </p>
          </div>
          <button
            v-if="selectedView === 'settings'"
            type="button"
            data-test="save-bearing-settings"
            :disabled="!form.isDirty || form.processing"
            class="min-h-10 disabled:opacity-35 inline-flex shrink-0 items-center justify-center rounded-lg bg-gray-950 px-4 text-sm font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed dark:bg-white dark:text-gray-950 dark:hover:bg-gray-100"
            @click="save"
          >
            {{ form.processing ? 'Saving…' : 'Save changes' }}
          </button>
        </div>

        <Alert
          v-if="form.enabled && !hookDetected"
          class="mt-8 rounded-xl bg-amber-50 px-4 py-3 text-inherit dark:bg-amber-950/30"
          role="note"
        >
          <p class="text-sm font-medium text-amber-900 dark:text-amber-200">
            Update sails-hook-slipway, then redeploy this app.
          </p>
          <p class="mt-1 text-sm leading-6 text-amber-700 dark:text-amber-300">
            Public pages can be prepared now. The compatible hook will add the
            signed-in participant handshake and optional in-app widget.
          </p>
        </Alert>

        <div
          ref="tablist"
          data-slot="tabs-list"
          class="mt-8 flex items-center gap-1 overflow-x-auto py-1"
        >
          <button
            v-for="(item, index) in navItems"
            :id="`bearing-tab-${item[0]}`"
            :key="item[0]"
            type="button"
            :data-value="item[0]"
            :aria-controls="`bearing-panel-${item[0]}`"
            :class="[
              'min-h-10 shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 dark:focus-visible:ring-gray-600',
              selectedView === item[0]
                ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-300'
            ]"
          >
            {{ item[1] }}
          </button>
        </div>

        <section
          v-if="selectedView === 'overview'"
          id="bearing-panel-overview"
          data-slot="tab-panel"
          data-value="overview"
          class="mt-10"
        >
          <div
            class="grid grid-cols-2 gap-3 min-[360px]:grid-cols-3 sm:grid-cols-5"
          >
            <component
              :is="metric.view ? 'button' : 'div'"
              v-for="metric in overviewMetrics"
              :key="metric.label"
              :data-test="`bearing-metric-${metric.label.toLowerCase()}`"
              :type="metric.view ? 'button' : undefined"
              :class="[
                'group rounded-xl bg-gray-50 p-4 text-left dark:bg-gray-900',
                metric.view
                  ? 'transition hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-950 focus-visible:ring-offset-2 dark:hover:bg-gray-800 dark:focus-visible:ring-white dark:focus-visible:ring-offset-gray-950'
                  : ''
              ]"
              @click="metric.view && selectView(metric.view)"
            >
              <p
                class="flex items-center justify-between gap-2 text-xs font-medium text-gray-500 dark:text-gray-400"
              >
                <span>{{ metric.label }}</span>
                <svg
                  v-if="metric.view"
                  aria-hidden="true"
                  viewBox="0 0 16 16"
                  class="size-3.5 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100"
                  fill="none"
                >
                  <path
                    d="m6 3.5 4.5 4.5L6 12.5"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </p>
              <p
                class="mt-3 text-2xl font-semibold tabular-nums tracking-tight"
              >
                {{ metric.value }}
              </p>
            </component>
          </div>

          <div class="mt-10 grid gap-10 lg:grid-cols-[1.1fr_0.9fr]">
            <section aria-labelledby="bearing-attention-heading">
              <div class="flex items-center justify-between gap-4">
                <div>
                  <h2
                    id="bearing-attention-heading"
                    class="text-sm font-semibold"
                  >
                    Needs attention
                  </h2>
                  <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    Feedback waiting for a decision.
                  </p>
                </div>
                <button
                  v-if="attentionFeedback.length"
                  type="button"
                  class="min-h-10 shrink-0 rounded-lg px-2.5 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-950 dark:text-gray-400 dark:hover:bg-gray-900 dark:hover:text-white dark:focus-visible:ring-white"
                  @click="selectView('feedback')"
                >
                  View all
                </button>
              </div>
              <ul v-if="attentionFeedback.length" class="mt-4 space-y-2">
                <li v-for="item in attentionFeedback" :key="item.publicId">
                  <button
                    type="button"
                    class="min-h-16 group flex w-full items-center justify-between gap-4 rounded-xl bg-gray-50 px-4 py-3 text-left transition hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-950 focus-visible:ring-offset-2 dark:bg-gray-900 dark:hover:bg-gray-800 dark:focus-visible:ring-white dark:focus-visible:ring-offset-gray-950"
                    @click="selectView('feedback')"
                  >
                    <span class="min-w-0">
                      <span class="block truncate text-sm font-medium">{{
                        item.title
                      }}</span>
                      <span
                        class="mt-1 block text-xs capitalize text-gray-400"
                        >{{ item.category }}</span
                      >
                    </span>
                    <span class="shrink-0 text-xs tabular-nums text-gray-400"
                      >▲ {{ item.voteCount }}</span
                    >
                  </button>
                </li>
              </ul>
              <div
                v-else
                class="mt-4 rounded-xl bg-gray-50 px-4 py-5 dark:bg-gray-900"
              >
                <p class="text-sm font-medium">You are caught up.</p>
                <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  New feedback will appear here for review.
                </p>
              </div>
            </section>

            <section
              v-if="publicSurfaces.length"
              aria-labelledby="bearing-public-surfaces-heading"
            >
              <div>
                <h2
                  id="bearing-public-surfaces-heading"
                  class="text-sm font-semibold"
                >
                  Public surfaces
                </h2>
                <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  What customers can open on {{ app.name }}.
                </p>
              </div>
              <ul class="mt-4 space-y-2">
                <li
                  v-for="surface in publicSurfaces"
                  :key="surface.key"
                  :data-test="`bearing-public-surface-${surface.key}`"
                  class="min-h-16 group flex items-center justify-between gap-3 rounded-xl bg-gray-50 px-4 py-3 dark:bg-gray-900"
                >
                  <div class="min-w-0">
                    <div class="flex items-center gap-2">
                      <h3 class="text-sm font-medium">{{ surface.label }}</h3>
                      <span
                        :class="[
                          'inline-flex items-center gap-1 text-[11px] font-medium',
                          surface.enabled
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-gray-400'
                        ]"
                      >
                        <span
                          :class="[
                            'size-1.5 rounded-full',
                            surface.enabled
                              ? 'bg-emerald-500'
                              : 'bg-gray-300 dark:bg-gray-600'
                          ]"
                        ></span>
                        {{ surface.enabled ? 'On' : 'Off' }}
                      </span>
                    </div>
                    <p class="mt-1 truncate text-xs text-gray-400">
                      {{ publicUrlPath(surface.url) }}
                    </p>
                  </div>
                  <div class="flex shrink-0 items-center gap-1">
                    <template v-if="surface.enabled">
                      <button
                        type="button"
                        class="min-h-10 rounded-lg px-2.5 text-xs font-medium text-gray-500 hover:bg-white hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-950 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-white dark:focus-visible:ring-white"
                        :aria-label="`Copy ${surface.label} link`"
                        @click="copyPublicUrl(surface)"
                      >
                        {{ copiedSurface === surface.key ? 'Copied' : 'Copy' }}
                      </button>
                      <a
                        :href="surface.url"
                        target="_blank"
                        rel="noreferrer"
                        class="min-h-10 inline-flex items-center rounded-lg px-2.5 text-xs font-medium text-gray-700 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-950 dark:text-gray-200 dark:hover:bg-gray-700 dark:focus-visible:ring-white"
                      >
                        Open
                        <span class="sr-only"> {{ surface.label }}</span>
                      </a>
                    </template>
                    <button
                      v-else
                      type="button"
                      class="min-h-10 rounded-lg px-2.5 text-xs font-medium text-gray-500 hover:bg-white hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-950 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-white dark:focus-visible:ring-white"
                      @click="selectView('settings')"
                    >
                      Turn on
                      <span class="sr-only"> {{ surface.label }}</span>
                    </button>
                  </div>
                </li>
              </ul>
              <p class="sr-only" aria-live="polite">
                {{ copiedSurface ? `${copiedSurface} link copied.` : '' }}
              </p>
            </section>
          </div>
        </section>

        <section
          v-else-if="selectedView === 'feedback'"
          id="bearing-panel-feedback"
          data-slot="tab-panel"
          data-value="feedback"
          class="mt-10"
        >
          <div class="flex items-end justify-between gap-4">
            <div>
              <h2 class="text-base font-semibold">Customer feedback</h2>
              <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Review requests without losing the customer behind them.
              </p>
            </div>
            <span class="text-sm text-gray-400">{{ feedback.length }}</span>
          </div>
          <div class="mt-6 divide-y divide-gray-200 dark:divide-gray-800">
            <article v-for="item in feedback" :key="item.publicId" class="py-5">
              <div
                class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"
              >
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <h3 class="font-medium">{{ item.title }}</h3>
                    <span class="text-xs text-gray-400"
                      >▲ {{ item.voteCount }}</span
                    >
                  </div>
                  <p
                    v-if="item.details"
                    class="mt-1 line-clamp-2 text-sm leading-6 text-gray-500 dark:text-gray-400"
                  >
                    {{ item.details }}
                  </p>
                  <p class="mt-2 text-xs text-gray-400">
                    {{ item.authorName }} · {{ item.category }}
                  </p>
                </div>
                <label class="shrink-0">
                  <span class="sr-only">Status for {{ item.title }}</span>
                  <Select
                    :model-value="item.status"
                    :options="[
                      { value: 'reviewing', label: 'Reviewing' },
                      { value: 'planned', label: 'Planned' },
                      { value: 'in_progress', label: 'In progress' },
                      { value: 'shipped', label: 'Shipped' },
                      { value: 'closed', label: 'Closed' }
                    ]"
                    class="min-h-10 rounded-lg border-0 bg-gray-50 px-3 text-sm focus:ring-2 focus:ring-gray-400 dark:bg-gray-900"
                    @change="moveFeedback(item, $event)"
                  />
                </label>
              </div>
            </article>
            <p
              v-if="!feedback.length"
              class="py-14 text-center text-sm text-gray-400"
            >
              No feedback yet.
            </p>
          </div>
        </section>

        <section
          v-else-if="selectedView === 'roadmap'"
          id="bearing-panel-roadmap"
          data-slot="tab-panel"
          data-value="roadmap"
          class="mt-10"
        >
          <div class="grid gap-4 lg:grid-cols-3">
            <section v-for="group in roadmapGroups" :key="group.status">
              <div class="flex items-center justify-between px-1">
                <h2 class="text-sm font-semibold">
                  {{ roadmapLabel(group.status) }}
                </h2>
                <span class="text-xs text-gray-400">{{
                  group.items.length
                }}</span>
              </div>
              <div class="mt-3 space-y-2">
                <article
                  v-for="item in group.items"
                  :key="item.publicId"
                  class="rounded-xl bg-gray-50 p-4 dark:bg-gray-900"
                >
                  <h3 class="text-sm font-medium">{{ item.title }}</h3>
                  <p class="mt-2 text-xs text-gray-400">
                    ▲ {{ item.voteCount }}
                  </p>
                </article>
                <p
                  v-if="!group.items.length"
                  class="px-2 py-8 text-center text-xs text-gray-400"
                >
                  Nothing here.
                </p>
              </div>
            </section>
          </div>
        </section>

        <section
          v-else-if="selectedView === 'updates'"
          id="bearing-panel-updates"
          data-slot="tab-panel"
          data-value="updates"
          class="mt-10"
        >
          <form class="space-y-5" @submit.prevent="saveUpdate(false)">
            <div>
              <h2 class="text-base font-semibold">Write an update</h2>
              <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Publishing also marks every linked request as shipped.
              </p>
            </div>
            <div>
              <label for="bearing-update-title" class="sr-only">
                Update title
              </label>
              <Input
                id="bearing-update-title"
                v-model="updateForm.title"
                required
                maxlength="140"
                placeholder="What shipped?"
                class="min-h-12 w-full border-0 border-b border-dashed border-gray-300 bg-transparent px-0 text-xl font-semibold outline-none focus:border-gray-950 focus:outline-none focus:ring-0 focus-visible:outline-none dark:border-gray-700 dark:focus:border-white"
              />
            </div>
            <div>
              <label for="bearing-update-excerpt" class="sr-only">
                Update summary
              </label>
              <Input
                id="bearing-update-excerpt"
                v-model="updateForm.excerpt"
                required
                maxlength="280"
                placeholder="A useful one-line summary"
                class="min-h-11 w-full border-0 border-b border-dashed border-gray-300 bg-transparent px-0 text-sm outline-none focus:border-gray-950 focus:outline-none focus:ring-0 focus-visible:outline-none dark:border-gray-700 dark:focus:border-white"
              />
            </div>
            <div>
              <p
                id="bearing-update-body-label"
                class="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400"
              >
                Update body
              </p>
              <MarkdownEditor
                v-model="updateForm.body"
                variant="field"
                editor-id="bearing-update-body"
                :uploads-configured="uploadsConfigured"
                :upload-url="updateImageUploadPath"
                show-upload-control
                aria-labelledby="bearing-update-body-label"
                placeholder="Tell customers what changed and why it matters."
                required
                deny-raw-html
              />
              <p
                v-if="!uploadsConfigured"
                class="mt-2 text-xs text-gray-500 dark:text-gray-400"
              >
                Images need public file storage.
                <Link
                  href="/settings/uploads"
                  class="font-medium text-gray-900 underline decoration-dotted underline-offset-4 dark:text-white"
                >
                  Finish setup
                </Link>
              </p>
            </div>
            <p
              v-if="updateForm.errors.update"
              role="alert"
              class="text-sm text-red-600 dark:text-red-400"
            >
              {{ updateForm.errors.update }}
            </p>
            <fieldset v-if="feedback.length">
              <legend class="text-xs font-medium text-gray-500">
                Delivered feedback
              </legend>
              <div class="mt-3 flex max-h-36 flex-wrap gap-2 overflow-y-auto">
                <label
                  v-for="item in feedback"
                  :key="item.publicId"
                  class="has-[:checked]:bg-gray-950 has-[:checked]:text-white dark:has-[:checked]:bg-white dark:has-[:checked]:text-gray-950 cursor-pointer rounded-full bg-gray-50 px-3 py-2 text-xs dark:bg-gray-900"
                >
                  <Checkbox
                    v-model="updateForm.feedbackIds"
                    class="sr-only"
                    :value="item.publicId"
                  />
                  {{ item.title }}
                </label>
              </div>
            </fieldset>
            <div class="flex gap-2">
              <button
                type="submit"
                :disabled="
                  updateForm.processing ||
                  !updateForm.title ||
                  !updateForm.excerpt ||
                  !updateForm.body
                "
                class="min-h-10 disabled:opacity-35 rounded-lg bg-gray-100 px-4 text-sm font-medium dark:bg-gray-800"
              >
                Save draft
              </button>
              <button
                type="button"
                :disabled="
                  updateForm.processing ||
                  !updateForm.title ||
                  !updateForm.excerpt ||
                  !updateForm.body
                "
                class="min-h-10 disabled:opacity-35 rounded-lg bg-gray-950 px-4 text-sm font-medium text-white dark:bg-white dark:text-gray-950"
                @click="saveUpdate(true)"
              >
                Publish update
              </button>
            </div>
          </form>
          <div class="mt-12 divide-y divide-gray-200 dark:divide-gray-800">
            <article v-for="item in updates" :key="item.publicId" class="py-5">
              <div class="flex items-start justify-between gap-4">
                <div>
                  <p
                    class="text-xs font-medium uppercase tracking-wider text-gray-400"
                  >
                    {{ item.status }}
                  </p>
                  <h3 class="mt-1 font-medium">{{ item.title }}</h3>
                  <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    {{ item.excerpt }}
                  </p>
                </div>
                <button
                  v-if="item.status === 'draft'"
                  type="button"
                  class="min-h-10 shrink-0 rounded-lg px-3 text-sm font-medium hover:bg-gray-100 dark:hover:bg-gray-800"
                  @click="publishUpdate(item)"
                >
                  Publish
                </button>
              </div>
            </article>
          </div>
        </section>

        <form
          v-else
          id="bearing-panel-settings"
          data-slot="tab-panel"
          data-value="settings"
          class="mt-10 space-y-12"
          @submit.prevent="save"
        >
          <section aria-labelledby="bearing-availability-heading">
            <div>
              <h2
                id="bearing-availability-heading"
                class="text-sm font-semibold text-gray-950 dark:text-white"
              >
                Availability
              </h2>
              <p
                class="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400"
              >
                Keep the whole feedback loop under one app-level switch.
              </p>
            </div>

            <div class="mt-5 space-y-3">
              <div
                class="flex items-start justify-between gap-6 rounded-xl bg-gray-50 px-4 py-4 dark:bg-gray-900"
              >
                <div>
                  <p class="text-sm font-medium text-gray-950 dark:text-white">
                    Bearing
                  </p>
                  <p
                    class="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400"
                  >
                    Publish Feedback, Roadmap, and Updates for this app.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  data-test="bearing-enabled"
                  :aria-checked="form.enabled"
                  aria-label="Enable Bearing"
                  :class="[
                    'relative mt-0.5 inline-flex h-6 w-10 shrink-0 rounded-full p-0.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-950',
                    form.enabled
                      ? 'bg-gray-950 dark:bg-white'
                      : 'bg-gray-300 dark:bg-gray-700'
                  ]"
                  @click="toggle('enabled')"
                >
                  <span
                    :class="[
                      'h-5 w-5 rounded-full bg-white shadow-sm transition dark:bg-gray-950',
                      form.enabled ? 'translate-x-4' : 'translate-x-0'
                    ]"
                  ></span>
                </button>
              </div>

              <div
                class="flex items-start justify-between gap-6 rounded-xl px-4 py-4"
              >
                <div>
                  <p class="text-sm font-medium text-gray-950 dark:text-white">
                    Accept new feedback
                  </p>
                  <p
                    class="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400"
                  >
                    Pause submissions without hiding anything already shared.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  :aria-checked="form.acceptFeedback"
                  aria-label="Accept new feedback"
                  :class="[
                    'relative mt-0.5 inline-flex h-6 w-10 shrink-0 rounded-full p-0.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-950',
                    form.acceptFeedback
                      ? 'bg-gray-950 dark:bg-white'
                      : 'bg-gray-300 dark:bg-gray-700'
                  ]"
                  @click="toggle('acceptFeedback')"
                >
                  <span
                    :class="[
                      'h-5 w-5 rounded-full bg-white shadow-sm transition dark:bg-gray-950',
                      form.acceptFeedback ? 'translate-x-4' : 'translate-x-0'
                    ]"
                  ></span>
                </button>
              </div>
            </div>
          </section>

          <fieldset>
            <legend class="text-sm font-semibold text-gray-950 dark:text-white">
              Participation
            </legend>
            <p class="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
              Choose who can submit and vote. Public pages remain readable by
              everyone.
            </p>

            <div class="mt-5 grid gap-3 sm:grid-cols-2">
              <label
                :class="[
                  'relative cursor-pointer rounded-xl p-4 transition focus-within:ring-2 focus-within:ring-gray-400 focus-within:ring-offset-2 dark:focus-within:ring-offset-gray-950',
                  !form.allowAnonymousParticipation
                    ? 'bg-gray-950 text-white shadow-sm dark:bg-white dark:text-gray-950'
                    : 'bg-gray-50 text-gray-950 hover:bg-gray-100 dark:bg-gray-900 dark:text-white dark:hover:bg-gray-800'
                ]"
              >
                <Radio
                  v-model="form.allowAnonymousParticipation"
                  class="sr-only"
                  name="bearing-participation"
                  :value="false"
                />
                <span class="flex items-center justify-between gap-3">
                  <span class="text-sm font-medium">Logged-in users only</span>
                  <span
                    :class="[
                      'rounded-full px-2 py-0.5 text-[11px] font-medium',
                      !form.allowAnonymousParticipation
                        ? 'bg-white/15 text-white dark:bg-gray-950/10 dark:text-gray-700'
                        : 'bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                    ]"
                  >
                    Recommended
                  </span>
                </span>
                <span
                  :class="[
                    'mt-2 block text-sm leading-6',
                    !form.allowAnonymousParticipation
                      ? 'text-gray-300 dark:text-gray-600'
                      : 'text-gray-500 dark:text-gray-400'
                  ]"
                >
                  Use {{ app.name }}'s existing account. Every submission and
                  vote has a person behind it.
                </span>
              </label>

              <label
                :class="[
                  'relative cursor-pointer rounded-xl p-4 transition focus-within:ring-2 focus-within:ring-gray-400 focus-within:ring-offset-2 dark:focus-within:ring-offset-gray-950',
                  form.allowAnonymousParticipation
                    ? 'bg-gray-950 text-white shadow-sm dark:bg-white dark:text-gray-950'
                    : 'bg-gray-50 text-gray-950 hover:bg-gray-100 dark:bg-gray-900 dark:text-white dark:hover:bg-gray-800'
                ]"
              >
                <Radio
                  v-model="form.allowAnonymousParticipation"
                  class="sr-only"
                  name="bearing-participation"
                  :value="true"
                />
                <span class="block text-sm font-medium">Anyone</span>
                <span
                  :class="[
                    'mt-2 block text-sm leading-6',
                    form.allowAnonymousParticipation
                      ? 'text-gray-300 dark:text-gray-600'
                      : 'text-gray-500 dark:text-gray-400'
                  ]"
                >
                  Anyone can participate. Activity from signed-in users stays
                  attached to their account; everyone else appears as Anonymous.
                </span>
              </label>
            </div>
          </fieldset>

          <section aria-labelledby="bearing-categories-heading">
            <div class="flex items-start justify-between gap-5">
              <div>
                <h2
                  id="bearing-categories-heading"
                  class="text-sm font-semibold text-gray-950 dark:text-white"
                >
                  Feedback categories
                </h2>
                <p
                  class="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400"
                >
                  Start with Feature and Bug, then shape the language around
                  {{ app.name }}.
                </p>
              </div>
              <button
                type="button"
                :disabled="form.feedbackCategories.length >= 6"
                class="min-h-10 disabled:opacity-35 shrink-0 rounded-lg px-3 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed dark:text-gray-300 dark:hover:bg-gray-800"
                @click="addCategory"
              >
                Add category
              </button>
            </div>

            <div class="mt-5 space-y-2">
              <div
                v-for="(category, index) in form.feedbackCategories"
                :key="category.key"
                class="flex items-center gap-3 rounded-xl bg-gray-50 px-4 py-3 dark:bg-gray-900"
              >
                <span
                  class="h-2 w-2 shrink-0 rounded-full"
                  :class="
                    category.active
                      ? 'bg-gray-950 dark:bg-white'
                      : 'bg-gray-300 dark:bg-gray-700'
                  "
                  aria-hidden="true"
                ></span>
                <label class="min-w-0 flex-1">
                  <span class="sr-only">Category name</span>
                  <Input
                    v-model="category.label"
                    type="text"
                    maxlength="24"
                    class="min-h-10 w-full border-0 border-b border-dashed border-gray-300 bg-transparent px-0 text-sm font-medium focus:border-gray-950 focus:ring-0 dark:border-gray-700 dark:focus:border-white"
                  />
                </label>
                <div class="flex items-center gap-1">
                  <button
                    type="button"
                    :disabled="index === 0"
                    class="flex h-10 w-10 items-center justify-center rounded-lg text-gray-400 hover:bg-white hover:text-gray-700 disabled:opacity-25 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                    :aria-label="`Move ${category.label} up`"
                    @click="moveCategory(index, -1)"
                  >
                    <span aria-hidden="true">↑</span>
                  </button>
                  <button
                    type="button"
                    :disabled="index === form.feedbackCategories.length - 1"
                    class="flex h-10 w-10 items-center justify-center rounded-lg text-gray-400 hover:bg-white hover:text-gray-700 disabled:opacity-25 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                    :aria-label="`Move ${category.label} down`"
                    @click="moveCategory(index, 1)"
                  >
                    <span aria-hidden="true">↓</span>
                  </button>
                  <button
                    type="button"
                    class="min-h-10 rounded-lg px-2 text-xs font-medium text-gray-500 hover:bg-white hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
                    @click="toggleCategory(category)"
                  >
                    {{ category.active ? 'Archive' : 'Restore' }}
                  </button>
                </div>
              </div>
            </div>
            <p class="mt-3 text-xs leading-5 text-gray-400">
              Archived categories stay on existing feedback but disappear from
              the submission form.
            </p>
          </section>

          <section aria-labelledby="bearing-pages-heading">
            <div>
              <h2
                id="bearing-pages-heading"
                class="text-sm font-semibold text-gray-950 dark:text-white"
              >
                Public pages
              </h2>
              <p
                class="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400"
              >
                Customers see familiar labels on your domain, not the Bearing
                product name.
              </p>
            </div>

            <div class="mt-5 space-y-4">
              <div class="px-4">
                <p class="text-sm font-medium text-gray-950 dark:text-white">
                  Feedback
                </p>
                <a
                  v-if="publicUrls"
                  :href="publicUrls.feedback"
                  target="_blank"
                  rel="noreferrer"
                  class="mt-1 block text-xs text-gray-500 hover:text-gray-950 dark:text-gray-400 dark:hover:text-white"
                >
                  {{ publicUrls.feedback }}
                </a>
              </div>

              <div class="flex items-start justify-between gap-6 px-4">
                <div>
                  <p class="text-sm font-medium text-gray-950 dark:text-white">
                    Roadmap
                  </p>
                  <code
                    v-if="publicUrls"
                    class="mt-1 block text-xs text-gray-500 dark:text-gray-400"
                    >{{ publicUrls.roadmap }}</code
                  >
                </div>
                <button
                  type="button"
                  role="switch"
                  :aria-checked="form.showPublicRoadmap"
                  aria-label="Show public roadmap"
                  :class="[
                    'relative inline-flex h-6 w-10 shrink-0 rounded-full p-0.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-950',
                    form.showPublicRoadmap
                      ? 'bg-gray-950 dark:bg-white'
                      : 'bg-gray-300 dark:bg-gray-700'
                  ]"
                  @click="toggle('showPublicRoadmap')"
                >
                  <span
                    :class="[
                      'h-5 w-5 rounded-full bg-white shadow-sm transition dark:bg-gray-950',
                      form.showPublicRoadmap ? 'translate-x-4' : 'translate-x-0'
                    ]"
                  ></span>
                </button>
              </div>

              <div class="flex items-start justify-between gap-6 px-4">
                <div>
                  <p class="text-sm font-medium text-gray-950 dark:text-white">
                    Updates
                  </p>
                  <code
                    v-if="publicUrls"
                    class="mt-1 block text-xs text-gray-500 dark:text-gray-400"
                    >{{ publicUrls.updates }}</code
                  >
                </div>
                <button
                  type="button"
                  role="switch"
                  :aria-checked="form.showPublicUpdates"
                  aria-label="Show public updates"
                  :class="[
                    'relative inline-flex h-6 w-10 shrink-0 rounded-full p-0.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-950',
                    form.showPublicUpdates
                      ? 'bg-gray-950 dark:bg-white'
                      : 'bg-gray-300 dark:bg-gray-700'
                  ]"
                  @click="toggle('showPublicUpdates')"
                >
                  <span
                    :class="[
                      'h-5 w-5 rounded-full bg-white shadow-sm transition dark:bg-gray-950',
                      form.showPublicUpdates ? 'translate-x-4' : 'translate-x-0'
                    ]"
                  ></span>
                </button>
              </div>
            </div>
          </section>

          <section aria-labelledby="bearing-widget-heading">
            <div>
              <h2
                id="bearing-widget-heading"
                class="text-sm font-semibold text-gray-950 dark:text-white"
              >
                In-app widget
              </h2>
              <p
                class="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400"
              >
                A lazy in-app panel for feedback, roadmap, and updates. It stays
                out of the way until your app opens it or something new ships.
              </p>
            </div>

            <div
              class="mt-5 flex items-start justify-between gap-6 rounded-xl bg-gray-50 px-4 py-4 dark:bg-gray-900"
            >
              <div>
                <p class="text-sm font-medium text-gray-950 dark:text-white">
                  Show the widget
                </p>
                <p
                  class="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400"
                >
                  Host-app buttons can open it directly. Unseen updates add a
                  quiet lower-corner trigger until they are opened.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                :aria-checked="form.widgetEnabled"
                aria-label="Show the Bearing widget"
                :class="[
                  'relative mt-0.5 inline-flex h-6 w-10 shrink-0 rounded-full p-0.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-950',
                  form.widgetEnabled
                    ? 'bg-gray-950 dark:bg-white'
                    : 'bg-gray-300 dark:bg-gray-700'
                ]"
                @click="toggle('widgetEnabled')"
              >
                <span
                  :class="[
                    'h-5 w-5 rounded-full bg-white shadow-sm transition dark:bg-gray-950',
                    form.widgetEnabled ? 'translate-x-4' : 'translate-x-0'
                  ]"
                ></span>
              </button>
            </div>
          </section>

          <div class="flex items-center gap-3 pb-4">
            <button
              type="submit"
              :disabled="!form.isDirty || form.processing"
              class="min-h-10 disabled:opacity-35 inline-flex items-center justify-center rounded-lg bg-gray-950 px-4 text-sm font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed dark:bg-white dark:text-gray-950 dark:hover:bg-gray-100"
            >
              {{ form.processing ? 'Saving…' : 'Save changes' }}
            </button>
            <p
              v-if="form.recentlySuccessful"
              class="text-sm text-emerald-600 dark:text-emerald-400"
              role="status"
            >
              Saved.
            </p>
          </div>
        </form>
      </Tabs>
    </main>
  </div>
</template>
