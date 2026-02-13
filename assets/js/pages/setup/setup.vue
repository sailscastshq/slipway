<script setup>
import { Head, useForm } from '@inertiajs/vue3'
import { computed } from 'vue'
import SlipwayLogo from '@/components/SlipwayLogo.vue'

const form = useForm({
  email: '',
  password: '',
  confirmPassword: ''
})

const containsSpecialChars = computed(() => {
  const specialChars = /[`!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~]/
  return specialChars.test(form.password)
})

const passwordIsValid = computed(() => {
  return form.password?.length >= 8
})

const passwordsMatch = computed(() => {
  return form.password && form.password === form.confirmPassword
})

const emailIsValid = computed(() => {
  const emailRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,4}$/
  return emailRegex.test(form.email)
})

const isFormValid = computed(() => {
  return emailIsValid.value && passwordIsValid.value && containsSpecialChars.value && passwordsMatch.value && !form.processing
})
</script>

<template>
  <Head title="Setup | Slipway" />

  <div class="min-h-screen bg-white dark:bg-black flex flex-col items-center justify-center px-4">
    <div class="w-full max-w-sm">
      <!-- Logo -->
      <div class="text-center mb-8">
        <div class="inline-flex flex-col items-center gap-3 mb-2">
          <SlipwayLogo :processing="form.processing" class="h-12 w-12 text-[#0284c7] dark:text-white" />
          <h1 class="text-2xl font-semibold text-gray-900 dark:text-white tracking-tight">Slipway</h1>
        </div>
        <p class="text-gray-500 text-sm">Create an admin account to get started</p>
      </div>

      <!-- Error message -->
      <div
        v-if="form.errors.email || form.errors.password || form.errors.setup"
        class="mb-6 p-3 rounded-md bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 text-sm"
      >
        {{ form.errors.email || form.errors.password || form.errors.setup }}
      </div>

      <form @submit.prevent="form.post('/setup')" class="space-y-4">
        <input
          id="email"
          v-model="form.email"
          type="email"
          placeholder="Enter your email address..."
          autocomplete="email"
          class="w-full h-12 px-4 bg-white dark:bg-black border border-gray-200 dark:border-gray-800 rounded-md text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-brand"
        />

        <input
          id="password"
          v-model="form.password"
          type="password"
          placeholder="Create a password"
          autocomplete="new-password"
          class="w-full h-12 px-4 bg-white dark:bg-black border border-gray-200 dark:border-gray-800 rounded-md text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-brand"
        />

        <input
          id="confirmPassword"
          v-model="form.confirmPassword"
          type="password"
          placeholder="Confirm password"
          autocomplete="new-password"
          class="w-full h-12 px-4 bg-white dark:bg-black border border-gray-200 dark:border-gray-800 rounded-md text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-brand"
        />

        <!-- Password Requirements -->
        <p class="text-xs text-gray-400">
          <span :class="passwordIsValid ? 'text-green-600 dark:text-green-500' : ''">8+ chars</span>
          <span class="mx-1.5">·</span>
          <span :class="containsSpecialChars ? 'text-green-600 dark:text-green-500' : ''">1 special</span>
          <span class="mx-1.5">·</span>
          <span :class="passwordsMatch ? 'text-green-600 dark:text-green-500' : ''">match</span>
        </p>

        <button
          type="submit"
          :disabled="!isFormValid"
          class="w-full h-12 bg-gray-900 dark:bg-white hover:bg-gray-800 dark:hover:bg-gray-100 disabled:bg-gray-100 dark:disabled:bg-gray-900 disabled:text-gray-400 dark:disabled:text-gray-600 text-white dark:text-black font-medium rounded-md transition-colors flex items-center justify-center gap-2 border border-gray-200 dark:border-gray-800"
        >
          <svg
            v-if="form.processing"
            class="w-4 h-4 animate-spin"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span>{{ form.processing ? 'Creating account...' : 'Create account' }}</span>
        </button>
      </form>
    </div>
  </div>
</template>
