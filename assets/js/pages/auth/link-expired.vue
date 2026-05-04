<script setup>
import { Link, Head } from '@inertiajs/vue3'
import SlipwayLogo from '@/components/SlipwayLogo.vue'
</script>

<template>
  <Head title="Link expired | Slipway" />

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

      <section aria-labelledby="expired-heading" class="space-y-6 text-center">
        <div class="space-y-3">
          <h2
            id="expired-heading"
            class="text-xl font-semibold tracking-tight text-gray-900 dark:text-white"
          >
            Link expired
          </h2>
          <p class="text-sm leading-6 text-gray-500 dark:text-gray-400">
            That link is no longer valid. Request a fresh one to continue.
          </p>
        </div>

        <Link
          href="/resend-link"
          class="flex h-12 w-full items-center justify-center rounded-md border border-gray-200 bg-gray-900 font-medium text-white transition-colors hover:bg-gray-800 dark:border-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-100"
        >
          Send a new link
        </Link>
      </section>

      <div class="mt-6 text-center">
        <Link
          href="/login"
          class="text-sm text-gray-500 transition-colors hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
        >
          Back to login
        </Link>
      </div>
    </main>
  </div>
</template>
