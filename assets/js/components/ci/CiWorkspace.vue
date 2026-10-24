<script setup>
import { computed, ref } from 'vue'
import { usePage, Link } from '@inertiajs/vue3'
import Dialog from '@/components/ui/dialog/Dialog.vue'
import { useToast } from '@/composables/toast'
import { useQueryState } from '@/components/ui/durable-ui/useQueryState'
import BareSelect from '@/components/BareSelect.vue'
import Tabs from '@/components/ui/tabs/Tabs.vue'
import Button from '@/components/ui/button/Button.vue'
import Badge from '@/components/ui/badge/Badge.vue'
import Check from '@/components/ui/icons/Check.vue'
import Clock from '@/components/ui/icons/Clock.vue'
import X from '@/components/ui/icons/X.vue'
import Refresh from '@/components/ui/icons/Refresh.vue'

const props = defineProps({
  workspace: { type: Object, required: true },
  canManage: Boolean,
  target: { type: Object, default: () => ({}) },
  apiUrl: { type: String, default: '' }
})
const emit = defineEmits(['refresh'])
const toast = useToast(),
  page = usePage(),
  confirmation = ref(null),
  busy = ref(false)
const targetFlags = computed(
  () =>
    `--project ${props.target.project || '<project>'} --env ${
      props.target.env || 'production'
    } --app ${props.target.app || '<app>'}`
)
const targetKey = computed(
  () => `${props.target.project}/${props.target.env}/${props.target.app}`
)
const policy = computed(() => props.workspace.policy)
const verified = computed(() =>
  props.workspace.verifications?.find(
    (item) => item.runId === selected.value?.id
  )
)
const commands = computed(() => ({
  setup: `slipway ci:setup ${targetFlags.value} --commit <full-sha> --branch main --image node@sha256:<runtime-digest> --platform <linux/amd64-or-linux/arm64> --approve-policy --approve-target ${targetKey.value}`,
  register: `slipway ci:register ${targetFlags.value} --trust-device --approve-target ${targetKey.value}`,
  run: `slipway ci ${targetFlags.value} --local`,
  submit: `slipway ci:submit ${targetFlags.value} --report <report.json>`
}))
async function copy(value) {
  try {
    await navigator.clipboard.writeText(value)
    toast({ message: 'Command copied.' })
  } catch {
    toast({
      message: 'Could not copy. Select the command and copy it.',
      type: 'error'
    })
  }
}
async function confirmAction() {
  busy.value = true
  try {
    const choice = confirmation.value
    const response = await fetch(
      props.apiUrl + (choice.runner ? '/revoke-runner' : '/policy'),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': page.props._csrf || ''
        },
        body: JSON.stringify(
          choice.runner
            ? { runnerId: choice.runner.runnerId }
            : {
                enabled: false,
                approvePolicy: true,
                policyRevision: policy.value.revision
              }
        )
      }
    )
    const body = await response.json()
    if (!response.ok)
      throw new Error(body.message || 'CI could not save that change.')
    confirmation.value = null
    toast({
      message: choice.runner ? 'Local runner revoked.' : 'CI policy disabled.'
    })
    emit('refresh')
  } catch (error) {
    toast({ message: error.message, type: 'error' })
  } finally {
    busy.value = false
  }
}

const tab = useQueryState('view', 'runs', {
    validate: (value) => ['runs', 'configuration'].includes(value)
  }),
  filter = useQueryState('state', 'all', {
    validate: (value) => filters.some((option) => option.value === value)
  }),
  selectedId = useQueryState('run', '')
const filters = [
  { value: 'all', label: 'All states' },
  ...[
    'queued',
    'preparing',
    'running',
    'passed',
    'failed',
    'cancelled',
    'timed-out',
    'interrupted'
  ].map((value) => ({ value, label: label(value) }))
]
const runs = computed(() =>
  (props.workspace.runs || []).filter(
    (run) => filter.value === 'all' || run.state === filter.value
  )
)
const selected = computed(
  () => runs.value.find((run) => run.id === selectedId.value) || runs.value[0]
)
function label(state) {
  return (
    { 'timed-out': 'Timed out' }[state] ||
    state?.replace(/^./, (c) => c.toUpperCase()) ||
    'Unknown'
  )
}
function tone(state) {
  if (state === 'passed')
    return 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-400'
  if (state === 'failed')
    return 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400'
  if (['queued', 'preparing', 'running'].includes(state))
    return 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400'
  if (state === 'interrupted' || state === 'timed-out')
    return 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400'
  return ''
}
function duration(seconds) {
  if (!Number.isFinite(seconds)) return '—'
  const total = Math.round(seconds)
  return total >= 60 ? `${Math.floor(total / 60)}m ${total % 60}s` : `${total}s`
}

