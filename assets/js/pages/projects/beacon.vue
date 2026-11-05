<script setup>
import { computed, inject, onMounted, onUnmounted, ref, watch } from 'vue'
import { Head, Link } from '@inertiajs/vue3'
import AppLayout from '@/layouts/AppLayout.vue'
import Breadcrumb from '@/components/ContextBreadcrumb.vue'
import AppNavbarVersion from '@/components/AppNavbarVersion.vue'
import Button from '@/components/ui/button/Button.vue'
import LineChart from '@/components/ui/line-chart/LineChart.vue'
import SidebarOpen from '@/components/ui/icons/SidebarOpen.vue'
import SidebarClose from '@/components/ui/icons/SidebarClose.vue'
import StatusOnline from '@/components/ui/icons/StatusOnline.vue'
import ArrowRight from '@/components/ui/icons/ArrowRight.vue'
import Switch from '@/components/ui/switch/Switch.vue'
import { inertiaMutation } from '@/lib/inertia-mutation'

defineOptions({ layout: AppLayout })
const props = defineProps({
  project: Object,
  environment: Object,
  app: Object,
  deployment: Object,
  checker: Object,
  publicPage: Object,
  canManagePublic: Boolean,
  preview: Object
})
const publicEnabled = ref(props.publicPage?.enabled === true)
const savingPublic = ref(false)
const publicError = ref('')
watch(
  () => props.publicPage?.enabled,
  (value) => {
    publicEnabled.value = value === true
  }
)
async function savePublic() {
  savingPublic.value = true
  publicError.value = ''
  try {
    await inertiaMutation('patch', base.value + '/beacon/public', {
      enabled: publicEnabled.value
    })
  } catch (error) {
    publicError.value =
      error.mutationMessage ||
      'The public page setting could not be saved. Try again.'
  } finally {
    savingPublic.value = false
  }
}
const base = computed(
  () =>
    `/projects/${props.project.slug}/environments/${props.environment.slug}/apps/${props.app.slug}`
)
const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')
const now = ref(Date.now())
let clock
onMounted(() => {
  clock = setInterval(() => {
    now.value = Date.now()
  }, 10000)
})
onUnmounted(() => clearInterval(clock))
const status = computed(() => {
  const state = props.preview?.state
  if (
    !state ||
    state.lastCheckedAt === null ||
    now.value < state.lastCheckedAt ||
    now.value - state.lastCheckedAt >= 180000
  )
    return 'unknown'
  return state.status
})
const label = computed(
  () => ({ up: 'Up', down: 'Down', unknown: 'Unknown' }[status.value])
)
const color = (value) =>
  ({
    up: 'bg-emerald-500',
    down: 'bg-red-500',
    unknown: 'bg-gray-300 dark:bg-gray-700'
  }[value])
const time = (value) =>
  value == null
    ? 'No observations'
    : new Date(value).toISOString().slice(11, 19) + ' UTC'
const shortTime = (value) => new Date(value).toISOString().slice(11, 16)
const latest = computed(() => props.preview?.latest)
const checks = computed(() => props.preview?.timeline.slice(-5).reverse() || [])
const timeline = computed(
  () =>
    props.preview?.timeline ||
    Array.from({ length: 60 }, () => ({ outcome: 'unknown' }))
)
const chartData = computed(
  () =>
    props.preview?.timeline.map((point) => ({
      label: shortTime(point.checkedAt),
      value: point.outcome === 'up' ? point.durationMs : null
    })) || []
)
const deploymentLabel = computed(
  () =>
    props.deployment?.gitCommit?.slice(0, 7) ||
    (props.deployment ? 'Current deployment' : 'No active deployment')
)
</script>

