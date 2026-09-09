<script setup>
import { computed } from 'vue'
import Alert from '@/components/ui/alert/Alert.vue'
import Button from '@/components/ui/button/Button.vue'
const props = defineProps({ report: Object, allowActions: Boolean })
defineEmits(['refresh', 'action'])
const groups = computed(() => [
  {
    title: 'Required before deployment',
    items: (props.report?.items || []).filter(
      (item) => item.status === 'blocker'
    )
  },
  {
    title: 'Recommended checks',
    items: (props.report?.items || []).filter(
      (item) => item.status === 'warning'
    )
  },
  {
    title: 'Verified configuration and optional capabilities',
    items: (props.report?.items || []).filter((item) =>
      ['pass', 'not-applicable'].includes(item.status)
    )
  }
])
</script>
<template>
  <Alert
    v-if="report"
    data-test="deployment-checklist"
    role="note"
    class="mb-8 rounded-lg border border-gray-200 bg-white p-4 text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
  >
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <h2 class="text-sm font-semibold">
          Deployment readiness<span v-if="report.appName">
            · {{ report.appName }}</span
          >
        </h2>
        <p class="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {{ report.summary.blocker }}
          {{ report.summary.blocker === 1 ? 'blocker' : 'blockers' }} ·
          {{ report.summary.warning }} recommendations
        </p>
      </div>
      <Button
        class="min-h-8 min-w-0 bg-transparent px-2 py-1 text-gray-600 hover:bg-gray-100 dark:bg-transparent dark:text-gray-300 dark:hover:bg-gray-800"
        @click="$emit('refresh')"
        >Refresh</Button
      >
    </div>
    <p class="mt-1 text-xs text-gray-500">
      Source
      {{
        report.sourceRevision
          ? report.sourceRevision.slice(0, 12)
          : 'not yet verified'
      }}
      · Health path <span class="break-all">{{ report.healthPath }}</span>
    </p>
    <p
      v-if="!report.canDeploy"
      class="mt-3 text-sm font-medium text-red-700 dark:text-red-300"
    >
      Resolve the required checks before deployment.
    </p>
    <p v-else class="mt-3 text-sm text-gray-600 dark:text-gray-400">
      Recommendations do not prevent deployment. The candidate must pass its
      HTTP health probe before traffic switches.
    </p>
    <details class="mt-3" :open="!report.canDeploy">
      <summary class="cursor-pointer text-sm font-medium">View checks</summary>
      <section
        v-for="group in groups.filter((group) => group.items.length)"
        :key="group.title"
        class="mt-4"
      >
        <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500">
          {{ group.title }}
        </h3>
        <ul class="mt-2 divide-y divide-gray-100 dark:divide-gray-800">
          <li v-for="item in group.items" :key="item.id" class="py-3">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="text-sm font-medium">
                  {{ item.title }}
                  <span class="font-normal text-gray-500"
                    >·
                    {{
                      item.status === 'not-applicable'
                        ? 'optional / not applicable'
                        : item.status
                    }}</span
                  >
                </p>
                <p class="mt-1 text-sm text-gray-600 dark:text-gray-400">
                  {{ item.evidence }}
                </p>
                <p
                  v-if="item.status !== 'pass'"
                  class="mt-1 text-xs text-gray-500"
                >
                  {{ item.fix }}
                </p>
              </div>
              <Button
                v-if="
                  allowActions &&
                  item.id === 'session-secret' &&
                  item.status === 'warning'
                "
                class="min-h-8 min-w-0 border border-gray-300 bg-transparent px-3 py-1 text-gray-800 hover:bg-gray-100 dark:border-gray-700 dark:bg-transparent dark:text-gray-200 dark:hover:bg-gray-800"
                @click="$emit('action', { type: 'generate-session-secret' })"
                >Generate</Button
              >
            </div>
          </li>
        </ul>
      </section>
      <p class="mt-3 text-xs text-gray-500">
        Redeploy after changing app configuration.
      </p>
    </details>
  </Alert>
</template>
