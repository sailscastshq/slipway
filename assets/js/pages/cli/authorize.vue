<script setup>
import { Head, Link } from '@inertiajs/vue3'
import { ref } from 'vue'

const props = defineProps({
  code: String,
  isLoggedIn: Boolean,
  user: Object
})

const confirming = ref(false)
const confirmed = ref(false)
const error = ref(null)

async function confirmLogin() {
  confirming.value = true
  error.value = null

  try {
    const response = await fetch('/api/v1/cli/auth/confirm', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ code: props.code })
    })

    if (response.ok) {
      confirmed.value = true
    } else {
      const data = await response.json()
      error.value = data.message || 'Failed to authorize CLI'
    }
  } catch (err) {
    error.value = 'Network error. Please try again.'
  } finally {
    confirming.value = false
  }
}
</script>

<template>
  <Head title="Authorize CLI | Slipway" />

  <div class="min-h-screen bg-white dark:bg-black flex flex-col items-center justify-center px-4">
    <div class="w-full max-w-sm">
      <!-- Logo -->
      <div class="text-center mb-8">
        <Link href="/">
          <h1 class="text-2xl font-semibold text-gray-900 dark:text-white tracking-tight">Slipway</h1>
        </Link>
      </div>

      <!-- Success state -->
      <section v-if="confirmed" class="text-center">
        <div class="mb-6 flex justify-center">
          <div class="w-16 h-16 rounded-full bg-green-50 dark:bg-green/10 flex items-center justify-center">
            <svg class="w-8 h-8 text-green-600 dark:text-green" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
            </svg>
          </div>
        </div>
        <h2 class="text-lg font-medium text-gray-900 dark:text-white mb-2">CLI Authorized</h2>
        <p class="text-gray-500 text-sm">
          You can now close this window and return to your terminal.
        </p>
      </section>

      <!-- Logged in - show confirmation -->
      <section v-else-if="isLoggedIn">
        <p class="text-center text-gray-900 dark:text-white mb-6">Authorize CLI access</p>

        <!-- Confirmation Code -->
        <div class="mb-4 p-4 rounded-md border border-gray-200 dark:border-gray-800 text-center">
          <p class="text-xs text-gray-500 uppercase tracking-wider mb-2">Confirmation Code</p>
          <p class="font-mono text-3xl font-bold text-gray-900 dark:text-white tracking-widest">{{ code }}</p>
        </div>

        <!-- User info -->
        <div class="mb-6 p-4 rounded-md border border-gray-200 dark:border-gray-800">
          <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">Authorizing as</p>
          <p class="text-gray-900 dark:text-white">{{ user?.email }}</p>
        </div>

        <!-- Error message -->
        <div
          v-if="error"
          class="mb-6 p-3 rounded-md bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 text-sm"
        >
          {{ error }}
        </div>

        <button
          @click="confirmLogin"
          :disabled="confirming"
          class="w-full h-12 bg-gray-900 dark:bg-white hover:bg-gray-800 dark:hover:bg-gray-100 disabled:bg-gray-100 dark:disabled:bg-gray-900 disabled:text-gray-400 dark:disabled:text-gray-600 text-white dark:text-black font-medium rounded-md transition-colors flex items-center justify-center gap-2 border border-gray-200 dark:border-gray-800"
        >
          <svg
            v-if="confirming"
            class="w-4 h-4 animate-spin"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span>{{ confirming ? 'Authorizing...' : 'Authorize CLI' }}</span>
        </button>

        <p class="mt-4 text-center text-xs text-gray-500">
          Make sure this code matches what you see in your terminal.
        </p>
      </section>

      <!-- Not logged in - redirect to login -->
      <section v-else>
        <p class="text-center text-gray-900 dark:text-white mb-6">Authorize CLI access</p>

        <!-- Confirmation Code -->
        <div class="mb-6 p-4 rounded-md border border-gray-200 dark:border-gray-800 text-center">
          <p class="text-xs text-gray-500 uppercase tracking-wider mb-2">Confirmation Code</p>
          <p class="font-mono text-3xl font-bold text-gray-900 dark:text-white tracking-widest">{{ code }}</p>
        </div>

        <Link
          :href="`/login?redirect=${encodeURIComponent('/cli/authorize?code=' + code)}`"
          class="w-full h-12 bg-gray-900 dark:bg-white hover:bg-gray-800 dark:hover:bg-gray-100 text-white dark:text-black font-medium rounded-md transition-colors flex items-center justify-center border border-gray-200 dark:border-gray-800"
        >
          Log in to continue
        </Link>
      </section>
    </div>
  </div>
</template>
