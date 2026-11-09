<script setup>
import { computed, ref, useId, watch } from 'vue'
import Alert from '@/components/ui/alert/Alert.vue'
import Button from '@/components/ui/button/Button.vue'
import Dialog from '@/components/ui/dialog/Dialog.vue'
import Check from '@/components/ui/icons/Check.vue'
import WarningTriangle from '@/components/ui/icons/WarningTriangle.vue'

const props = defineProps({ report: Object, allowActions: Boolean })
const emit = defineEmits(['refresh', 'action'])
const open = ref(false)
const dialogId = `deployment-checks-${useId()}`
const titleId = `${dialogId}-title`
const blocked = computed(() => props.report?.canDeploy === false)
const blockers = computed(() =>
  (props.report?.items || []).filter((item) => item.status === 'blocker')
)
const groups = computed(() =>
  [
    { title: 'Required before deployment', status: 'blocker' },
    { title: 'Recommendations', status: 'warning' },
    { title: 'Verified checks', status: 'pass' },
    { title: 'Optional capabilities', status: 'not-applicable' }
  ]
    .map((group) => ({
      ...group,
      items: (props.report?.items || []).filter(
        (item) => item.status === group.status
      )
    }))
    .filter((group) => group.items.length)
)

// Refreshing this report keeps the review open. Changing the selected app or
// environment must never leave the previous target's review on screen.
watch(
  () => [props.report?.environmentId, props.report?.appId],
  ([environmentId, appId], [previousEnvironmentId, previousAppId]) => {
    if (environmentId !== previousEnvironmentId || appId !== previousAppId)
      open.value = false
  }
)

function act(action) {
  open.value = false
  emit('action', action)
}
</script>

<template>
  <div v-if="report" class="mb-8">
    <Alert
      v-if="blocked"
      as="section"
      role="alert"
      data-test="deployment-blockers"
      class="mb-3 rounded-lg border-0 bg-red-50 p-4 text-red-900 dark:bg-red-950/30 dark:text-red-200"
    >
      <h2 class="text-sm font-medium">
        {{ report.summary.blocker }}
        {{
          report.summary.blocker === 1
            ? 'deployment blocker'
            : 'deployment blockers'
        }}
      </h2>
      <p class="mt-1 text-sm">Resolve the required checks before deployment.</p>
      <ul class="mt-2 space-y-1 text-sm">
        <li v-for="item in blockers" :key="item.id">{{ item.title }}</li>
      </ul>
    </Alert>
    <div class="flex flex-wrap items-center justify-between gap-3">
      <Button
        data-test="view-deployment-checks"
        :aria-controls="dialogId"
        :aria-expanded="open"
        aria-haspopup="dialog"
        class="min-h-9 min-w-0 bg-transparent px-0 text-gray-600 hover:bg-transparent hover:text-gray-950 dark:bg-transparent dark:text-gray-400 dark:hover:bg-transparent dark:hover:text-white"
        @click="open = true"
        >View deployment checks</Button
      >
      <slot />
    </div>

    <Dialog
      :id="dialogId"
      v-model:open="open"
      :aria-labelledby="titleId"
      data-test="deployment-checklist"
      class="max-h-[85dvh] max-w-2xl border-0 p-0 dark:bg-gray-900"
    >
      <div class="flex max-h-[85dvh] flex-col">
        <div class="px-6 pt-6 sm:px-8 sm:pt-8">
          <h2 :id="titleId" class="text-xl font-semibold">Deployment checks</h2>
          <p class="mt-2 break-words text-sm text-gray-500 dark:text-gray-400">
            {{ report.appName }}
            <template v-if="report.sourceRevision">
              · Source {{ report.sourceRevision.slice(0, 12) }}</template
            >
          </p>
          <p
            class="mt-4 text-sm"
            :class="
              blocked
                ? 'text-red-700 dark:text-red-300'
                : 'text-gray-700 dark:text-gray-300'
            "
          >
            <template v-if="blocked"
              >{{ report.summary.blocker }}
              {{
                report.summary.blocker === 1
                  ? 'required check needs'
                  : 'required checks need'
              }}
              attention.</template
            >
            <template v-else
              >No deployment blockers. {{ report.summary.warning }}
              {{
                report.summary.warning === 1
                  ? 'recommendation'
                  : 'recommendations'
              }}
              to review.</template
            >
          </p>
        </div>

        <div
          class="min-h-0 overflow-y-auto px-6 py-6 sm:px-8"
          data-test="deployment-checks-content"
        >
          <p
            v-if="!report.sourceRevision"
            class="mb-6 text-sm text-gray-500 dark:text-gray-400"
          >
            Local source inspection unavailable. These checks do not describe
            the running app's health. Deployment checks inspect the candidate's
            source snapshot.
          </p>
          <section
            v-for="group in groups"
            :key="group.status"
            class="mb-7 last:mb-0"
          >
            <h3 class="text-sm font-medium text-gray-900 dark:text-white">
              {{ group.title }}
            </h3>
            <ul class="mt-4 space-y-5">
              <li
                v-for="item in group.items"
                :key="item.id"
                class="flex items-start gap-3"
              >
                <Check
                  v-if="item.status === 'pass'"
                  aria-hidden="true"
                  class="size-4 mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400"
                />
                <WarningTriangle
                  v-else-if="item.status === 'blocker'"
                  aria-hidden="true"
                  class="size-4 mt-0.5 shrink-0 text-red-600 dark:text-red-400"
                />
                <span
                  v-else
                  aria-hidden="true"
                  class="size-1.5 mx-[5px] mt-2 shrink-0 rounded-full"
                  :class="
                    item.status === 'warning' ? 'bg-amber-500' : 'bg-gray-400'
                  "
                />
                <div class="min-w-0 flex-1">
                  <p
                    class="text-sm font-medium text-gray-900 dark:text-gray-100"
                  >
                    {{ item.title }}
                  </p>
                  <p
                    class="mt-1 break-words text-sm leading-5 text-gray-500 dark:text-gray-400"
                  >
                    {{ item.evidence }}
                  </p>
                  <p
                    v-if="['blocker', 'warning'].includes(item.status)"
                    class="mt-1 break-words text-sm leading-5 text-gray-600 dark:text-gray-300"
                  >
                    {{ item.fix }}
                  </p>
                  <Button
                    v-if="
                      allowActions &&
                      item.id === 'session-secret' &&
                      item.status === 'warning'
                    "
                    class="min-h-9 mt-2 min-w-0 bg-gray-100 px-3 text-gray-900 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                    @click="act({ type: 'generate-session-secret' })"
                    >Generate secret</Button
                  >
                </div>
              </li>
            </ul>
          </section>
          <p class="mt-7 text-xs leading-5 text-gray-500 dark:text-gray-400">
            The candidate must pass its
            <span class="break-all">{{ report.healthPath }}</span> HTTP probe
            before traffic switches. Redeploy after changing app configuration.
          </p>
        </div>
        <div class="flex shrink-0 justify-end gap-2 px-6 pb-6 sm:px-8">
          <Button
            class="min-h-9 min-w-0 bg-transparent px-3 text-gray-600 hover:bg-gray-100 dark:bg-transparent dark:text-gray-300 dark:hover:bg-gray-800"
            @click="$emit('refresh')"
            >Refresh checks</Button
          >
          <Button autofocus class="min-h-9 min-w-0 px-4" @click="open = false"
            >Done</Button
          >
        </div>
      </div>
    </Dialog>
  </div>
</template>
