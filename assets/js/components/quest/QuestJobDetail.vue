<script setup>
import { computed, defineAsyncComponent } from 'vue'
import Tabs from '@/components/ui/tabs/Tabs.vue'
import Button from '@/components/ui/button/Button.vue'
import Tooltip from '@/components/ui/tooltip/Tooltip.vue'
import ChevronLeft from '@/components/ui/icons/ChevronLeft.vue'
import X from '@/components/ui/icons/X.vue'
import Play from '@/components/ui/icons/Play.vue'
import Pause from '@/components/ui/icons/Pause.vue'
import Spinner from '@/components/SlipwaySpinner.vue'
import QuestStatus from './QuestStatus.vue'
import QuestRuns from './QuestRuns.vue'
import {
  questInputMetadataAvailable,
  questInputType,
  questOverlapLabel,
  questDueTimes
} from '@/lib/questWorkspace.mjs'

const QuestRunDetail = defineAsyncComponent(() =>
  import('./QuestRunDetail.vue')
)
const props = defineProps({
  selectedJob: Object,
  selectedRunJob: Object,
  jobs: Array,
  live: Object,
  activeTab: String,
  fresh: Boolean,
  jobState: String,
  disabledReason: String,
  canRun: Boolean,
  canRunSelected: Boolean,
  canPause: Boolean,
  changingSchedule: String,
  selectedRunId: String,
  selectedEventId: String,
  detailRevision: String,
  apiUrl: String,
  jobRuns: Array,
  jobEvents: Array,
  scopedJobHistory: Object,
  now: Number
})
const jobTab = defineModel('tab', { type: String, required: true })
const emit = defineEmits([
  'close-job',
  'run',
  'run-loaded',
  'close-run',
  'run-again',
  'select-run',
  'load-history',
  'toggle-pause'
])
const inputMetadataAvailable = computed(() =>
  questInputMetadataAvailable(props.selectedJob, props.live)
)
const selectedScheduleTimes = computed(() =>
  questDueTimes(props.selectedJob?.nextRunAt, props.selectedJob?.timezone)
)
const tabClass = (current, value) => [
  'border-b-2 py-3 text-sm font-medium',
  current === value
    ? 'border-gray-900 text-gray-900 dark:border-white dark:text-white'
    : 'border-transparent text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
]
const displayValue = (value) =>
  value === undefined ? '—' : JSON.stringify(value)
