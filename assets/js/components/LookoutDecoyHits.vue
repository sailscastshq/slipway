<script setup>
import { computed } from 'vue'
import { useQueryState } from '@/components/ui/durable-ui/useQueryState'
const props = defineProps({ summary: Object })
const app = useQueryState('decoyApp', '')
const path = useQueryState('decoyPath', '')
const apps = computed(() => [
  ...new Map(props.summary.groups.map((g) => [g.appId, g.appName]))
])
const paths = computed(() => [
  ...new Set(props.summary.groups.map((g) => g.path))
])
const rows = computed(() =>
  props.summary.groups.filter(
    (g) =>
      (!app.value || app.value === g.appId) &&
      (!path.value || path.value === g.path)
  )
)
</script>
<template>
  <section class="space-y-6" aria-labelledby="decoy-hits-heading">
    <div>
      <h2
        id="decoy-hits-heading"
        class="text-lg font-semibold text-gray-900 dark:text-white"
      >
        Decoy hits
      </h2>
      <p
        class="mt-2 max-w-2xl text-sm leading-relaxed text-gray-500 dark:text-gray-400"
      >
        {{ summary.window }} · sampled observations, usually collected every
        five minutes. Busy installations can take longer. Decoy responses are
        separate from app successes, errors and latency. A hit records a probe;
        it does not identify an attacker.
      </p>
      <p v-if="summary.capped" class="mt-2 text-xs text-gray-500">
        Showing the latest 1,000 observations.
      </p>
    </div>
    <div class="flex flex-wrap gap-4">
      <label class="space-y-1 text-xs text-gray-500 dark:text-gray-400"
        >App
        <select
          v-model="app"
          aria-label="App"
          class="focus:border-brand dark:focus:border-brand block max-w-full rounded-none border-0 border-b border-dashed border-gray-200 bg-transparent px-1 py-2 text-sm text-gray-900 shadow-none focus:outline-none dark:border-gray-700 dark:bg-transparent dark:text-white"
        >
          <option value="">All apps</option>
          <option v-for="[id, name] in apps" :key="id" :value="id">
            {{ name }}
          </option>
        </select>
      </label>
      <label class="space-y-1 text-xs text-gray-500 dark:text-gray-400"
        >Path
        <select
          v-model="path"
          aria-label="Path"
          class="focus:border-brand dark:focus:border-brand block max-w-full rounded-none border-0 border-b border-dashed border-gray-200 bg-transparent px-1 py-2 text-sm text-gray-900 shadow-none focus:outline-none dark:border-gray-700 dark:bg-transparent dark:text-white"
        >
          <option value="">All paths</option>
          <option v-for="p in paths" :key="p" :value="p">{{ p }}</option>
        </select>
      </label>
    </div>
    <div v-if="rows.length" class="hidden overflow-x-auto sm:block">
      <table class="w-full whitespace-nowrap text-left text-sm">
        <caption class="sr-only">
          Observed decoy probes in the last hour
        </caption>
        <thead
          class="border-b border-gray-200 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400"
        >
          <tr>
            <th class="py-3 pr-6">Event / app</th>
            <th class="py-3 pr-6">Path</th>
            <th class="py-3 pr-6">HTTP</th>
            <th class="py-3 pr-6">Observed</th>
            <th class="py-3">Last seen</th>
          </tr>
        </thead>
        <tbody
          class="divide-y divide-gray-100 text-gray-700 dark:divide-gray-800 dark:text-gray-300"
        >
          <tr
            v-for="row in rows"
            :key="`${row.appId}:${row.path}:${row.method}:${row.statusCode}`"
          >
            <td class="py-4 pr-6">
              <span class="font-medium">Decoy hit</span
              ><span class="mt-1 block text-xs text-gray-500">{{
                row.appName
              }}</span>
            </td>
            <td class="py-4 pr-6">
              <code>{{ row.path }}</code>
            </td>
            <td class="py-4 pr-6">{{ row.method }} · {{ row.statusCode }}</td>
            <td class="py-4 pr-6">{{ row.observed }}</td>
            <td class="py-4">
              {{ new Date(row.lastSeenAt).toLocaleString() }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <ul
      v-if="rows.length"
      class="divide-y divide-gray-200 dark:divide-gray-800 sm:hidden"
      aria-label="Decoy observations"
    >
      <li
        v-for="row in rows"
        :key="`${row.appId}:${row.path}:${row.method}:${row.statusCode}`"
        class="space-y-3 py-5"
      >
        <div class="flex items-center justify-between gap-4 text-sm">
          <span class="font-medium text-gray-900 dark:text-white"
            >Decoy hit
            <span class="ml-1 font-normal text-gray-500"
              >· {{ row.appName }}</span
            ></span
          ><span class="text-gray-500 dark:text-gray-400"
            >{{ row.observed }} observed</span
          >
        </div>
        <code
          class="block break-all text-sm text-gray-700 dark:text-gray-300"
          >{{ row.path }}</code
        >
        <div
          class="flex flex-wrap justify-between gap-2 text-xs text-gray-500 dark:text-gray-400"
        >
          <span>{{ row.method }} · HTTP {{ row.statusCode }}</span
          ><time :datetime="new Date(row.lastSeenAt).toISOString()">{{
            new Date(row.lastSeenAt).toLocaleString()
          }}</time>
        </div>
      </li>
    </ul>
    <p
      v-if="!rows.length"
      class="py-12 text-sm text-gray-500 dark:text-gray-400"
    >
      No decoy observations match this view. Configure verified-unused paths in
      App settings → Lookout Decoys.
    </p>
  </section>
</template>
