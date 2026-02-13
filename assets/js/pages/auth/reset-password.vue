<script setup>
import { Link, Head, useForm } from '@inertiajs/vue3'
import { computed } from 'vue'
import SlipwayLogo from '@/components/SlipwayLogo.vue'

const { token } = defineProps({
  token: String
})

const form = useForm({
  token,
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

const isFormValid = computed(() => {
  return passwordIsValid.value && containsSpecialChars.value && passwordsMatch.value && !form.processing
})
</script>

<template>
  <Head title="Reset password | Slipway" />

  <div class="min-h-screen bg-white dark:bg-black flex flex-col items-center justify-center px-4">
    <div class="w-full max-w-sm">
      <!-- Logo -->
      <div class="text-center mb-8">
        <Link href="/" class="inline-flex flex-col items-center gap-3 mb-2">
          <SlipwayLogo :processing="form.processing" class="h-12 w-12 text-[#0284c7] dark:text-white" />
          <h1 class="text-2xl font-semibold text-gray-900 dark:text-white tracking-tight">Slipway</h1>
        </Link>
        <p class="text-gray-500 text-sm">Create a new password</p>
      </div>

      <!-- Error message -->
      <div
        v-if="form.errors.password || form.errors.token"
        class="mb-6 p-3 rounded-md bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 text-sm"
      >
        {{ form.errors.password || form.errors.token }}
      </div>

      <form @submit.prevent="form.post('/reset-password')" class="space-y-4">
        <input
          id="password"
          v-model="form.password"
          type="password"
          placeholder="Enter new password"
          autocomplete="new-password"
          class="w-full h-12 px-4 bg-white dark:bg-black border border-gray-200 dark:border-gray-800 rounded-md text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-brand"
        />

        <input
          id="confirmPassword"
          v-model="form.confirmPassword"
          type="password"
          placeholder="Confirm new password"
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
          <span>{{ form.processing ? 'Resetting...' : 'Reset password' }}</span>
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
