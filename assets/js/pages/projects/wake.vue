<script setup>
import { inertiaMutation } from '@/lib/inertia-mutation'
import AppNavbarVersion from '@/components/AppNavbarVersion.vue'
import DateInput from '@/components/DateInput.vue'
import { computed, inject, ref, watch } from 'vue'
import { Head, Link, router } from '@inertiajs/vue3'
import AppLayout from '@/layouts/AppLayout.vue'
import Breadcrumb from '@/components/ui/breadcrumb/Breadcrumb.vue'
import Tabs from '@/components/ui/tabs/Tabs.vue'
import Alert from '@/components/ui/alert/Alert.vue'
import Button from '@/components/ui/button/Button.vue'
import BareSelect from '@/components/BareSelect.vue'
import Textarea from '@/components/ui/textarea/Textarea.vue'
import LineChart from '@/components/ui/line-chart/LineChart.vue'
import Switch from '@/components/ui/switch/Switch.vue'
import Dialog from '@/components/ui/dialog/Dialog.vue'
import SidebarOpen from '@/components/ui/icons/SidebarOpen.vue'
import SidebarClose from '@/components/ui/icons/SidebarClose.vue'
defineOptions({ layout: AppLayout })
const props = defineProps({
  project: Object,
  environment: Object,
  app: Object,
  canManage: Boolean,
  state: Object,
  report: Object,
  journeys: Object,
  filters: Object,
  tab: String,
  filterError: String,
  visitor: String
})
const base = `/projects/${props.project.slug}/environments/${props.environment.slug}/apps/${props.app.slug}`
const toggleMobileMenu = inject('toggleMobileMenu'),
  toggleSidebar = inject('toggleSidebar'),
  sidebarCollapsed = inject('sidebarCollapsed')
const from = ref(props.filters.fromText),
  to = ref(props.filters.toText),
  currency = ref(props.filters.currency),
  busy = ref(false),
  error = ref(''),
  notice = ref(''),
  confirmDelete = ref(false)
watch(
  () => props.filters,
  (value) => {
    from.value = value.fromText
    to.value = value.toText
    currency.value = value.currency
  }
)
const settings = props.app.wakeSettings || {}
const enabled = ref(props.app.wakeEnabled),
  mode = ref(settings.mode || 'first-party'),
  consent = ref(settings.requireConsent !== false),
  privacy = ref(settings.respectPrivacySignals !== false),
  origins = ref((settings.allowedOrigins || []).join('\n')),
  exclusions = ref((settings.excludedPaths || []).join('\n'))
const field =
  'w-full rounded-none border-0 border-b border-dashed border-gray-300 bg-transparent px-0 py-2 focus:outline-none focus:border-brand dark:border-gray-700 dark:bg-transparent'
const alert =
  'rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200'