const action =
  'min-h-8 min-w-0 bg-gray-100 px-3 py-1 text-xs text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'
const tabClass = (value) => [
  'border-b-2 px-1 pb-3 text-sm font-medium',
  tab.value === value
    ? 'border-gray-900 text-gray-900 dark:border-white dark:text-white'
    : 'border-transparent text-gray-500 dark:text-gray-400'
]
</script>

<template>
  <div
    data-test="ci-workspace"
    class="mx-auto w-full max-w-7xl px-4 py-6 sm:px-8 sm:py-8"
  >
    <div class="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1
          class="text-2xl font-semibold tracking-tight text-gray-900 dark:text-white"
        >
          Slipway CI
        </h1>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Checks and builds before deployment.
        </p>
      </div>
      <Button :class="action" @click="tab = 'configuration'"
        >Review checks</Button
      >
    </div>
    <Tabs v-model="tab" aria-label="CI workspace">
      <div
        data-slot="tabs-list"
        class="flex gap-6 border-b border-gray-200 dark:border-gray-800"
      >
        <button data-value="runs" :class="tabClass('runs')">Runs</button>
        <button data-value="configuration" :class="tabClass('configuration')">
          Configuration
        </button>
      </div>
      <div data-slot="tab-panel" data-value="runs" class="pt-5">
        <div class="mb-5 flex items-center justify-between gap-3">
          <BareSelect
            v-model="filter"
            aria-label="Filter CI runs by state"
            :options="filters"
            class="min-h-9 min-w-36 px-1 py-1.5 text-sm"
          />
          <Button
            :class="action"
            aria-label="Refresh CI runs"
            @click="emit('refresh')"
            ><Refresh class="size-3.5" />Refresh</Button
          >
        </div>
        <div v-if="!runs.length" class="py-16 text-center">
          <Clock class="size-6 mx-auto mb-3 text-gray-400" />
          <h2 class="text-sm font-medium text-gray-900 dark:text-white">
            {{
              filter === 'all'
                ? 'No checks have run yet'
                : 'No runs match this state'
            }}
          </h2>
          <p
            class="mx-auto mt-2 max-w-md text-sm text-gray-500 dark:text-gray-400"
          >
            {{
              filter === 'all'
                ? 'An isolated runner and a reviewed check policy are needed before the first run. Production deployment settings are unchanged.'
                : 'Choose another state to see the other runs.'
            }}
          </p>
        </div>
        <div
          v-else
          class="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-8"
        >
          <div class="space-y-1" aria-label="CI run history">
            <button
              v-for="run in runs"
              :key="run.id"
              :aria-pressed="selected?.id === run.id"
              :class="[
                'block w-full rounded-md px-3 py-3 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-900/50',
                selected?.id === run.id && 'bg-gray-50 dark:bg-gray-900/50'
              ]"
              @click="selectedId = run.id"
            >
              <span
                class="block truncate font-medium text-gray-900 dark:text-white"
                >{{ run.title || 'Source checks' }}</span
              >
              <span
                class="mt-1 block truncate font-mono text-xs text-gray-500 dark:text-gray-400"
                >{{ run.sourceRevision?.slice(0, 8) }}</span
              >
              <span class="mt-2 flex items-center justify-between gap-3"
                ><Badge
                  :class="tone(run.state)"
                  class="rounded px-1.5 text-[11px] font-normal"
                  >{{ label(run.state) }}</Badge
                ><span class="text-xs tabular-nums text-gray-500">{{
                  duration(run.durationSeconds)
                }}</span></span
              >
            </button>
          </div>
          <article
            v-if="selected"
            class="min-w-0 lg:border-l lg:border-gray-200 lg:pl-8 dark:lg:border-gray-800"
            aria-label="Selected CI run"
          >
            <div class="flex flex-wrap items-center gap-3">
              <h2 class="text-base font-semibold text-gray-900 dark:text-white">
                {{ selected.title || 'Source checks' }}
              </h2>
              <Badge
                :class="tone(selected.state)"
                class="rounded px-1.5 text-[11px] font-normal"
                >{{ label(selected.state) }}</Badge
              >
            </div>
            <div
              class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400"
            >
              <code>{{ selected.sourceRevision?.slice(0, 12) }}</code
              ><span>{{ duration(selected.durationSeconds) }}</span
              ><span
                >{{
                  selected.origin === 'trusted-local'
                    ? 'Trusted local runner'
                    : 'Local pilot'
                }}
                · source checks only</span
              >
            </div>
            <p class="my-5 text-sm text-gray-500 dark:text-gray-400">
              {{
                selected.reason ||
                (selected.origin === 'trusted-local' &&
                selected.accepted === false
                  ? 'This result is retained for history. Current policy, device trust or freshness no longer permits deployment reuse.'
                  : verified
                  ? 'Source checks passed locally. The server separately verified the deployment candidate.'
                  : selected.state === 'passed'
                  ? 'Selected source checks passed. An application image has not been verified for deployment.'
                  : 'These checks did not pass. Review the failed step before retrying.')
              }}
            </p>
            <ol class="divide-y divide-gray-100 dark:divide-gray-800">
              <li
                v-for="step in selected.steps"
                :key="step.name"
                class="flex items-center gap-3 py-3 text-sm"
              >
                <Check
                  v-if="step.state === 'passed'"
                  class="size-4 shrink-0 text-green-600 dark:text-green-400"
                />
                <X
                  v-else-if="step.state === 'failed'"
                  class="size-4 shrink-0 text-red-600 dark:text-red-400"
                />
                <Clock v-else class="size-4 shrink-0 text-gray-400" />
                <span class="min-w-0 flex-1"
                  ><span class="text-gray-900 dark:text-white">{{
                    step.name === 'install'
                      ? 'Install dependencies'
                      : step.name === 'test'
                      ? 'Tests'
                      : label(step.name)
                  }}</span
                  ><code
                    class="ml-3 text-xs text-gray-500 dark:text-gray-400"
                    >{{
                      step.name === 'install'
                        ? 'npm ci'
                        : `npm run ${step.name}`
                    }}</code
                  ></span
                >
                <span class="text-xs tabular-nums text-gray-500">{{
                  duration(step.durationSeconds)
                }}</span>
              </li>
            </ol>
            <div
              class="mt-6 flex items-start justify-between gap-4 border-t border-gray-200 pt-4 text-xs dark:border-gray-800"
            >
              <div>
                <p class="font-medium text-gray-900 dark:text-white">
                  Deployment
                </p>
                <p class="mt-1 text-gray-500 dark:text-gray-400">
                  {{
                    verified
                      ? 'The server verified this candidate separately from local source checks.'
                      : 'The server must verify a candidate before deployment.'
                  }}
                </p>
              </div>
              <Badge class="rounded px-1.5 text-[11px] font-normal">{{
                verified ? 'Server verified' : 'Not approved'
              }}</Badge>
            </div>
            <div
              v-if="verified"
              class="mt-4 border-t border-gray-200 pt-4 text-xs dark:border-gray-800"
            >
              <p class="font-medium text-gray-900 dark:text-white">
                Server verified candidate
              </p>
              <code class="mt-2 block break-all text-gray-500">{{
                verified.imageId
              }}</code>
              <Link
                :href="verified.deploymentUrl"
                class="mt-2 inline-block border-b border-dashed border-gray-300 text-gray-700 dark:text-gray-300"
                >View deployment</Link
              >
            </div>
            <p class="mt-4 break-all text-xs text-gray-500 dark:text-gray-400">
              Cleanup: {{ selected.cleanup?.state || 'unconfirmed' }} · Run
              {{ selected.id }}
            </p>
          </article>
        </div>
      </div>
      <div
        data-slot="tab-panel"
        data-value="configuration"
        class="max-w-3xl pt-6"
      >
        <div class="flex items-center justify-between gap-3">
          <h2 class="text-sm font-semibold text-gray-900 dark:text-white">
            Source checks
          </h2>
          <Button
            v-if="canManage && policy?.enabled"
            :class="action"
            @click="confirmation = { disable: true }"
            >Disable CI</Button
          >
        </div>
        <template v-if="policy">
          <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
            {{
              policy.enabled
                ? 'Trusted local results can satisfy these checks for the exact commit.'
                : 'This policy is disabled. New deployments do not require its local results.'
            }}
          </p>
          <dl class="mt-5 grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt class="text-xs text-gray-500">Branch</dt>
              <dd class="mt-1 font-mono text-gray-900 dark:text-white">
                {{ policy.branch }}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-gray-500">Test environment</dt>
              <dd class="mt-1 text-gray-900 dark:text-white">
                {{ policy.configuration.execution.platform }} · disposable
                SQLite
              </dd>
            </div>
          </dl>
          <div class="mt-4 divide-y divide-gray-100 dark:divide-gray-800">
            <div
              v-for="step in policy.configuration.execution.scripts"
              :key="step.name"
              class="py-3"
            >
              <p class="text-sm font-medium text-gray-900 dark:text-white">
                {{ step.name === 'test' ? 'Tests' : label(step.name) }}
                <span class="ml-2 text-xs font-normal text-gray-500"
                  >Required</span
                >
              </p>
              <code
                class="mt-1 block break-all text-xs text-gray-500 dark:text-gray-400"
                >{{ step.script }}</code
              >
            </div>
          </div>
        </template>
        <p v-else class="mt-2 text-sm text-gray-500 dark:text-gray-400">
          No CI policy is configured. Review the committed commands, runtime and
          target platform from your development machine.
        </p>
        <div
          v-if="canManage"
          class="mt-6 space-y-5 border-t border-gray-200 pt-5 dark:border-gray-800"
        >
          <div
            v-for="(title, key) in policy?.enabled
              ? {
                  register: 'Register your local runner',
                  run: 'Run before pushing',
                  submit: 'Submit the retained result after pushing'
                }
              : { setup: 'Review and enable CI' }"
            :key="key"
          >
            <div class="flex items-center justify-between gap-3">
              <h3 class="text-sm font-medium text-gray-900 dark:text-white">
                {{ title }}
              </h3>
              <Button
                :class="action"
                :aria-label="`Copy ${title.toLowerCase()} command`"
                @click="copy(commands[key])"
                >Copy</Button
              >
            </div>
            <code
              class="mt-2 block whitespace-pre-wrap break-all rounded-md bg-gray-50 p-3 text-xs leading-relaxed text-gray-700 dark:bg-gray-900/50 dark:text-gray-300"
              >{{ commands[key] }}</code
            >
          </div>
        </div>
        <div class="mt-6 border-t border-gray-200 pt-5 dark:border-gray-800">
          <h3 class="text-sm font-medium text-gray-900 dark:text-white">
            Local runners
          </h3>
          <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Only approve devices you trust to report checks honestly. Signing
            keys stay outside the tested app. Server image and health
            verification still run before deployment.
          </p>
          <p
            v-if="!workspace.runners?.length"
            class="mt-4 text-xs text-gray-500"
          >
            No local runners registered.
          </p>
          <div
            v-for="runner in workspace.runners || []"
            :key="runner.runnerId"
            class="mt-3 flex items-center justify-between gap-3 border-t border-gray-100 pt-3 text-sm dark:border-gray-800"
          >
            <div>
              <p class="text-gray-900 dark:text-white">{{ runner.name }}</p>
              <p class="mt-1 text-xs text-gray-500">
                {{
                  runner.revokedAt != null
                    ? 'Revoked'
                    : runner.policyRevision !== policy?.revision
                    ? 'Needs approval for the current policy'
                    : 'Trusted for this policy'
                }}
              </p>
            </div>
            <Button
              v-if="canManage && runner.revokedAt == null"
              :class="action"
              @click="confirmation = { runner }"
              >Revoke</Button
            >
          </div>
        </div>
      </div>
    </Tabs>
    <Dialog
      :dismissible="!busy"
      :open="!!confirmation"
      @update:open="
        (value) => {
          if (!value && !busy) confirmation = null
        }
      "
      aria-labelledby="ci-confirm-title"
    >
      <h2 id="ci-confirm-title" class="text-lg font-semibold">
        {{
          confirmation?.runner
            ? 'Revoke local runner?'
            : 'Disable CI for this app?'
        }}
      </h2>
      <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
        {{
          confirmation?.runner
            ? `Future deployments cannot reuse results from ${confirmation.runner.name}. The running app stays unchanged.`
            : 'Future deployments will no longer require this CI policy. The running app stays unchanged.'
        }}
      </p>
      <div class="mt-6 flex justify-end gap-2">
        <Button :class="action" :disabled="busy" @click="confirmation = null"
          >Cancel</Button
        ><Button :disabled="busy" @click="confirmAction">{{
          busy
            ? 'Saving…'
            : confirmation?.runner
            ? 'Revoke runner'
            : 'Disable CI'
        }}</Button>
      </div>
    </Dialog>
  </div>
</template>