<template>
  <Head :title="`Beacon · ${app.name}`" />
  <div class="flex h-full min-w-0 flex-col">
    <header
      class="flex min-w-0 items-center gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-800"
    >
      <button
        type="button"
        aria-label="Open navigation"
        class="text-gray-500 md:hidden"
        @click="toggleMobileMenu"
      >
        <SidebarOpen class="h-5 w-5" />
      </button>
      <button
        type="button"
        :aria-label="sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
        class="hidden text-gray-500 md:block"
        @click="toggleSidebar"
      >
        <SidebarOpen v-if="sidebarCollapsed" class="h-5 w-5" /><SidebarClose
          v-else
          class="h-5 w-5"
        />
      </button>
      <Breadcrumb
        :items="[
          { label: 'projects', href: '/' },
          { label: project.name, href: `/projects/${project.slug}` },
          {
            label: environment.name,
            href: `/projects/${project.slug}/environments/${environment.slug}`
          },
          { label: app.name, href: base },
          { label: 'Beacon' }
        ]"
      />
      <div class="ml-auto shrink-0 pl-2"><AppNavbarVersion /></div>
    </header>

    <main
      class="min-w-0 flex-1 overflow-y-auto px-4 py-8 text-gray-950 dark:text-white sm:px-8"
    >
      <div class="mx-auto max-w-6xl space-y-8">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div
              class="mb-2 flex items-center gap-2 text-xs font-medium text-gray-500"
            >
              <StatusOnline class="h-4 w-4" /> PUBLIC AVAILABILITY
            </div>
            <h1 class="text-2xl font-semibold tracking-tight">Beacon</h1>
            <p class="mt-1 text-sm text-gray-500">
              {{ app.name }} <span class="px-1 text-gray-400">/</span>
              {{ environment.name }}
            </p>
          </div>
          <Button
            v-if="!preview"
            :as="Link"
            :href="base + '/beacon?preview=healthy'"
            >Explore example <ArrowRight class="h-4 w-4"
          /></Button>
          <Button v-else :as="Link" :href="base + '/beacon'"
            >Back to your app <ArrowRight class="h-4 w-4"
          /></Button>
        </div>

        <div
          v-if="preview"
          class="flex flex-wrap items-center justify-between gap-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900 dark:bg-amber-950/25"
          role="status"
        >
          <div class="text-sm">
            <p class="font-medium text-amber-900 dark:text-amber-200">
              Example preview
            </p>
            <p class="mt-1 text-amber-800 dark:text-amber-300">
              Simulated observations. No checks are running against this app.
            </p>
          </div>
          <nav aria-label="Example scenarios" class="flex flex-wrap gap-1">
            <Link
              v-for="scenario in [
                { id: 'healthy', label: 'Recovered' },
                { id: 'down', label: 'Outage' },
                { id: 'stale', label: 'Missing checker' }
              ]"
              :key="scenario.id"
              :href="base + '/beacon?preview=' + scenario.id"
              :aria-current="
                preview.scenario === scenario.id ? 'page' : undefined
              "
              class="focus-visible:outline-brand rounded-md px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none"
              :class="
                preview.scenario === scenario.id
                  ? 'bg-amber-100 text-amber-950 dark:bg-amber-900/50 dark:text-amber-100'
                  : 'text-amber-800 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/30'
              "
              >{{ scenario.label }}</Link
            >
          </nav>
        </div>

        <section
          aria-label="Availability"
          class="border-b border-gray-200 pb-8 dark:border-gray-800"
        >
          <div class="flex flex-wrap items-center justify-between gap-6">
            <div>
              <div class="flex items-center gap-3">
                <span
                  :class="color(status)"
                  class="h-3 w-3 shrink-0 rounded-full"
                />
                <h2
                  class="text-4xl font-semibold tracking-tight"
                  data-test="beacon-status"
                >
                  {{ label }}
                </h2>
              </div>
              <p class="mt-3 text-sm text-gray-500" data-test="beacon-target">
                {{ preview ? preview.target : 'No monitor connected' }}
              </p>
            </div>
            <div class="text-sm sm:text-right">
              <p class="font-medium">
                {{
                  preview
                    ? 'Example checker'
                    : 'Independent checker not connected'
                }}
              </p>
              <p class="mt-1 max-w-sm text-gray-500">
                {{
                  !preview
                    ? 'Public reachability has not been observed.'
                    : status === 'unknown'
                    ? 'No fresh observation for at least 3 minutes.'
                    : status === 'down'
                    ? 'Two consecutive checks failed.'
                    : 'Two consecutive checks confirmed recovery.'
                }}
              </p>
            </div>
          </div>

          <dl class="mt-8 grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4">
            <div>
              <dt class="text-xs text-gray-500">Latest response</dt>
              <dd class="mt-2 font-mono text-lg">
                {{ latest ? latest.durationMs + ' ms' : '—' }}
              </dd>
              <p class="mt-1 text-xs text-gray-500">
                {{
                  latest
                    ? 'HTTP ' + latest.statusCode + ' · response headers'
                    : 'No response measured'
                }}
              </p>
            </div>
            <div>
              <dt class="text-xs text-gray-500">Last successful check</dt>
              <dd class="mt-2 text-sm font-medium">
                {{ preview ? time(preview.state.lastSuccessAt) : '—' }}
              </dd>
              <p class="mt-1 text-xs text-gray-500">
                {{
                  preview ? 'Example observation' : 'Waiting for first success'
                }}
              </p>
            </div>
            <div>
              <dt class="text-xs text-gray-500">Last observation</dt>
              <dd class="mt-2 text-sm font-medium">
                {{ preview ? time(preview.state.lastCheckedAt) : '—' }}
              </dd>
              <p class="mt-1 text-xs text-gray-500">
                {{
                  preview
                    ? 'Example observation'
                    : 'Waiting for independent checker'
                }}
              </p>
            </div>
            <div>
              <dt class="text-xs text-gray-500">
                {{ preview ? 'Example deployment' : 'Active deployment' }}
              </dt>
              <dd class="mt-2 break-all font-mono text-sm font-medium">
                {{ preview ? 'example-a12bc34' : deploymentLabel }}
              </dd>
              <p class="mt-1 text-xs text-gray-500">
                {{
                  preview
                    ? 'Simulated incident context'
                    : 'Container health is a separate signal'
                }}
              </p>
            </div>
          </dl>
        </section>

        <section aria-labelledby="checks-heading">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h2 id="checks-heading" class="text-sm font-semibold">
              {{ preview ? 'Example checks' : 'Checks' }}
            </h2>
            <span class="text-xs text-gray-500">{{
              preview ? 'Last 60 minutes · UTC' : 'No observations yet'
            }}</span>
          </div>
          <div
            class="mt-5 grid h-9 gap-0.5"
            style="grid-template-columns: repeat(60, minmax(0, 1fr))"
            role="img"
            :aria-label="
              preview
                ? 'Example check timeline. Green is Up, red is Down, gray is Unknown. Missing observations are not uptime.'
                : 'No check observations are available.'
            "
          >
            <span
              v-for="(point, index) in timeline"
              :key="index"
              class="rounded-sm"
              :class="color(point.outcome)"
              :title="
                preview
                  ? time(point.checkedAt) + ' · ' + point.outcome
                  : 'No observation'
              "
            />
          </div>
          <div
            class="mt-3 flex flex-wrap justify-between gap-3 text-xs text-gray-500"
          >
            <p>Missing checks are Unknown, never uptime.</p>
            <div class="flex gap-4">
              <span
                v-for="value in ['up', 'down', 'unknown']"
                :key="value"
                class="flex items-center gap-1.5"
                ><span
                  class="h-1.5 w-1.5 rounded-full"
                  :class="color(value)"
                /><span class="capitalize">{{ value }}</span></span
              >
            </div>
          </div>
        </section>

        <section
          v-if="!preview"
          class="grid gap-8 border-y border-gray-200 py-8 dark:border-gray-800 md:grid-cols-2"
          aria-labelledby="connect-heading"
        >
          <div>
            <h2 id="connect-heading" class="text-lg font-semibold">
              A public URL needs an outside view.
            </h2>
            <p class="mt-2 max-w-md text-sm leading-6 text-gray-500">
              Beacon’s probe is ready to run from a separate machine. Scheduled
              checks and result delivery are still being built, so this app has
              no live coverage yet.
            </p>
            <div class="mt-5">
              <p class="text-xs text-gray-500">
                App URL <span class="ml-1">· not monitored</span>
              </p>
              <p class="mt-2 break-all font-mono text-sm">
                {{ app.appUrl || 'No public URL configured' }}
              </p>
            </div>
          </div>
          <div class="space-y-5 text-sm">
            <div class="flex gap-3">
              <span class="mt-0.5 font-mono text-xs text-gray-400">01</span>
              <div>
                <h3 class="font-medium">Check from a separate host</h3>
                <p class="mt-1 text-gray-500">
                  A server failure must not take its checker down too.
                </p>
              </div>
            </div>
            <div class="flex gap-3">
              <span class="mt-0.5 font-mono text-xs text-gray-400">02</span>
              <div>
                <h3 class="font-medium">Confirm before alerting</h3>
                <p class="mt-1 text-gray-500">
                  Two failures open an incident. Two successes resolve it.
                </p>
              </div>
            </div>
            <div class="flex gap-3">
              <span class="mt-0.5 font-mono text-xs text-gray-400">03</span>
              <div>
                <h3 class="font-medium">Keep missing coverage visible</h3>
                <p class="mt-1 text-gray-500">
                  Three minutes without a fresh check means Unknown.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section
          v-if="preview"
          class="grid min-w-0 gap-8 lg:grid-cols-[1.4fr_1fr]"
        >
          <div class="min-w-0">
            <h2 class="mb-5 text-sm font-semibold">Example response time</h2>
            <LineChart
              :data="chartData"
              caption="Successful example checks · response headers"
              :format-value="(value) => Math.round(value) + ' ms'"
            />
            <p class="mt-3 text-xs text-gray-500">
              Gaps preserve failed or missing observations. No uptime percentage
              is inferred.
            </p>
          </div>
          <div class="min-w-0">
            <h2 class="mb-3 text-sm font-semibold">
              Recent example observations
            </h2>
            <table class="w-full text-left text-xs">
              <thead class="text-gray-500">
                <tr class="border-b border-gray-200 dark:border-gray-800">
                  <th class="py-3 font-normal">Time (UTC)</th>
                  <th class="py-3 font-normal">Result</th>
                  <th class="py-3 text-right font-normal">Response</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="point in checks"
                  :key="point.checkedAt"
                  class="border-b border-gray-100 dark:border-gray-800/70"
                >
                  <td class="py-3 font-mono">
                    {{ shortTime(point.checkedAt) }}
                  </td>
                  <td class="py-3">
                    <span class="flex items-center gap-2"
                      ><span
                        class="h-1.5 w-1.5 rounded-full"
                        :class="color(point.outcome)"
                      />{{
                        point.statusCode
                          ? 'HTTP ' + point.statusCode
                          : 'Missing'
                      }}</span
                    >
                  </td>
                  <td class="py-3 text-right font-mono">
                    {{
                      point.durationMs == null ? '—' : point.durationMs + ' ms'
                    }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section
          aria-labelledby="incidents-heading"
          class="border-t border-gray-200 pt-6 dark:border-gray-800"
        >
          <div class="flex items-center justify-between gap-3">
            <h2 id="incidents-heading" class="text-sm font-semibold">
              {{ preview ? 'Example incidents' : 'Incidents' }}
            </h2>
            <span class="text-xs text-gray-500">{{
              preview ? 'Confirmed transitions' : 'No incident history'
            }}</span>
          </div>
          <p v-if="!preview" class="py-6 text-sm text-gray-500">
            Incidents will appear after an independent checker starts delivering
            observations.
          </p>
          <div
            v-else
            class="mt-3 divide-y divide-gray-200 dark:divide-gray-800"
          >
            <details
              v-for="incident in preview.incidents"
              :key="incident.openedAt"
              class="group py-4"
            >
              <summary
                class="focus-visible:outline-brand flex cursor-pointer list-none flex-wrap items-center gap-3 rounded-sm text-sm focus-visible:outline-2"
              >
                <span
                  class="h-1.5 w-1.5 shrink-0 rounded-full"
                  :class="incident.resolvedAt ? 'bg-emerald-500' : 'bg-red-500'"
                /><span class="font-medium">{{
                  incident.resolvedAt ? 'Resolved' : 'Ongoing'
                }}</span
                ><span class="text-gray-500"
                  >{{ shortTime(incident.openedAt) }} UTC
                  <template v-if="incident.resolvedAt"
                    >→ {{ shortTime(incident.resolvedAt) }} UTC</template
                  ></span
                ><span
                  class="ml-auto flex items-center gap-2 text-xs text-gray-500"
                  >Details
                  <ArrowRight
                    class="h-3 w-3 transition-transform group-open:rotate-90 motion-reduce:transition-none"
                /></span>
              </summary>
              <div
                class="mt-4 border-l border-gray-200 pl-4 text-xs leading-6 text-gray-500 dark:border-gray-700"
              >
                <p>
                  {{ incident.reason }}.
                  {{
                    incident.resolvedAt
                      ? 'Recovery confirmed by two successful checks.'
                      : 'Waiting for two successful checks.'
                  }}
                </p>
                <p>
                  Example deployment:
                  <span class="font-mono">{{ incident.deployment }}</span>
                </p>
                <p>Simulated incident. No team notification was sent.</p>
              </div>
            </details>
          </div>
        </section>

        <section
          v-if="!preview"
          aria-labelledby="public-page-heading"
          class="border-t border-gray-200 pt-6 dark:border-gray-800"
        >
          <div class="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 id="public-page-heading" class="text-sm font-semibold">
                Public status page
              </h2>
              <p class="mt-2 text-sm text-gray-500">
                Available on your app’s domain at
                <code>{{ publicPage?.path }}</code
                >.
              </p>
            </div>
            <a
              v-if="publicPage?.enabled && publicPage?.url"
              :href="publicPage.url"
              target="_blank"
              rel="noopener noreferrer"
              class="text-sm underline underline-offset-4"
              >Open public page ↗</a
            >
          </div>
          <p class="mt-4 text-sm text-gray-500">
            The public page uses this app’s shared logo and light/dark settings.
            <Link
              v-if="canManagePublic"
              :href="base + '/appearance'"
              class="ml-1 font-medium text-gray-950 underline underline-offset-4 dark:text-white"
              >Branding &amp; appearance</Link
            >
          </p>
          <form class="mt-5 space-y-4" @submit.prevent="savePublic">
            <label class="flex items-center gap-3 text-sm"
              ><Switch
                v-model="publicEnabled"
                :disabled="!canManagePublic || savingPublic"
                aria-label="Enable public Beacon page"
              /><span>Enable public Beacon page</span></label
            >
            <p class="max-w-2xl text-xs leading-6 text-gray-500">
              Off by default. Enabling publishes the app’s display name and an
              Unknown status; it does not start monitoring. Redeploy this app to
              activate the route. Disabling hides the page immediately; redeploy
              to remove its route.
            </p>
            <Button
              v-if="canManagePublic"
              :disabled="savingPublic || publicEnabled === publicPage?.enabled"
              type="submit"
              >{{ savingPublic ? 'Saving…' : 'Save public page' }}</Button
            >
            <p v-else class="text-xs text-gray-500">
              A team owner or administrator can change this setting.
            </p>
            <p
              v-if="publicError"
              role="alert"
              class="text-sm text-red-600 dark:text-red-400"
            >
              {{ publicError }}
            </p>
          </form>
        </section>

        <footer
          class="flex flex-wrap justify-between gap-3 pb-4 text-xs text-gray-500"
        >
          <span>Intended cadence: 1 minute · Request deadline: 10 seconds</span
          ><span
            >Team alerts and independent scheduling are not connected.</span
          >
        </footer>
      </div>
    </main>
  </div>
</template>
