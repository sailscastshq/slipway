<script setup>
import DateInput from '@/components/DateInput.vue'
import { computed, inject, ref, watch } from 'vue'
import { Head, Link, router } from '@inertiajs/vue3'
import AppLayout from '@/layouts/AppLayout.vue'
import Breadcrumb from '@/components/ui/breadcrumb/Breadcrumb.vue'
import Tabs from '@/components/ui/tabs/Tabs.vue'
import Alert from '@/components/ui/alert/Alert.vue'
import Button from '@/components/ui/button/Button.vue'
import Input from '@/components/ui/input/Input.vue'
import Select from '@/components/ui/select/Select.vue'
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
const stateText = computed(
  () =>
    ({
      disabled: 'Wake is off. Enable it in Settings, then redeploy the app.',
      waiting_for_runtime:
        'Waiting for redeploy. Install sails-hook-slipway 0.0.10 or later and redeploy this app.',
      foundation_only:
        'Update required. Install the supported hook and redeploy.',
      unavailable:
        'Collection is unavailable. Retained totals may be incomplete; check the app connection and analytics storage.'
    }[props.state?.state])
)
const query = (tab = props.tab, visitor = '') => ({
  tab,
  from: from.value,
  to: to.value,
  currency: currency.value,
  ...(visitor ? { visitor } : {})
})
function navigate(tab = props.tab) {
  busy.value = true
  router.get(base + '/wake', query(tab), {
    preserveScroll: true,
    onFinish: () => (busy.value = false)
  })
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
        ['Visitors', props.report.visitors ?? 'Unavailable'],
        ['Sessions', props.report.sessions ?? 'Unavailable'],
        [
          'Signup visitors',
          props.report.measurable ? props.report.signups : 'Unavailable'
        ],
        [
          'Signup conversion',
          props.report.conversion == null
            ? 'Unavailable'
            : (100 * props.report.conversion).toFixed(1) + '%'
        ]
      ]
    : []
)
async function save() {
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    const response = await fetch(base + '/wake/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
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
    })
    if (!response.ok)
      throw Error('Settings could not be saved. Your edits are still here.')
    notice.value = enabled.value
      ? 'Saved. Redeploy this app to activate the new settings.'
      : 'Saved. New collection is disabled; retained history remains.'
    router.reload({ only: ['state', 'app'] })
  } catch (e) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}
