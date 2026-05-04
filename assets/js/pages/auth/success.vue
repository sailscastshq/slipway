<script setup>
import { Link, Head } from '@inertiajs/vue3'
import SlipwayLogo from '@/components/SlipwayLogo.vue'

const props = defineProps({
  pageTitle: {
    type: String
  },
  pageHeading: {
    type: String
  },
  message: {
    type: String
  }
})
</script>

<template>
  <Head :title="`${props.pageTitle} | Slipway`" />

  <div
    class="flex min-h-screen flex-col items-center justify-center bg-white px-4 dark:bg-black"
  >
    <main class="w-full max-w-sm">
      <section class="mb-8 text-center">
        <Link href="/" class="mb-2 inline-flex flex-col items-center gap-3">
          <SlipwayLogo
            :animated="false"
            class="h-12 w-12 text-[#0284c7] dark:text-white"
          />
          <h1
            class="text-2xl font-semibold tracking-tight text-gray-900 dark:text-white"
          >
            Slipway
          </h1>
        </Link>
      </section>

      <section aria-labelledby="success-heading" class="space-y-6 text-center">
        <div class="space-y-3">
          <h2
            id="success-heading"
            class="text-xl font-semibold tracking-tight text-gray-900 dark:text-white"
          >
            {{ props.pageHeading }}
          </h2>
          <p class="text-sm leading-6 text-gray-500 dark:text-gray-400">
            {{ props.message }}
          </p>
        </div>

        <Link
          href="/"
          class="flex h-12 w-full items-center justify-center rounded-md border border-gray-200 bg-gray-900 font-medium text-white transition-colors hover:bg-gray-800 dark:border-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-100"
        >
          Continue
        </Link>
      </section>
    </main>
  </div>
</template>
