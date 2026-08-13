<script setup>
import { Head } from '@inertiajs/vue3'
import { computed, onUnmounted, ref } from 'vue'
import { useBearingRealtime } from '@/composables/useBearingRealtime'

const props = defineProps({
  app: Object,
  bearing: Object,
  realtime: Object,
  surface: String,
  embedded: Boolean,
  items: Array
})

const surfaceItems = ref([...props.items])
const highlightedFeedback = ref(new Set())
const liveAnnouncement = ref('')
const highlightTimers = new Map()

const title = computed(() =>
  props.surface === 'roadmap' ? 'Roadmap' : 'Updates'
)
const eyebrow = computed(() =>
  props.surface === 'roadmap' ? 'Where we are heading' : 'What is new'
)
const description = computed(() =>
  props.surface === 'roadmap'
    ? `A clear look at what ${props.app.name} is considering and building next.`
    : `The useful things that recently changed in ${props.app.name}.`
)

const { state: realtimeState } = useBearingRealtime(props.realtime, {
  onSnapshot: reconcileItems,
  onEvent: receiveFeedbackEvent,
  onUpdate: receiveUpdateEvent
})

onUnmounted(() => {
  for (const timer of highlightTimers.values()) window.clearTimeout(timer)
})

function reconcileItems(feedback, _syncedAt, updates) {
  const nextItems =
    props.surface === 'updates' ? updates : feedback.filter(belongsOnSurface)
  const previous = new Map(
    surfaceItems.value.map((item) => [item.publicId, item])
  )
  surfaceItems.value = nextItems

  for (const item of nextItems) {
    const existing = previous.get(item.publicId)
    if (!existing || feedbackChanged(existing, item)) {
      highlightFeedback(item.publicId)
    }
  }
}

function receiveUpdateEvent(event) {
  if (props.surface !== 'updates' || !event?.update?.publicId) return
  const index = surfaceItems.value.findIndex(
    (item) => item.publicId === event.update.publicId
  )
  surfaceItems.value =
    index === -1
      ? [event.update, ...surfaceItems.value]
      : surfaceItems.value.map((item, itemIndex) =>
          itemIndex === index ? event.update : item
        )
  liveAnnouncement.value =
    index === -1 ? 'New update published.' : 'Update changed.'
  highlightFeedback(event.update.publicId)
}

function receiveFeedbackEvent(event) {
  if (props.surface === 'updates') return
  if (!event?.feedback?.publicId) return
  const publicId = event.feedback.publicId

  if (event.verb === 'removed' || !belongsOnSurface(event.feedback)) {
    surfaceItems.value = surfaceItems.value.filter(
      (item) => item.publicId !== publicId
    )
    return
  }

  const existingIndex = surfaceItems.value.findIndex(
    (item) => item.publicId === publicId
  )
  if (existingIndex === -1) {
    surfaceItems.value = [event.feedback, ...surfaceItems.value]
    liveAnnouncement.value = `New ${title.value.toLowerCase()} item received.`
  } else {
    surfaceItems.value = surfaceItems.value.map((item, index) =>
      index === existingIndex ? event.feedback : item
    )
    liveAnnouncement.value = `${title.value} updated.`
  }
  highlightFeedback(publicId)
}

function belongsOnSurface(item) {
  return ['planned', 'in_progress'].includes(item.status)
}

function highlightFeedback(publicId) {
  window.clearTimeout(highlightTimers.get(publicId))
  highlightedFeedback.value = new Set([...highlightedFeedback.value, publicId])
  highlightTimers.set(
    publicId,
    window.setTimeout(() => {
      const next = new Set(highlightedFeedback.value)
      next.delete(publicId)
      highlightedFeedback.value = next
      highlightTimers.delete(publicId)
    }, 2400)
  )
}

function feedbackChanged(previous, next) {
  return ['title', 'details', 'excerpt', 'body', 'status', 'updatedAt'].some(
    (field) => previous[field] !== next[field]
  )
}

function statusLabel(status) {
  return {
    planned: 'Planned',
    in_progress: 'In progress',
    shipped: 'Shipped',
    published: 'Published'
  }[status]
}

function updateHref(item) {
  return `${props.app.updatesPath}/p/${encodeURIComponent(item.slug)}`
}

function shortDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date(value))
}

function isoDate(value) {
  return new Date(value).toISOString()
}
</script>