</script>
<template>
  <section
    data-test="quest-job-detail"
    class="min-w-0"
    aria-labelledby="quest-job-title"
  >
    <button
      type="button"
      class="mb-3 flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 lg:hidden"
      @click="emit('close-job')"
    >
      <ChevronLeft class="h-3.5 w-3.5" />All jobs
    </button>
    <div
      class="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950"
    >
      <div class="px-4 pt-4">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h2
              id="quest-job-title"
              class="text-sm font-semibold text-gray-900 dark:text-white"
            >
              {{ selectedJob.friendlyName || selectedJob.name }}
            </h2>
            <p class="mt-1 break-all font-mono text-[10px] text-gray-400">
              {{ selectedJob.script || selectedJob.name }}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close job details"
            class="rounded p-1 text-gray-400 hover:text-gray-900 dark:hover:text-white"
            @click="emit('close-job')"
          >
            <X class="h-4 w-4" />
          </button>
        </div>
        <p
          v-if="selectedJob.description"
          class="mt-3 text-xs leading-5 text-gray-500 dark:text-gray-400"
        >
          {{ selectedJob.description }}
        </p>
        <div class="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-2">
            <QuestStatus :state="jobState" /><span
              v-if="selectedJob.withoutOverlapping"
              title="Prevents concurrent executions in this app process only."
              class="text-[10px] text-gray-400"
              >No overlap</span
            >
          </div>
          <Tooltip :text="disabledReason || 'Run job'"
            ><Button
              data-test="quest-open-run"
              :aria-label="`Run ${
                selectedJob.friendlyName || selectedJob.name
              }`"
              :disabled="!canRun"
              class="min-h-8 px-2.5 py-1 text-xs"
              @click="emit('run')"
              ><Play class="h-3 w-3" />Run job</Button
            ></Tooltip
          >
        </div>
        <p
          v-if="selectedJob.validationErrors?.length"
          role="alert"
          class="mt-3 text-xs text-red-600 dark:text-red-400"
        >
          This job definition is invalid:
          {{
            selectedJob.validationErrors
              .map((error) =>
                typeof error === 'string' ? error : error.message
              )
              .join(' · ')
          }}
        </p>
      </div>
      <Tabs v-model="jobTab" aria-label="Job details">
        <div
          data-slot="tabs-list"
          class="mt-2 flex gap-5 border-b border-gray-200 px-4 dark:border-gray-800"
        >
          <button data-value="runs" :class="tabClass(jobTab, 'runs')">
            Runs</button
          ><button data-value="inputs" :class="tabClass(jobTab, 'inputs')">
            Inputs
            <span
              v-if="inputMetadataAvailable && selectedJob.inputs?.length"
              class="ml-1 text-[10px] text-gray-400"
              >{{ selectedJob.inputs.length }}</span
            ></button
          ><button data-value="schedule" :class="tabClass(jobTab, 'schedule')">
            Schedule
          </button>
        </div>
        <div data-slot="tab-panel" data-value="runs">
          <template v-if="activeTab === 'jobs' && jobTab === 'runs'">
            <QuestRunDetail
              v-if="selectedRunId || selectedEventId"
              embedded
              :api-url="apiUrl"
              :run-id="selectedRunId"
              :event-id="selectedEventId"
              :revision="detailRevision"
              :job="selectedRunJob"
              :can-run="canRunSelected"
              :can-cancel="live.capabilities.cancel"
              @loaded="emit('run-loaded', $event)"
              @close="emit('close-run')"
              @run-again="emit('run-again', $event)"
            />
            <template v-else>
              <QuestRuns
                :runs="jobRuns"
                :legacy-events="jobEvents"
                :jobs="jobs"
                :selected-run="selectedRunId"
                :selected-event="selectedEventId"
                :now="now"
                :empty-text="
                  scopedJobHistory.loading
                    ? 'Loading history…'
                    : scopedJobHistory.error
                    ? 'History unavailable.'
                    : scopedJobHistory.nextCursor
                    ? 'No runs for this job in loaded history.'
                    : 'No runs recorded yet.'
                "
                @select="emit('select-run', $event)"
              />
              <p
                class="border-t border-gray-100 px-4 py-2 text-[10px] text-gray-400 dark:border-gray-800"
              >
                {{ live.historyScope
                }}{{
                  jobEvents.length
                    ? ' · Legacy telemetry may be incomplete'
                    : ''
                }}{{
                  scopedJobHistory.nextCursor ? ' · Showing loaded history' : ''
                }}
              </p>
              <div
                v-if="scopedJobHistory.nextCursor || scopedJobHistory.error"
                class="border-t border-gray-100 px-4 py-3 dark:border-gray-800"
              >
                <Button
                  v-if="scopedJobHistory.nextCursor"
                  :disabled="scopedJobHistory.loading"
                  class="min-h-8 border border-gray-200 bg-transparent px-3 py-1 text-xs text-gray-600 hover:bg-gray-100 dark:border-gray-800 dark:bg-transparent dark:text-gray-400 dark:hover:bg-gray-900"
                  @click="emit('load-history', true)"
                  >{{
                    scopedJobHistory.loading ? 'Loading…' : 'Load more history'
                  }}</Button
                >
                <p
                  v-if="scopedJobHistory.error"
                  role="alert"
                  class="mt-2 text-xs text-red-600 dark:text-red-400"
                >
                  {{ scopedJobHistory.error }}
                  <button
                    type="button"
                    class="ml-1 underline"
                    :disabled="scopedJobHistory.loading"
                    @click="emit('load-history', false)"
                  >
                    Try again
                  </button>
                </p>
              </div>
            </template>
          </template>
        </div>
        <div
          data-slot="tab-panel"
          data-value="inputs"
          class="divide-y divide-gray-100 dark:divide-gray-800"
        >
          <p
            v-if="!inputMetadataAvailable || !selectedJob.inputs?.length"
            class="px-4 py-8 text-sm text-gray-500 dark:text-gray-400"
          >
            {{
              inputMetadataAvailable
                ? 'This job takes no inputs.'
                : 'Input metadata unavailable.'
            }}
          </p>
          <div
            v-for="input in inputMetadataAvailable ? selectedJob.inputs : []"
            :key="input.name"
            class="px-4 py-3"
          >
            <div class="flex flex-wrap items-center gap-2">
              <span
                class="font-mono text-xs text-gray-800 dark:text-gray-200"
                >{{ input.name }}</span
              ><span class="text-[10px] text-gray-400"
                >{{ questInputType(input)
                }}{{ input.required ? ' · required' : ' · optional'
                }}{{ input.sensitive ? ' · sensitive' : '' }}</span
              >
            </div>
            <p
              v-if="input.description"
              class="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400"
            >
              {{ input.description }}
            </p>
            <p
              v-if="
                !input.sensitive &&
                Object.prototype.hasOwnProperty.call(input, 'defaultsTo')
              "
              class="mt-2 break-all font-mono text-[11px] text-gray-500 dark:text-gray-400"
            >
              Default: {{ displayValue(input.defaultsTo) }}
            </p>
            <p
              v-if="!input.sensitive && input.isIn?.length"
              class="mt-1 break-all text-[11px] text-gray-400"
            >
              Allowed:
              {{ input.isIn.map(displayValue).join(', ') }}
            </p>
          </div>
        </div>
        <div data-slot="tab-panel" data-value="schedule" class="p-4">
          <dl
            class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-3 text-xs"
          >
            <dt class="text-gray-400">Schedule</dt>
            <dd class="text-gray-800 dark:text-gray-200">
              {{
                selectedJob.scheduleType === 'unavailable'
                  ? 'Unavailable'
                  : selectedJob.schedule || 'Manual only'
              }}
            </dd>
            <dt v-if="selectedJob.scheduleType" class="text-gray-400">Type</dt>
            <dd v-if="selectedJob.scheduleType" class="capitalize">
              {{ selectedJob.scheduleType }}
            </dd>
            <dt v-if="selectedJob.schedule" class="text-gray-400">Timezone</dt>
            <dd v-if="selectedJob.schedule">
              {{
                selectedScheduleTimes.runtimeZone ||
                (selectedScheduleTimes.timezoneStatus === 'invalid'
                  ? 'Invalid runtime timezone'
                  : 'Not reported by runtime')
              }}
            </dd>
            <dt v-if="selectedJob.schedule" class="text-gray-400">
              {{
                selectedScheduleTimes.runtimeZone
                  ? 'Next run (runtime)'
                  : 'Next run (viewer)'
              }}
            </dt>
            <dd v-if="selectedJob.schedule">
              {{
                !fresh
                  ? 'Unavailable'
                  : selectedJob.paused
                  ? 'Paused'
                  : selectedScheduleTimes.runtime ||
                    selectedScheduleTimes.viewer ||
                    'Not reported'
              }}
            </dd>
            <template
              v-if="
                selectedJob.schedule &&
                selectedScheduleTimes.runtimeZone &&
                selectedScheduleTimes.viewer &&
                fresh &&
                !selectedJob.paused
              "
            >
              <dt class="text-gray-400">Viewer time</dt>
              <dd>{{ selectedScheduleTimes.viewer }}</dd>
            </template>
            <dt class="text-gray-400">Overlap</dt>
            <dd>
              {{ questOverlapLabel(selectedJob) }}
            </dd>
          </dl>
          <p
            v-if="selectedJob.schedule && selectedJob.scheduledInputs == null"
            class="mt-4 text-xs text-gray-500 dark:text-gray-400"
          >
            Scheduled inputs: unavailable from this runtime.
          </p>
          <div
            v-if="
              selectedJob.scheduledInputs &&
              Object.keys(selectedJob.scheduledInputs).length
            "
            class="mt-4"
          >
            <h3 class="text-xs text-gray-400">Scheduled inputs</h3>
            <dl class="mt-2 space-y-1">
              <div
                v-for="(value, name) in selectedJob.scheduledInputs"
                :key="name"
                class="flex gap-2 text-xs"
              >
                <dt class="font-mono text-gray-500">
                  {{ name }}
                </dt>
                <dd class="min-w-0 break-all font-mono">
                  {{
                    selectedJob.inputs?.find((input) => input.name === name)
                      ?.sensitive
                      ? '••••••'
                      : displayValue(value)
                  }}
                </dd>
              </div>
            </dl>
          </div>
          <div
            class="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-3 dark:border-gray-800"
          >
            <p class="text-[11px] text-gray-400">
              Schedule defined in app source.
            </p>
            <Button
              v-if="selectedJob.schedule && selectedJob.schedule !== 'manual'"
              :disabled="!canPause || !!changingSchedule"
              class="min-h-8 border border-gray-200 bg-transparent px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:bg-transparent dark:text-gray-300 dark:hover:bg-gray-800"
              @click="emit('toggle-pause')"
              ><Spinner
                v-if="changingSchedule === selectedJob.name"
                class="h-3 w-3"
              /><Play v-else-if="selectedJob.paused" class="h-3 w-3" /><Pause
                v-else
                class="h-3 w-3"
              />{{
                selectedJob.paused ? 'Resume schedule' : 'Pause schedule'
              }}</Button
            >
          </div>
        </div>
      </Tabs>
    </div>
  </section>
</template>
