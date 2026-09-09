<script setup>
import { computed } from 'vue'
import Alert from '@/components/ui/alert/Alert.vue'
import Button from '@/components/ui/button/Button.vue'
const props = defineProps({ report: Object, allowActions: Boolean })
defineEmits(['refresh', 'action'])
const blocked = computed(() => props.report?.canDeploy === false)
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
    v-if="report && blocked"
    as="section"
    data-test="deployment-checklist"
    role="alert"
    class="mb-8 rounded-lg border border-red-200 bg-red-50 p-4 text-gray-900 dark:border-red-900 dark:bg-red-950/20 dark:text-gray-100"
  >
    <div>
      <h2 class="text-sm font-semibold">
        Deployment readiness<span v-if="report.appName">
          · {{ report.appName }}</span
        >
      </h2>
      <span class="mt-1 block text-sm">
        {{ report.summary.blocker }}
        {{ report.summary.blocker === 1 ? 'blocker' : 'blockers' }}
      </span>
    </div>
    <div class="mt-3">
      <div class="flex items-start justify-between gap-3">
        <p class="min-w-0 text-xs text-gray-500">
          <template v-if="report.sourceRevision"
            >Source {{ report.sourceRevision.slice(0, 12) }}</template
          >
          <template v-else>Local source inspection unavailable</template>
          · Health path <span class="break-all">{{ report.healthPath }}</span>
        </p>
        <Button
          class="min-h-8 min-w-0 shrink-0 bg-transparent px-2 py-1 text-gray-600 hover:bg-gray-100 dark:bg-transparent dark:text-gray-300 dark:hover:bg-gray-800"
          @click="$emit('refresh')"
          >Refresh</Button
        >
      </div>
      <p v-if="!report.sourceRevision" class="mt-2 text-xs text-gray-500">
        These checks could not fully inspect the local source. They do not
        describe the running app's health. Deployment checks use the candidate's
        source snapshot.
      </p>
      <p class="mt-3 text-sm font-medium text-red-700 dark:text-red-300">
        Resolve the required checks before deployment.
      </p>
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
    </div>
  </Alert>
</template>
