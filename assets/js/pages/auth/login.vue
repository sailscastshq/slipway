<script setup>
import { Link, Head, useForm } from '@inertiajs/vue3'
import { computed } from 'vue'
import SlipwayLogo from '@/components/SlipwayLogo.vue'
import { Spinner } from '@/components/ui/spinner'
import { usePrecognitionValidation } from '@/composables/precognition'

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
  .withPrecognition('post', '/login')
  .setValidationTimeout(350)

const { revalidateWhenInvalid, validateOnBlur } =
  usePrecognitionValidation(form)

const isFormValid = computed(() => {
  return form.email && form.password
})
</script>

<template>
  <Head title="Login | Slipway" />

  <div
    class="flex min-h-screen flex-col items-center justify-center bg-white px-4 dark:bg-black"
  >
    <div class="w-full max-w-sm">
      <!-- Logo -->
      <div class="mb-8 text-center">
        <Link href="/" class="inline-flex flex-col items-center gap-3">
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
      </div>

      <!-- Error message -->
      <div
        v-if="form.errors.login || props.error"
        class="mb-6 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400"
      >
        {{ form.errors.login || props.error }}
      </div>

      <form @submit.prevent="form.post('/login')" class="space-y-4">
        <div>
          <input
            id="email"
            v-model="form.email"
            type="email"
            placeholder="Enter your email address..."
            autocomplete="email"
            :aria-invalid="form.invalid('email') ? 'true' : undefined"
            :aria-describedby="
              form.invalid('email') ? 'login-email-error' : undefined
            "
            class="focus:border-brand h-12 w-full border-b border-dashed border-gray-200 bg-transparent px-1 text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
            @blur="validateOnBlur('email', $event)"
            @input="revalidateWhenInvalid('email')"
          />
          <p
            v-if="form.errors.email"
            id="login-email-error"
            class="mt-1.5 text-xs text-red-600 dark:text-red-400"
          >
            {{ form.errors.email }}
          </p>
        </div>

        <div>
          <input
            id="password"
            v-model="form.password"
            type="password"
            placeholder="Enter password"
            autocomplete="current-password"
            :aria-invalid="form.invalid('password') ? 'true' : undefined"
            :aria-describedby="
              form.invalid('password') ? 'login-password-error' : undefined
            "
            class="focus:border-brand h-12 w-full border-b border-dashed border-gray-200 bg-transparent px-1 text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
            @blur="validateOnBlur('password', $event)"
            @input="revalidateWhenInvalid('password')"
          />
          <p
            v-if="form.errors.password"
            id="login-password-error"
            class="mt-1.5 text-xs text-red-600 dark:text-red-400"
          >
            {{ form.errors.password }}
          </p>
        </div>

        <button
          type="submit"
          :disabled="!isFormValid || form.processing || form.hasErrors"
          class="flex h-12 w-full items-center justify-center gap-2 rounded-md border border-gray-200 bg-gray-900 font-medium text-white transition-colors hover:bg-gray-800 disabled:bg-gray-100 disabled:text-gray-400 dark:border-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-100 dark:disabled:bg-gray-900 dark:disabled:text-gray-600"
        >
          <Spinner v-if="form.processing" class="h-4 w-4" />
          <span>{{
            form.processing ? 'Logging in...' : 'Continue with email'
          }}</span>
        </button>
      </form>

      <div class="mt-6 text-center">
        <Link
          href="/forgot-password"
          class="text-sm text-gray-500 transition-colors hover:text-gray-900 dark:hover:text-white"
        >
          Forgot password?
        </Link>
      </div>
    </div>
  </div>
</template>
