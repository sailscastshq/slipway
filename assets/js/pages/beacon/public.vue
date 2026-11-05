<script setup>
import { Head } from '@inertiajs/vue3'
import BeaconStatus from '@/components/beacon/BeaconStatus.vue'
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
  <BeaconStatus :appearance="appearance" :app="app" />
</template>
