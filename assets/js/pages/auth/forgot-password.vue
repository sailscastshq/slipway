<script setup>
import { Link, Head, useForm } from '@inertiajs/vue3'
import { computed } from 'vue'
import SlipwayLogo from '@/components/SlipwayLogo.vue'
import SlippyLoader from '@/components/SlippyLoader.vue'

const form = useForm({
  email: ''
})

const isFormValid = computed(() => {
  const emailRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,4}$/
  return emailRegex.test(form.email) && !form.processing
})
</script>

<template>
  <Head title="Forgot password | Slipway" />

  <div
    class="flex min-h-screen flex-col items-center justify-center bg-white px-4 dark:bg-black"
  >
    <div class="w-full max-w-sm">
      <!-- Logo -->
      <div class="mb-8 text-center">
        <Link href="/" class="mb-2 inline-flex flex-col items-center gap-3">
          <SlipwayLogo
            :processing="form.processing"
            class="h-12 w-12 text-[#0284c7] dark:text-white"
          />
          <h1
            class="text-2xl font-semibold tracking-tight text-gray-900 dark:text-white"
          >
            Slipway
          </h1>
        </Link>
        <p class="text-sm text-gray-500">Reset your password</p>
      </div>

      <!-- Error message -->
      <div
        v-if="form.errors.email"
        class="mb-6 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400"
      >
        {{ form.errors.email }}
      </div>

      <form @submit.prevent="form.post('/forgot-password')" class="space-y-4">
        <div>
          <input
            id="email"
            v-model="form.email"
            type="email"
            placeholder="Enter your email address..."
            autocomplete="email"
            class="focus:border-brand h-12 w-full border-b border-dashed border-gray-200 bg-transparent px-1 text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
          />
          <p class="mt-2 text-xs text-gray-500">
            We'll send reset instructions to this email
          </p>
        </div>

        <button
          type="submit"
          :disabled="!isFormValid"
          class="flex h-12 w-full items-center justify-center gap-2 rounded-md border border-gray-200 bg-gray-900 font-medium text-white transition-colors hover:bg-gray-800 disabled:bg-gray-100 disabled:text-gray-400 dark:border-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-100 dark:disabled:bg-gray-900 dark:disabled:text-gray-600"
        >
          <SlippyLoader v-if="form.processing" size="h-4 w-4" />
          <span>{{ form.processing ? 'Sending...' : 'Send reset link' }}</span>
        </button>
      </form>

      <div class="mt-6 text-center">
        <Link
          href="/login"
          class="text-sm text-gray-500 transition-colors hover:text-gray-900 dark:hover:text-white"
        >
          Back to login
        </Link>
      </div>
    </div>
  </div>
</template>
