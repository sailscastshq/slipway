<script setup>
import { computed } from 'vue'
import AppAppearance from './AppAppearance.vue'
import Feedback from '@/pages/bearing/feedback.vue'
import Surface from '@/pages/bearing/surface.vue'
const props = defineProps({
  appearance: Object,
  mode: String,
  surface: String,
  widget: Boolean
})
const appearance = computed(() => props.appearance)
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
  <AppAppearance :appearance="appearance" :preview-mode="mode">
    <div inert aria-label="Example content">
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
    </div>
  </AppAppearance>
</template>