<template>
  <Head :title="`${title} · ${app.name}`">
    <meta head-key="description" name="description" :content="description" />
    <meta head-key="og:type" property="og:type" content="website" />
    <meta head-key="og:site_name" property="og:site_name" :content="app.name" />
    <meta
      head-key="og:title"
      property="og:title"
      :content="`${title} · ${app.name}`"
    />
    <meta
      head-key="og:description"
      property="og:description"
      :content="description"
    />
    <meta head-key="og:url" property="og:url" :content="app.publicUrl" />
    <meta head-key="og:image" property="og:image" :content="app.ogImageUrl" />
    <meta head-key="og:image:width" property="og:image:width" content="1200" />
    <meta head-key="og:image:height" property="og:image:height" content="630" />
    <meta
      head-key="twitter:card"
      name="twitter:card"
      content="summary_large_image"
    />
    <meta
      head-key="twitter:title"
      name="twitter:title"
      :content="`${title} · ${app.name}`"
    />
    <meta
      head-key="twitter:description"
      name="twitter:description"
      :content="description"
    />
    <meta head-key="twitter:url" name="twitter:url" :content="app.publicUrl" />
    <meta
      head-key="twitter:image"
      name="twitter:image"
      :content="app.ogImageUrl"
    />
    <link head-key="canonical" rel="canonical" :href="app.publicUrl" />
  </Head>
  <div
    class="min-h-screen bg-white text-gray-950 dark:bg-gray-950 dark:text-white"
    :data-bearing-realtime="realtimeState"
  >
    <header v-if="!embedded" class="px-5 sm:px-8">
      <nav
        class="mx-auto flex h-16 max-w-5xl items-center justify-between"
        aria-label="Bearing"
      >
        <a :href="app.homeUrl" class="text-sm font-semibold tracking-tight">{{
          app.name
        }}</a>
        <div class="flex items-center gap-5 text-sm">
          <a
            :href="app.feedbackPath"
            class="text-gray-500 transition hover:text-gray-950 dark:text-gray-400 dark:hover:text-white"
            >Feedback</a
          >
          <a
            v-if="bearing.showPublicRoadmap"
            :href="app.roadmapPath"
            :class="
              surface === 'roadmap'
                ? 'font-medium text-gray-950 dark:text-white'
                : 'text-gray-500 dark:text-gray-400'
            "
            >Roadmap</a
          >
          <a
            v-if="bearing.showPublicUpdates"
            :href="app.updatesPath"
            :class="
              surface === 'updates'
                ? 'font-medium text-gray-950 dark:text-white'
                : 'text-gray-500 dark:text-gray-400'
            "
            >Updates</a
          >
        </div>
      </nav>
    </header>

    <main
      :class="
        embedded
          ? 'px-5 pb-10 pt-8 sm:px-6 sm:pt-10'
          : 'px-5 pb-20 pt-14 sm:px-8 sm:pt-20'
      "
    >
      <div class="mx-auto max-w-3xl">
        <p
          class="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400"
        >
          {{ eyebrow }}
        </p>
        <h1 class="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
          {{ title }}
        </h1>
        <p
          class="mt-3 max-w-2xl text-base leading-7 text-gray-500 dark:text-gray-400"
        >
          {{ description }}
        </p>

        <p class="sr-only" aria-live="polite" aria-atomic="true">
          {{ liveAnnouncement }}
        </p>

        <TransitionGroup
          v-if="surfaceItems.length"
          name="bearing-feedback-list"
          tag="div"
          class="mt-12 space-y-3"
        >
          <div v-for="item in surfaceItems" :key="item.publicId">
            <article
              class="bearing-feedback-card rounded-2xl bg-gray-50 p-6 dark:bg-gray-900"
              :data-live-highlight="
                highlightedFeedback.has(item.publicId) ? 'true' : undefined
              "
            >
              <template v-if="surface === 'updates'">
                <time
                  :datetime="isoDate(item.publishedAt)"
                  class="text-xs text-gray-400"
                >
                  {{ shortDate(item.publishedAt) }}
                </time>
                <h2 class="mt-2 text-lg font-semibold tracking-tight">
                  <a
                    :href="updateHref(item)"
                    class="transition hover:text-gray-600 dark:hover:text-gray-300"
                  >
                    {{ item.title }}
                  </a>
                </h2>
                <p
                  class="mt-2 text-sm leading-6 text-gray-500 dark:text-gray-400"
                >
                  {{ item.excerpt }}
                </p>
                <p class="mt-4 text-xs text-gray-400">
                  {{ item.authorName }} · Read update
                </p>
              </template>
              <template v-else>
                <div class="flex flex-wrap items-center gap-2.5">
                  <h2 class="text-base font-semibold">{{ item.title }}</h2>
                  <span
                    class="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-gray-600 shadow-sm dark:bg-gray-800 dark:text-gray-300"
                  >
                    {{ statusLabel(item.status) }}
                  </span>
                </div>
                <p
                  v-if="item.details"
                  class="mt-2 text-sm leading-6 text-gray-500 dark:text-gray-400"
                >
                  {{ item.details }}
                </p>
              </template>
            </article>
          </div>
        </TransitionGroup>
        <div
          v-else
          class="mt-12 rounded-2xl bg-gray-50 px-6 py-14 text-center dark:bg-gray-900"
        >
          <p class="text-sm font-medium">Nothing to announce yet.</p>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            When there is something worth saying, it will be here.
          </p>
        </div>

        <footer
          v-if="!embedded"
          class="mt-16 text-center text-xs text-gray-400"
        >
          <a
            href="https://docs.sailscasts.com/slipway"
            target="_blank"
            rel="noreferrer"
            class="transition hover:text-gray-600 dark:hover:text-gray-300"
          >
            Powered by Slipway
          </a>
        </footer>
      </div>
    </main>
  </div>
</template>