const collection = computed(
  () =>
    ({
      disabled: {
        title: 'Wake is off',
        detail:
          'New activity is not being collected. Retained history is still available.',
        action: 'Review collection settings',
        tab: 'settings'
      },
      waiting_for_runtime: {
        title: 'Waiting for redeploy',
        detail:
          'Install sails-hook-slipway 0.0.10 or later, then redeploy this app to connect Wake.',
        action: 'Open app',
        app: true
      },
      foundation_only: {
        title: 'Hook update required',
        detail:
          'This runtime does not support collection. Install the supported hook and redeploy this app.',
        action: 'Open app',
        app: true
      },
      unavailable: {
        title: 'Collection is unavailable',
        detail:
          'Check the app connection and analytics storage. Retained reporting may be incomplete.',
        action: 'Try again',
        retry: true
      },
      collecting: {
        title: 'Runtime connected',
        detail: 'Wake is ready to receive permitted activity from this app.',
        action: 'Collection settings',
        tab: 'settings'
      }
    }[props.state?.state] || {
      title: 'Collection status unknown',
      detail: 'Refresh to check the app connection.',
      action: 'Try again',
      retry: true
    })
)
const pageviews = computed(
  () => props.report?.trend.reduce((n, day) => n + day.pageviews, 0) || 0
)
const goalEvents = computed(
  () => props.report?.trend.reduce((n, day) => n + day.goals, 0) || 0
)
const hasActivity = computed(
  () =>
    !!(
      pageviews.value ||
      goalEvents.value ||
      props.report?.visitors ||
      props.report?.sessions ||
      props.report?.revenue.gross ||
      props.report?.revenue.refunds
    )
)
const showReport = computed(
  () =>
    props.report && (props.state?.state === 'collecting' || hasActivity.value)
)
const query = (tab = props.tab, visitor = '') => ({
  tab,
  from: props.filters.fromText,
  to: props.filters.toText,
  currency: props.filters.currency,
  ...(visitor ? { visitor } : {})
})
function navigate(tab = props.tab) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  router.get(
    base + '/wake',
    { ...query(tab), from: from.value, to: to.value, currency: currency.value },
    {
      preserveScroll: true,
      preserveState: true,
      onError: () => {
        error.value =
          'The report could not be loaded. Review the filters and try again.'
      },
      onCancel: () => {
        error.value =
          'Report loading was cancelled. Your filters are still here.'
      },
      onHttpException: () => {
        error.value = 'The report could not be loaded. Try again.'
        return false
      },
      onNetworkError: () => {
        error.value =
          'Connection interrupted. Your filters are still here; try again.'
        return false
      },
      onFinish: () => (busy.value = false)
    }
  )
}
const date = (value) =>
  value
    ? new Date(value).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
    : 'Not yet'
const money = (value) =>
  value == null
    ? 'Unavailable'
    : new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: props.filters.currency
      }).format(
        value /
          10 **
            new Intl.NumberFormat('en', {
              style: 'currency',
              currency: props.filters.currency
            }).resolvedOptions().maximumFractionDigits
      )
const metrics = computed(() =>
  props.report
    ? [
        ['Pageviews', pageviews.value, 'Recorded page loads'],
        [
          'Visitors',
          props.report.visitors ?? '—',
          props.report.measurable ? 'Distinct in this range' : ''
        ],
        [
          'Sessions',
          props.report.sessions ?? '—',
          props.report.measurable ? 'Started in this range' : ''
        ],
        [
          'Signup conversion',
          props.report.conversion == null
            ? '—'
            : (100 * props.report.conversion).toFixed(1) + '%',
          props.report.measurable
            ? props.report.visitors
              ? `${props.report.signups} ${
                  props.report.signups === 1 ? 'visitor' : 'visitors'
                } signed up`
              : 'No visitors to measure'
            : ''
        ]
      ]
    : []
)
async function save() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    await inertiaMutation('post', base + '/wake/settings', {
      enabled: enabled.value,
      settings: {
        mode: mode.value,
        requireConsent: consent.value,
        respectPrivacySignals: privacy.value,
        allowedOrigins: origins.value
          .split('\n')
          .map((v) => v.trim())
          .filter(Boolean),
        excludedPaths: exclusions.value
          .split('\n')
          .map((v) => v.trim())
          .filter(Boolean)
      }
    })
    notice.value = enabled.value
      ? 'Saved. Redeploy this app to activate the new settings.'
      : 'Saved. New collection is disabled; retained history remains.'
  } catch (e) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}
