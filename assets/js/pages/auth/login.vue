<script setup>
import { Link, Head, useForm } from '@inertiajs/vue3'
import { computed } from 'vue'
import SlipwayLogo from '@/components/SlipwayLogo.vue'
import SlippyLoader from '@/components/SlippyLoader.vue'

const props = defineProps({
  redirect: String,
  error: String
})

const form = useForm({
  email: '',
  password: '',
  rememberMe: false,
  redirect: props.redirect || null
})

const isFormValid = computed(() => {
  return form.email && form.password
})
</script>

<template>
  <Head title="Login | Slipway" />

  <div class="min-h-screen bg-white dark:bg-black flex flex-col items-center justify-center px-4">
    <div class="w-full max-w-sm">
      <!-- Logo -->
      <div class="text-center mb-8">
        <Link href="/" class="inline-flex flex-col items-center gap-3">
          <SlipwayLogo :processing="form.processing" class="h-12 w-12 text-[#0284c7] dark:text-white" />
          <h1 class="text-2xl font-semibold text-gray-900 dark:text-white tracking-tight">Slipway</h1>
        </Link>
      </div>

      <!-- Error message -->
      <div
        v-if="form.errors.login || form.errors.email || props.error"
        class="mb-6 p-3 rounded-md bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 text-sm"
      >
        {{ form.errors.login || form.errors.email || props.error }}
      </div>

      <form @submit.prevent="form.post('/login')" class="space-y-4">
        <input
          id="email"
          v-model="form.email"
          type="email"
          placeholder="Enter your email address..."
          autocomplete="email"
          class="w-full h-12 px-1 bg-transparent border-b border-dashed border-gray-200 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-brand dark:border-gray-700"
        />

        <input
          id="password"
          v-model="form.password"
          type="password"
          placeholder="Enter password"
          autocomplete="current-password"
          class="w-full h-12 px-1 bg-transparent border-b border-dashed border-gray-200 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-brand dark:border-gray-700"
        />

        <button
          type="submit"
          :disabled="!isFormValid || form.processing"
          class="w-full h-12 bg-gray-900 dark:bg-white hover:bg-gray-800 dark:hover:bg-gray-100 disabled:bg-gray-100 dark:disabled:bg-gray-900 disabled:text-gray-400 dark:disabled:text-gray-600 text-white dark:text-black font-medium rounded-md transition-colors flex items-center justify-center gap-2 border border-gray-200 dark:border-gray-800"
        >
          <SlippyLoader v-if="form.processing" size="h-4 w-4" />
          <span>{{ form.processing ? 'Logging in...' : 'Continue with email' }}</span>
        </button>
      </form>

      <div class="mt-6 text-center">
        <Link href="/forgot-password" class="text-sm text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors">
          Forgot password?
        </Link>
      </div>
    </div>
  </div>
</template>
