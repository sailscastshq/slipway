<script setup>
import { Head, useForm } from '@inertiajs/vue3'
const props = defineProps({
  appName: String,
  updatesPath: String,
  postPath: String,
  done: Boolean
})
const form = useForm({
  token: new URL(window.location.href).searchParams.get('token') || ''
})
function unsubscribe() {
  form.post(`${props.postPath}?token=${encodeURIComponent(form.token)}`, {
    preserveScroll: true
  })
}
</script>
<template>
  <Head :title="`Update emails · ${appName}`" />
  <main
    class="min-h-screen bg-white px-6 py-20 text-gray-950 dark:bg-gray-950 dark:text-white"
  >
    <div class="mx-auto max-w-lg">
      <h1 class="text-3xl font-semibold">
        {{ done ? 'You are unsubscribed' : 'Stop update emails?' }}
      </h1>
      <p class="mt-4 text-gray-500">
        {{
          done
            ? `You will not receive new ${appName} update emails. You can opt in again from Updates.`
            : `Unsubscribe from ${appName} update emails. This applies only to this app.`
        }}
      </p>
      <form v-if="!done" class="mt-8" @submit.prevent="unsubscribe">
        <button
          class="min-h-11 rounded-lg bg-gray-950 px-5 text-white dark:bg-white dark:text-gray-950"
          :disabled="form.processing"
        >
          {{ form.processing ? 'Saving…' : 'Unsubscribe' }}
        </button>
        <p v-if="form.hasErrors" role="alert" class="mt-4 text-red-600">
          Could not unsubscribe. Please try again.
        </p>
      </form>
      <a :href="updatesPath" class="mt-8 inline-block underline">All updates</a>
    </div>
  </main>
</template>
