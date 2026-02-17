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

  <div class="min-h-screen bg-white dark:bg-black flex flex-col items-center justify-center px-4">
    <div class="w-full max-w-sm">
      <!-- Logo -->
      <div class="text-center mb-8">
        <Link href="/" class="inline-flex flex-col items-center gap-3 mb-2">
          <SlipwayLogo :processing="form.processing" class="h-12 w-12 text-[#0284c7] dark:text-white" />
          <h1 class="text-2xl font-semibold text-gray-900 dark:text-white tracking-tight">Slipway</h1>
        </Link>
        <p class="text-gray-500 text-sm">Reset your password</p>
      </div>

      <!-- Error message -->
      <div
        v-if="form.errors.email"
        class="mb-6 p-3 rounded-md bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 text-sm"
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
            class="w-full h-12 px-1 bg-transparent border-b border-dashed border-gray-200 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-brand dark:border-gray-700"
          />
          <p class="mt-2 text-xs text-gray-500">We'll send reset instructions to this email</p>
        </div>

        <button
          type="submit"
          :disabled="!isFormValid"
          class="w-full h-12 bg-gray-900 dark:bg-white hover:bg-gray-800 dark:hover:bg-gray-100 disabled:bg-gray-100 dark:disabled:bg-gray-900 disabled:text-gray-400 dark:disabled:text-gray-600 text-white dark:text-black font-medium rounded-md transition-colors flex items-center justify-center gap-2 border border-gray-200 dark:border-gray-800"
        >
          <SlippyLoader v-if="form.processing" size="h-4 w-4" />
          <span>{{ form.processing ? 'Sending...' : 'Send reset link' }}</span>
        </button>
      </form>

      <div class="mt-6 text-center">
        <Link href="/login" class="text-sm text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors">
          Back to login
        </Link>
      </div>
    </div>
  </div>
</template>
