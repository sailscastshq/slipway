<script setup>
import AppAppearance from './AppAppearance.vue'
import BridgeWorkspaceSidebar from '@/components/bridge/BridgeWorkspaceSidebar.vue'
import BridgeDashboard from '@/components/bridge/BridgeDashboard.vue'
defineProps({ appearance: Object, mode: String })
const resources = {
  submission: {
    identity: 'submission',
    slug: 'submissions',
    primaryKey: 'id',
    title: 'title',
    attributes: {}
  }
}
const workspace = {
  resources: [
    {
      identity: 'submission',
      slug: 'submissions',
      label: 'Submissions',
      singularLabel: 'Submission',
      icon: 'database'
    }
  ],
  dashboards: [],
  actor: { fullName: 'Preview editor', role: 'editor' }
}
const dashboard = {
  label: 'Overview',
  description: 'An example of your app workspace.',
  cards: [
    { id: 'total', type: 'metric', label: 'Submissions', value: 42 },
    {
      id: 'accepted',
      type: 'partition',
      label: 'Submission status',
      segments: [
        { label: 'Accepted', value: 30 },
        { label: 'Pending', value: 12 }
      ]
    }
  ]
}
</script>
<template>
  <AppAppearance :appearance="appearance" :preview-mode="mode">
    <div
      inert
      aria-label="Bridge example workspace"
      class="flex h-[620px] bg-white text-gray-900 dark:bg-gray-950 dark:text-white"
    >
      <BridgeWorkspaceSidebar
        :appearance="appearance"
        :app="{ name: appearance.displayName }"
        :workspace="workspace"
        base-path="/bridge"
        class="hidden w-48 shrink-0 sm:flex"
      />
      <main class="min-w-0 flex-1 p-6 sm:p-8">
        <p class="mb-8 text-xs text-gray-500">
          {{ appearance.displayName }} / Bridge
        </p>
        <BridgeDashboard
          :dashboard="dashboard"
          :resources="resources"
          bridge-base-path="/bridge"
        />
      </main>
    </div>
  </AppAppearance>
</template>