async function removeVisitor() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await inertiaMutation(
      'delete',
      base + '/wake/visitors/' + encodeURIComponent(props.visitor)
    )
    confirmDelete.value = false
  } catch (e) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <Head :title="`Wake · ${app.name}`" />
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
          { label: 'Wake' }
        ]"
      />

      <div class="ml-auto shrink-0 pl-2"><AppNavbarVersion /></div>
    </header>
    <main
      class="min-w-0 flex-1 overflow-y-auto px-4 py-8 text-gray-950 dark:text-white sm:px-8"
    >
      <div class="mx-auto max-w-6xl space-y-7">
        <div>
          <h1 class="text-2xl font-semibold tracking-tight">Wake</h1>
          <p class="mt-1 text-sm text-gray-500">
            {{ app.name }} ·
            {{ environment.name }}
          </p>
        </div>
        <Tabs
          as="nav"
          aria-label="Wake sections"
          class="flex gap-6 border-b border-gray-200 dark:border-gray-800"
          ><Link
            v-for="section in ['overview', 'journeys', 'settings']"
            :key="section"
            :href="base + '/wake'"
            :data="query(section)"
            :aria-current="tab === section ? 'page' : undefined"
            :class="[
              'border-b-2 pb-3 text-sm capitalize',
              tab === section
                ? 'border-brand text-brand dark:text-brand-400 font-medium'
                : 'border-transparent text-gray-500'
            ]"
            >{{ section }}</Link
          ></Tabs
        >
        <Alert
          v-if="error && !confirmDelete"
          role="alert"
          class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
          >{{ error }}</Alert
        >
        <Alert
          v-if="notice"
          class="rounded-lg border border-gray-200 p-4 text-sm dark:border-gray-700"
          >{{ notice }}</Alert
        >
        <Alert v-if="filterError" role="alert" :class="alert">{{
          filterError
        }}</Alert>
        <section
          aria-label="Collection readiness"
          class="border-b border-gray-200 pb-6 dark:border-gray-800"
        >
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div class="min-w-0 max-w-2xl">
              <h2 class="flex items-center gap-2 text-sm font-semibold">
                <span
                  aria-hidden="true"
                  :class="[
                    'h-2 w-2 shrink-0 rounded-full',
                    state.state === 'collecting' ? 'bg-brand' : 'bg-gray-400'
                  ]"
                />
                {{ collection.title }}
              </h2>
              <p class="mt-2 text-sm leading-6 text-gray-500">
                {{ collection.detail }}
              </p>
            </div>
            <Button
              v-if="collection.retry"
              :disabled="busy"
              class="border border-gray-200 bg-transparent text-gray-900 dark:border-gray-700 dark:bg-transparent dark:text-white"
              @click="navigate()"
              >{{ busy ? 'Loading…' : collection.action }}</Button
            >
            <Button
              v-else-if="collection.app || collection.tab !== tab"
              :as="Link"
              :href="collection.app ? base : base + '/wake'"
              :data="collection.app ? undefined : query(collection.tab)"
              class="border border-gray-200 bg-transparent text-gray-900 dark:border-gray-700 dark:bg-transparent dark:text-white"
              >{{ collection.action }}</Button
            >
          </div>
          <p class="mt-3 text-xs leading-5 text-gray-500">
            {{
              app.wakeSettings?.mode === 'cookieless'
                ? 'Cookieless events'
                : 'First-party visitors'
            }}
            ·
            {{
              app.wakeSettings?.requireConsent !== false
                ? 'Consent required before collection'
                : 'Consent gate off'
            }}
            ·
            {{
              app.wakeSettings?.respectPrivacySignals !== false
                ? 'GPC / Do Not Track respected'
                : 'Privacy signal filtering off'
            }}
          </p>
        </section>
        <Alert
          v-if="state.state === 'collecting' && state.valueReady === false"
          :class="alert"
          >Update required for goals and revenue helpers. Install
          sails-hook-slipway 0.0.10 or later and redeploy.</Alert
        >
        <Alert v-if="report?.health.pendingBackfill" :class="alert"
          >Historical reporting is catching up.
          {{ report.health.pendingBackfill }} retained events still need their
          reporting records.</Alert
        >
        <form
          v-if="tab !== 'settings'"
          aria-label="Report filters"
          class="grid grid-cols-2 items-end gap-4 sm:flex sm:flex-wrap"
          @submit.prevent="navigate()"
        >
          <label class="min-w-0 text-sm"
            >From (UTC)<DateInput
              v-model="from"
              :disabled="busy"
              aria-label="From (UTC)"
              type="date"
              required
              :class="[field, 'dark:[color-scheme:dark]']"
          /></label>
          <label class="min-w-0 text-sm"
            >Through (UTC)<DateInput
              v-model="to"
              :disabled="busy"
              aria-label="Through (UTC)"
              type="date"
              required
              :class="[field, 'dark:[color-scheme:dark]']"
          /></label>
          <label class="min-w-0 text-sm"
            >Currency<BareSelect
              v-model="currency"
              :disabled="busy"
              aria-label="Currency"
              :class="field"
              :options="
                [
                  ...new Set([
                    filters.currency,
                    ...(report?.currencies || []),
                    'USD',
                    'EUR',
                    'GBP',
                    'NGN'
                  ])
                ].map((value) => ({ value, label: value }))
              "
          /></label>
          <Button type="submit" :disabled="busy">{{
            busy ? 'Loading…' : 'Apply'
          }}</Button>
        </form>
        <section
          v-if="tab === 'overview' && !showReport"
          class="py-8 sm:py-14"
          aria-label="Reporting not ready"
        >
          <p
            class="text-brand dark:text-brand-400 text-xs font-medium uppercase tracking-wider"
          >
            Collection & reporting
          </p>
          <h2 class="mt-3 text-2xl font-semibold tracking-tight">
            {{
              report
                ? 'No retained activity in this range'
                : 'Reporting is unavailable'
            }}
          </h2>
          <p class="mt-3 max-w-xl text-sm leading-6 text-gray-500">
            {{
              report
                ? 'Resolve collection readiness above to start receiving activity, or choose another date range to explore retained history.'
                : 'Wake could not read this report. Check analytics storage and the app connection, then try again. Missing data is not zero activity.'
            }}
          </p>
          <Button
            :as="Link"
            :href="base + '/wake'"
            :data="query('settings')"
            class="mt-5"
            >Review Wake settings</Button
          >
        </section>
        <template v-if="tab === 'overview' && showReport">
          <p v-if="state.state !== 'collecting'" class="text-sm text-gray-500">
            Retained history · collection is not currently ready. These totals
            may not include recent activity.
          </p>
          <p v-if="!report.measurable" class="text-sm text-gray-500">
            Cookieless mode reports events and revenue. Persistent visitors,
            conversion, and journeys are unavailable.
          </p>
          <section
            v-if="!hasActivity"
            aria-label="No recorded activity"
            class="border-brand border-l-2 py-1 pl-5"
          >
            <h2 class="font-semibold">Ready for your first activity</h2>
            <p class="mt-2 max-w-2xl text-sm leading-6 text-gray-500">
              No activity is recorded in this date range. Visit your app and
              complete its consent flow if required, then refresh this report.
              Goals and payments need explicit server helpers.
            </p>
            <div class="mt-4 flex flex-wrap gap-3">
              <Button :as="Link" :href="base">Open app</Button>
              <Button
                :disabled="busy"
                class="bg-transparent text-gray-700 dark:bg-transparent dark:text-gray-300"
                @click="navigate()"
                >Refresh report</Button
              >
            </div>
          </section>
          <dl
            aria-label="Activity metrics"
            class="grid grid-cols-2 gap-x-6 gap-y-7 border-b border-gray-200 pb-7 dark:border-gray-800 sm:grid-cols-4"
          >
            <div
              v-for="[label, value, detail] in metrics"
              :key="label"
              class="min-w-0"
            >
              <dt class="text-sm text-gray-500">{{ label }}</dt>
              <dd
                class="mt-2 text-3xl font-semibold tabular-nums tracking-tight"
              >
                {{ typeof value === 'number' ? value.toLocaleString() : value }}
              </dd>
              <dd v-if="detail" class="mt-2 text-xs leading-5 text-gray-500">
                {{ detail }}
              </dd>
            </div>
          </dl>
          <section
            v-if="hasActivity"
            class="space-y-5"
            aria-labelledby="activity-heading"
          >
            <div class="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="activity-heading" class="font-semibold">Activity</h2>
              <p class="text-xs text-gray-500">
                {{ filters.fromText }} — {{ filters.toText }} · UTC
              </p>
            </div>
            <LineChart
              :data="
                report.trend.map((day) => ({
                  label: new Date(day.day).toISOString().slice(0, 10),
                  value: day.pageviews,
                  detail: `${new Date(day.day).toISOString().slice(0, 10)}: ${
                    day.pageviews
                  } pageviews · ${day.goals} goals`
                }))
              "
              caption="Daily recorded pageviews · UTC"
              class="text-brand h-64"
            />
            <details class="text-sm">
              <summary class="w-fit cursor-pointer text-gray-500">
                View daily counts
              </summary>
              <div class="mt-3 max-h-72 overflow-auto">
                <table class="w-full text-left text-sm tabular-nums">
                  <caption class="sr-only">
                    Daily pageviews and goals in UTC
                  </caption>
                  <thead class="text-gray-500">
                    <tr>
                      <th class="py-2 font-normal">UTC day</th>
                      <th class="font-normal">Pageviews</th>
                      <th class="font-normal">Goals</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="day in report.trend"
                      :key="day.day"
                      class="border-t border-gray-100 dark:border-gray-800"
                    >
                      <th scope="row" class="py-2 font-normal">
                        {{ new Date(day.day).toISOString().slice(0, 10) }}
                      </th>
                      <td>{{ day.pageviews }}</td>
                      <td>{{ day.goals }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </details>
          </section>
          <div
            v-if="hasActivity"
            class="grid gap-8 border-t border-gray-200 pt-7 dark:border-gray-800 md:grid-cols-2"
          >
            <section
              class="min-w-0 space-y-4"
              aria-labelledby="sources-heading"
            >
              <div>
                <h2 id="sources-heading" class="font-semibold">
                  Sources & campaigns
                </h2>
                <p class="mt-1 text-xs text-gray-500">
                  Event touch · up to 20 sources
                </p>
              </div>
              <p v-if="!report.sources.length" class="text-sm text-gray-500">
                No source activity recorded in this range.
              </p>
              <div
                v-for="source in report.sources"
                :key="source.source + source.campaign"
                class="relative isolate overflow-hidden py-3 text-sm"
              >
                <span
                  aria-hidden="true"
                  class="bg-brand/5 dark:bg-brand/10 absolute inset-y-0 left-0 -z-10 rounded-r"
                  :style="{
                    width: `${
                      (100 * source.events) /
                      Math.max(...report.sources.map((item) => item.events), 1)
                    }%`
                  }"
                />
                <div class="flex items-baseline justify-between gap-4 px-3">
                  <span class="min-w-0 break-words"
                    >{{ source.source || 'Direct / unknown'
                    }}<span
                      v-if="source.campaign"
                      class="block text-xs text-gray-500"
                      >{{ source.campaign }}</span
                    ></span
                  ><span class="shrink-0 tabular-nums"
                    >{{ source.events }}
                    <span class="text-xs text-gray-500">{{
                      source.events === 1 ? 'event' : 'events'
                    }}</span></span
                  >
                </div>
              </div>
            </section>
            <section
              v-if="report.measurable"
              class="min-w-0 space-y-4"
              aria-labelledby="landing-heading"
            >
              <div>
                <h2 id="landing-heading" class="font-semibold">
                  First landing pages
                </h2>
                <p class="mt-1 text-xs text-gray-500">
                  Visitors first seen in this range
                </p>
              </div>
              <p v-if="!report.landing.length" class="text-sm text-gray-500">
                No new visitor landings in this range. Returning visitors may
                still be active.
              </p>
              <div
                v-for="landing in report.landing"
                :key="landing.path"
                class="flex justify-between gap-4 border-b border-gray-100 py-3 text-sm dark:border-gray-800"
              >
                <span class="min-w-0 break-all">{{ landing.path }}</span
                ><span class="shrink-0 tabular-nums"
                  >{{ landing.visitors }}
                  <span class="text-xs text-gray-500">visitors</span></span
                >
              </div>
            </section>
          </div>
          <div
            class="grid gap-8 border-t border-gray-200 pt-7 dark:border-gray-800 md:grid-cols-[1fr_1.2fr]"
          >
            <section class="min-w-0 space-y-4" aria-labelledby="goals-heading">
              <div class="flex items-baseline justify-between gap-3">
                <h2 id="goals-heading" class="font-semibold">Goals</h2>
                <span class="text-sm tabular-nums text-gray-500"
                  >{{ goalEvents }}
                  {{ goalEvents === 1 ? 'event' : 'events' }}</span
                >
              </div>
              <p
                v-if="!report.goals.length"
                class="text-sm leading-6 text-gray-500"
              >
                No goals in this range. Record a server signup after successful
                registration to measure conversion.
              </p>
              <div
                v-for="goal in report.goals"
                :key="goal.name + goal.provenance"
                class="flex flex-wrap justify-between gap-2 border-b border-gray-100 py-3 text-sm dark:border-gray-800"
              >
                <span class="min-w-0 break-all"
                  >{{ goal.name }}
                  <span class="text-xs text-gray-500"
                    >· {{ goal.provenance }}</span
                  ></span
                ><span class="tabular-nums"
                  >{{ goal.count }} {{ goal.count === 1 ? 'event' : 'events'
                  }}<span v-if="report.measurable" class="text-gray-500">
                    · {{ goal.visitors }}
                    {{ goal.visitors === 1 ? 'visitor' : 'visitors' }}</span
                  ></span
                >
              </div>
            </section>
            <section
              class="min-w-0 space-y-4"
              aria-labelledby="revenue-heading"
            >
              <div class="flex items-baseline justify-between gap-3">
                <h2 id="revenue-heading" class="font-semibold">Revenue</h2>
                <span class="text-xs text-gray-500"
                  >{{ filters.currency }} only</span
                >
              </div>
              <div>
                <p class="text-sm text-gray-500">Net revenue</p>
                <p
                  class="mt-1 text-3xl font-semibold tabular-nums tracking-tight"
                >
                  {{ money(report.revenue.net) }}
                </p>
              </div>
              <p
                v-if="!report.revenue.gross && !report.revenue.refunds"
                class="text-sm leading-6 text-gray-500"
              >
                No payments or refunds recorded in {{ filters.currency }} for
                this range. Record committed payments with Wake’s server
                helpers.
              </p>
              <dl class="grid grid-cols-2 gap-4 text-sm">
                <div
                  v-for="[label, value] in [
                    ['Gross', money(report.revenue.gross)],
                    ['Refunds', money(report.revenue.refunds)],
                    ['Unattributed net', money(report.revenue.unattributed)],
                    ['Paying visitors', report.revenue.paying ?? '—'],
                    [
                      'Revenue per visitor',
                      report.revenue.perVisitor == null
                        ? '—'
                        : money(report.revenue.perVisitor)
                    ]
                  ]"
                  :key="label"
                >
                  <dt class="text-xs text-gray-500">{{ label }}</dt>
                  <dd class="mt-1 font-medium tabular-nums">{{ value }}</dd>
                </div>
              </dl>
            </section>
          </div>
          <details
            class="border-t border-gray-200 pt-5 text-xs leading-6 text-gray-500 dark:border-gray-800"
          >
            <summary class="w-fit cursor-pointer">
              How these metrics are measured
            </summary>
            <div class="mt-3 max-w-3xl space-y-2">
              <p>
                Conversion: visitors with a server signup in this range ÷
                distinct visitors active in this range. Daily unique counts are
                never added together. A dash means the metric cannot be
                measured, not zero.
              </p>
              <p>
                Revenue includes committed receipts in this range, in one
                currency. Revenue per visitor uses net revenue attributed to
                this range’s active visitor cohort. Unattributed payments are
                included in totals; paying visitors excludes them.
              </p>
              <p>
                Sources show event-touch dimensions, not an attribution model.
                First and last touch are preserved in Journeys. Raw activity
                lasts 30 days; reporting records and receipts last thirteen
                months.
              </p>
            </div>
          </details>
        </template>
        <section v-if="tab === 'journeys' && !journeys" class="py-8">
          <h2 class="font-semibold">Journeys are unavailable</h2>
          <p class="mt-2 text-sm text-gray-500">
            Wake could not read visitor history. Check analytics storage and try
            again.
          </p>
          <Button :disabled="busy" class="mt-4" @click="navigate()"
            >Try again</Button
          >
        </section>
        <template v-if="tab === 'journeys' && journeys">
          <p class="text-sm text-gray-500">
            Anonymous visitor IDs. Latest 50 visitors; timelines show up to 200
            events and 200 receipts in the selected range. Raw activity lasts 30
            days; receipts last thirteen months.
          </p>
          <Alert v-if="app.wakeSettings?.mode === 'cookieless'" :class="alert"
            >Journeys are unavailable in cookieless mode.</Alert
          >
          <div
            v-if="app.wakeSettings?.mode !== 'cookieless'"
            class="grid gap-8 md:grid-cols-[240px_1fr]"
          >
            <nav aria-label="Visitors" class="min-w-0 space-y-2">
              <Link
                v-for="person in journeys.visitors"
                :key="person.visitor_id"
                :href="base + '/wake'"
                :data="query('journeys', person.visitor_id)"
                class="block min-w-0 rounded border border-gray-200 p-3 text-sm dark:border-gray-800"
                :aria-current="
                  visitor === person.visitor_id ? 'page' : undefined
                "
                ><span class="block truncate">{{ person.visitor_id }}</span
                ><span class="text-xs text-gray-500">{{
                  date(person.last_at)
                }}</span></Link
              >
              <p v-if="!journeys.visitors.length" class="text-sm text-gray-500">
                No measurable visitors in this range. Check collection readiness
                or choose another date range.
              </p>
            </nav>
            <section class="min-w-0 space-y-4">
              <template v-if="visitor"
                ><h2 class="break-all text-sm font-medium">{{ visitor }}</h2>
                <div
                  v-for="person in journeys.visitors.filter(
                    (p) => p.visitor_id === visitor
                  )"
                  :key="person.visitor_id"
                  class="space-y-1 break-all text-xs text-gray-500"
                >
                  <p>
                    First touch: {{ JSON.parse(person.first_touch).path }} ·
                    {{
                      JSON.parse(person.first_touch).campaign?.utm_source ||
                      'Direct'
                    }}
                  </p>
                  <p>
                    Last touch: {{ JSON.parse(person.last_touch).path }} ·
                    {{
                      JSON.parse(person.last_touch).campaign?.utm_source ||
                      'Direct'
                    }}
                  </p>
                </div>
                <div
                  v-for="(event, index) in [
                    ...journeys.events,
                    ...journeys.receipts
                  ].sort((a, b) => a.occurred_at - b.occurred_at)"
                  :key="index"
                  class="border-l border-gray-200 py-2 pl-4 text-sm dark:border-gray-700"
                >
                  <p class="text-xs text-gray-500">
                    {{ date(event.occurred_at) }}
                  </p>
                  <p class="break-all">
                    {{ event.path || event.transaction_id }} ·
                    {{
                      event.name || (event.adjustment_id ? 'Refund' : 'Payment')
                    }}
                  </p>
                  <p class="text-xs text-gray-500">
                    {{
                      event.provenance ||
                      `${event.amount} minor units · ${event.currency}`
                    }}
                  </p>
                </div>
                <p
                  v-if="!journeys.events.length && !journeys.receipts.length"
                  class="text-sm text-gray-500"
                >
                  No retained timeline events or receipts in this range. Raw
                  activity expires after 30 days.
                </p>
                <Button
                  v-if="canManage"
                  class="border border-red-200 bg-transparent text-red-600 dark:bg-transparent dark:text-red-400"
                  @click="confirmDelete = true"
                  >Delete visitor history</Button
                ></template
              >
              <p v-else class="text-sm text-gray-500">
                Choose a visitor to inspect their journey.
              </p>
            </section>
          </div>
        </template>
        <form
          v-if="tab === 'settings'"
          class="max-w-2xl space-y-6"
          @submit.prevent="save"
        >
          <div>
            <h2 class="font-semibold">Collection & privacy</h2>
            <p class="mt-2 text-sm leading-6 text-gray-500">
              Choose what Wake can collect. Saving while enabled rotates the
              collection credential and requires an app redeploy.
            </p>
          </div>
          <label class="flex items-center justify-between gap-4"
            ><span
              ><span class="block font-medium">Enable Wake</span
              ><span class="text-sm text-gray-500"
                >Separate from Lookout. Changes require an app redeploy.</span
              ></span
            ><Switch
              v-model="enabled"
              aria-label="Enable Wake"
              :disabled="!canManage || busy"
          /></label>
          <label class="block text-sm"
            >Privacy mode<BareSelect
              v-model="mode"
              aria-label="Privacy mode"
              :disabled="!canManage || busy"
              :class="field"
              :options="[
                { value: 'first-party', label: 'First-party visitors' },
                { value: 'cookieless', label: 'Cookieless events' }
              ]"
          /></label>
          <label class="flex items-center justify-between gap-4 text-sm"
            >Require consent before collection<Switch
              v-model="consent"
              aria-label="Require consent"
              :disabled="!canManage || busy"
          /></label>
          <label class="flex items-center justify-between gap-4 text-sm"
            >Respect GPC and Do Not Track<Switch
              v-model="privacy"
              aria-label="Respect privacy signals"
              :disabled="!canManage || busy"
          /></label>
          <label class="block text-sm"
            >Additional allowed origins<Textarea
              v-model="origins"
              aria-label="Additional allowed origins"
              :disabled="!canManage || busy"
              :class="field"
              placeholder="https://example.com"
            /><span class="text-xs text-gray-500"
              >App domains are included automatically. One exact origin per
              line.</span
            ></label
          >
          <label class="block text-sm"
            >Excluded paths<Textarea
              v-model="exclusions"
              aria-label="Excluded paths"
              :disabled="!canManage || busy"
              :class="field"
              placeholder="/account/*"
            /><span class="text-xs text-gray-500"
              >One path per line. A final * matches a prefix.</span
            ></label
          >
          <p class="text-sm text-gray-500">
            Retention: 30 days of raw activity and thirteen months (396 days) of
            reporting records and payment receipts. Disabling collection
            preserves retained history. Visitor deletion removes linkable
            history and detaches receipts; anonymous event totals remain.
          </p>
          <dl
            v-if="report"
            class="grid grid-cols-2 gap-3 border-t border-gray-200 pt-4 text-sm dark:border-gray-800"
          >
            <dt>Hook version</dt>
            <dd>{{ state.hookVersion || 'Not connected' }}</dd>
            <dt>Received / duplicates</dt>
            <dd>
              {{ report.health.received || 0 }} /
              {{ report.health.duplicates || 0 }}
            </dd>
            <dt>Rejected / dropped</dt>
            <dd>
              {{ report.health.rejected || 0 }} /
              {{ report.health.dropped || 0 }}
            </dd>
            <dt>Failed delivery</dt>
            <dd>{{ report.health.failed_delivery || 0 }}</dd>
            <dt>Oldest raw activity</dt>
            <dd>{{ date(report.health.oldestRawAt) }}</dd>
            <dt>Last maintenance</dt>
            <dd>{{ date(report.health.last_maintenance_at) }}</dd>
            <dt>Analytics database, host-wide</dt>
            <dd>{{ (report.health.hostBytes / 1048576).toFixed(1) }} MiB</dd>
          </dl>
          <div v-if="canManage" class="flex justify-end">
            <Button type="submit" :disabled="busy">{{
              busy ? 'Saving…' : 'Save settings'
            }}</Button>
          </div>
        </form>
      </div>
    </main>
    <Dialog
      :open="confirmDelete"
      aria-labelledby="delete-wake-title"
      :dismissible="!busy"
      class="w-[calc(100%_-_2rem)] max-w-md rounded-lg border border-gray-200 bg-white p-6 text-gray-950 backdrop:bg-black/50 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
      @update:open="(value) => (confirmDelete = value)"
      ><Alert v-if="error" role="alert" :class="alert">{{ error }}</Alert>
      <h2 id="delete-wake-title" class="font-semibold">
        Delete visitor history?
      </h2>
      <p class="my-4 text-sm text-gray-500">
        This removes linkable activity and detaches revenue attribution.
        Anonymous aggregate totals and payment receipts remain.
      </p>
      <div class="flex justify-end gap-2">
        <Button
          type="button"
          :disabled="busy"
          class="bg-transparent text-gray-600 dark:bg-transparent dark:text-gray-300"
          @click="confirmDelete = false"
          >Cancel</Button
        ><Button
          type="button"
          :disabled="busy"
          class="bg-red-600 text-white"
          @click="removeVisitor"
          >Delete history</Button
        >
      </div></Dialog
    >
  </div>
</template>