async function removeVisitor() {
  busy.value = true
  error.value = ''
  try {
    const response = await fetch(
      base + '/wake/visitors/' + encodeURIComponent(props.visitor),
      { method: 'DELETE' }
    )
    if (!response.ok)
      throw Error(
        'Visitor history could not be deleted. Retry after checking storage.'
      )
    confirmDelete.value = false
    router.get(base + '/wake', query('journeys'))
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
    </header>
    <main
      class="min-w-0 flex-1 overflow-y-auto px-4 py-8 text-gray-950 dark:text-white sm:px-8"
    >
      <div class="mx-auto max-w-5xl space-y-6">
        <div>
          <h1 class="text-xl font-semibold">Wake</h1>
          <p class="mt-1 text-sm text-gray-500">
            Acquisition, activity, and revenue for {{ app.name }} ·
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
                ? 'border-gray-950 font-medium dark:border-white'
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
        <Alert v-if="stateText" :class="alert">{{ stateText }}</Alert>
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
          class="grid grid-cols-2 items-end gap-4 sm:flex"
          @submit.prevent="navigate()"
        >
          <label class="min-w-0 text-sm"
            >From (UTC)<DateInput
              v-model="from"
              aria-label="From (UTC)"
              type="date"
              required
              :class="[field, 'dark:[color-scheme:dark]']"
          /></label>
          <label class="min-w-0 text-sm"
            >Through (UTC)<DateInput
              v-model="to"
              aria-label="Through (UTC)"
              type="date"
              required
              :class="[field, 'dark:[color-scheme:dark]']"
          /></label>
          <label class="min-w-0 text-sm"
            >Currency<Select
              v-model="currency"
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
        <template v-if="tab === 'overview' && report">
          <Alert v-if="!report.measurable" :class="alert"
            >Cookieless mode reports events and revenue. Persistent visitors,
            conversion, and journeys are unavailable.</Alert
          >
          <p
            v-if="
              !report.trend.some((day) => day.pageviews || day.goals) &&
              !report.revenue.gross
            "
            class="py-8 text-center text-sm text-gray-500"
          >
            No activity recorded in this date range. Goals and payments require
            explicit app helpers.
          </p>
          <dl
            class="grid grid-cols-2 gap-6 border-y border-gray-200 py-6 dark:border-gray-800 sm:grid-cols-4"
          >
            <div v-for="[label, value] in metrics" :key="label">
              <dt class="text-sm text-gray-500">{{ label }}</dt>
              <dd class="mt-2 text-2xl font-semibold">{{ value }}</dd>
            </div>
          </dl>
          <p class="text-xs text-gray-500">
            Conversion: visitors with a server signup in this range ÷ distinct
            visitors active in this range. Daily unique counts are never added
            together.
          </p>
          <section class="space-y-4">
            <h2 class="font-semibold">Revenue · {{ filters.currency }}</h2>
            <dl class="grid grid-cols-2 gap-5 sm:grid-cols-3">
              <div
                v-for="[label, value] in [
                  ['Gross', money(report.revenue.gross)],
                  ['Refunds', money(report.revenue.refunds)],
                  ['Net', money(report.revenue.net)],
                  ['Unattributed net', money(report.revenue.unattributed)],
                  ['Paying visitors', report.revenue.paying ?? 'Unavailable'],
                  ['Revenue per visitor', money(report.revenue.perVisitor)]
                ]"
                :key="label"
              >
                <dt class="text-sm text-gray-500">{{ label }}</dt>
                <dd class="mt-1 text-lg font-medium">{{ value }}</dd>
              </div>
            </dl>
            <p class="text-xs text-gray-500">
              Committed receipts in this range. Revenue per visitor uses net
              revenue attributed to this range’s visitor cohort. Currencies
              remain separate. Unattributed payments are included in totals;
              paying visitors excludes them.
            </p>
          </section>
          <section class="space-y-3">
            <h2 class="font-semibold">Activity by day</h2>
            <LineChart
              v-if="report.trend.length"
              :data="
                report.trend.map((day) => ({
                  label: new Date(day.day).toISOString().slice(0, 10),
                  value: day.pageviews
                }))
              "
              caption="Daily recorded pageviews · UTC"
              class="text-brand"
            />
            <div class="max-h-72 overflow-auto">
              <table class="w-full text-left text-sm">
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
                    <td class="py-2">
                      {{ new Date(day.day).toISOString().slice(0, 10) }}
                    </td>
                    <td>{{ day.pageviews }}</td>
                    <td>{{ day.goals }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
          <section class="space-y-3">
            <h2 class="font-semibold">Goals</h2>
            <p v-if="!report.goals.length" class="text-sm text-gray-500">
              No goals yet. Emit signup once from your server after successful
              signup.
            </p>
            <div
              v-for="goal in report.goals"
              :key="goal.name + goal.provenance"
              class="flex flex-wrap justify-between gap-2 border-b border-gray-100 py-2 text-sm dark:border-gray-800"
            >
              <span class="min-w-0 break-all"
                >{{ goal.name }}
                <span class="text-gray-500">· {{ goal.provenance }}</span></span
              ><span
                >{{ goal.count }} events ·
                {{ goal.visitors ?? 'Unavailable' }} visitors</span
              >
            </div>
          </section>
          <section class="space-y-3">
            <h2 class="font-semibold">Sources and campaigns</h2>
            <p class="text-xs text-gray-500">
              Event-touch dimensions; first and last touch are preserved in
              Journeys.
            </p>
            <div
              v-for="source in report.sources"
              :key="source.source + source.campaign"
              class="flex justify-between gap-4 border-b border-gray-100 py-2 text-sm dark:border-gray-800"
            >
              <span class="min-w-0 break-all"
                >{{ source.source
                }}<span v-if="source.campaign" class="text-gray-500">
                  · {{ source.campaign }}</span
                ></span
              ><span class="shrink-0">{{ source.events }} events</span>
            </div>
          </section>
          <section v-if="report.measurable" class="space-y-3">
            <h2 class="font-semibold">First landing pages</h2>
            <div
              v-for="landing in report.landing"
              :key="landing.path"
              class="flex justify-between gap-4 text-sm"
            >
              <span class="min-w-0 break-all">{{ landing.path }}</span
              ><span class="shrink-0">{{ landing.visitors }} visitors</span>
            </div>
          </section>
        </template>
        <template v-if="tab === 'journeys' && journeys">
          <p class="text-sm text-gray-500">
            Anonymous visitor IDs. Latest 50 visitors; timelines show up to 200
            events and 200 receipts in the selected range. Raw activity lasts 30
            days; receipts last thirteen months.
          </p>
          <Alert v-if="app.wakeSettings?.mode === 'cookieless'" :class="alert"
            >Journeys are unavailable in cookieless mode.</Alert
          >
          <div class="grid gap-8 md:grid-cols-[240px_1fr]">
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
                No measurable visitors in this range.
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
            >Privacy mode<Select
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
