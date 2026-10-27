<script setup>
import { computed, ref } from 'vue'
import AppAppearance from './AppAppearance.vue'
import AppBrand from './AppBrand.vue'
import Feedback from '@/pages/bearing/feedback.vue'
import Surface from '@/pages/bearing/surface.vue'
const props = defineProps({
  appearance: Object,
  fallbackName: String,
  mode: String,
  surface: String,
  widget: Boolean,
  mobile: Boolean
})
const target = ref(null)
function loaded(event) {
  const doc = event.target.contentDocument
  for (const link of document.querySelectorAll('link[rel="stylesheet"],style'))
    doc.head.append(link.cloneNode(true))
  target.value = doc.body
}
const appearance = computed(() => ({
  ...props.appearance,
  displayName:
    props.appearance?.displayName?.trim() || props.fallbackName || 'App',
  configured: true,
  preview: true,
  mode: props.mode,
  resolvedMode: props.mode
}))
const app = computed(() => ({
  name: appearance.value.displayName,
  homeUrl: '#',
  feedbackPath: '#feedback',
  roadmapPath: '#roadmap',
  updatesPath: '#updates',
  identityPath: '#',
  publicUrl: '',
  ogImageUrl: ''
}))
const bearing = {
  acceptFeedback: true,
  allowAnonymousParticipation: true,
  showPublicRoadmap: true,
  showPublicUpdates: true,
  categories: [
    { key: 'feature', label: 'Feature', active: true },
    { key: 'bug', label: 'Bug', active: true }
  ]
}
const feedback = [
  {
    publicId: 'preview-feedback',
    title: 'A little less busywork',
    details: 'Bring the things we use every day a little closer together.',
    category: 'feature',
    status: 'planned',
    voteCount: 24,
    images: [],
    authorName: 'A customer',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    viewerHasVoted: false
  }
]
const updates = [
  {
    publicId: 'preview-update',
    title: 'Good things, made simpler',
    excerpt: 'A faster way to get from your first idea to your next big thing.',
    slug: 'good-things',
    publishedAt: Date.now(),
    authorName: 'The team'
  }
]
</script>
<template>
  <iframe
    title="Draft appearance preview"
    srcdoc="<!doctype html><html><head><meta name='viewport' content='width=device-width, initial-scale=1'></head><body style='margin:0'></body></html>"
    class="mx-auto block h-[620px] w-full bg-white transition-[max-width]"
    :class="mobile || widget ? 'max-w-[390px]' : 'max-w-none'"
    @load="loaded"
  />
  <Teleport v-if="target" :to="target">
    <AppAppearance
      :appearance="appearance"
      :preview-mode="mode"
      :data-app-appearance="widget ? '1' : undefined"
    >
      <div
        inert
        aria-label="Example content"
        :class="widget ? 'appearance-widget-preview' : ''"
      >
        <header
          v-if="widget"
          class="bearing-panel-header flex h-14 items-center justify-between border-b px-4 text-sm font-semibold"
        >
          <AppBrand :appearance="appearance" /><span aria-hidden="true">×</span>
        </header>
        <Feedback
          v-if="surface === 'feedback'"
          :key="`feedback-${widget}`"
          :app="app"
          :appearance="appearance"
          :bearing="bearing"
          :participant="null"
          :viewer="{ canVote: true }"
          :embedded="widget"
          :realtime="null"
          :filters="{ q: '', category: 'all', status: 'active', sort: 'top' }"
          :feedback="{ data: feedback }"
          preview
          :feedback-loaded-at="Date.now()"
        />
        <Surface
          v-else
          preview
          :key="`${surface}-${widget}`"
          :app="app"
          :appearance="appearance"
          :bearing="bearing"
          :embedded="widget"
          :surface="surface"
          :items="surface === 'updates' ? updates : feedback"
          :realtime="null"
        />
        <nav
          v-if="widget"
          class="bearing-panel-nav sticky bottom-0"
          aria-label="Example navigation"
        >
          <button
            v-for="name in ['feedback', 'roadmap', 'updates']"
            :key="name"
            :aria-current="surface === name ? 'page' : undefined"
          >
            {{ name[0].toUpperCase() + name.slice(1) }}
          </button>
        </nav>
      </div>
    </AppAppearance>
  </Teleport>
</template>
