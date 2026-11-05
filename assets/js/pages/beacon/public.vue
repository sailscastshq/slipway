<script setup>
import { Head } from '@inertiajs/vue3'
import AppAppearance from '@/components/appearance/AppAppearance.vue'
import AppBrand from '@/components/appearance/AppBrand.vue'
import StatusOnline from '@/components/ui/icons/StatusOnline.vue'
import ArrowRight from '@/components/ui/icons/ArrowRight.vue'
defineProps({ appearance: Object, app: Object, availability: Object })
</script>

<template>
  <Head :title="`Status · ${app.name}`">
    <link
      v-if="appearance?.stylesheet"
      rel="stylesheet"
      :href="appearance.stylesheet"
    />
    <meta
      name="description"
      :content="`Public service status for ${app.name}. Availability has not yet been observed.`"
    />
  </Head>
  <AppAppearance :appearance="appearance">
    <div
      class="min-h-screen bg-white text-gray-950 dark:bg-gray-950 dark:text-white"
    >
      <div class="mx-auto max-w-3xl px-6 sm:px-10">
        <header class="flex items-center justify-between gap-6 py-7">
          <a
            :href="app.homePath"
            class="focus-visible:outline-brand min-w-0 text-lg font-semibold focus-visible:outline-2"
            ><AppBrand :appearance="appearance" :name="app.name"
          /></a>
          <span class="flex shrink-0 items-center gap-2 text-xs text-gray-500"
            ><StatusOnline class="h-4 w-4" /> Beacon</span
          >
        </header>
        <main class="pb-12 pt-14 sm:pt-20">
          <p
            class="text-xs font-medium uppercase tracking-widest text-gray-500"
          >
            Service status
          </p>
          <h1
            class="mt-5 flex items-center gap-3 text-4xl font-semibold tracking-tight sm:text-5xl"
          >
            <span
              class="h-3 w-3 shrink-0 rounded-full bg-gray-400 dark:bg-gray-600"
            />
            Unknown
          </h1>
          <p class="mt-5 max-w-lg text-base leading-7 text-gray-500">
            Availability has not yet been observed. An independent checker is
            not connected, so this page cannot confirm whether the service is up
            or down.
          </p>
          <dl class="mt-10 grid grid-cols-2 gap-6">
            <div>
              <dt class="text-xs text-gray-500">Last checked</dt>
              <dd class="mt-2 text-sm font-medium">No observations yet</dd>
            </div>
            <div>
              <dt class="text-xs text-gray-500">Last successful check</dt>
              <dd class="mt-2 text-sm font-medium">No observations yet</dd>
            </div>
          </dl>
          <section class="mt-12" aria-labelledby="coverage-heading">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <h2 id="coverage-heading" class="text-sm font-semibold">
                Check coverage
              </h2>
              <span class="text-xs text-gray-500">Not collecting</span>
            </div>
            <p class="mt-3 text-xs text-gray-500">
              Missing observations are Unknown, never uptime.
            </p>
          </section>
          <section class="mt-12" aria-labelledby="incidents-heading">
            <h2 id="incidents-heading" class="text-sm font-semibold">
              Incident history
            </h2>
            <p class="mt-3 text-sm leading-6 text-gray-500">
              No incident history is available. Monitoring has not started; this
              is not confirmation of an incident-free service.
            </p>
          </section>
          <a
            :href="app.homePath"
            class="min-h-11 hover:text-brand focus-visible:outline-brand mt-9 inline-flex items-center gap-2 text-sm font-medium transition-colors focus-visible:outline-2 motion-reduce:transition-none"
            >Return to {{ app.name }} <ArrowRight class="h-4 w-4"
          /></a>
        </main>
        <footer class="py-6 text-xs text-gray-500">
          Status provided by Beacon · Slipway
        </footer>
      </div>
    </div>
  </AppAppearance>
</template>
