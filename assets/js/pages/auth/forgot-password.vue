<script setup>
import { Link, Head, useForm } from '@inertiajs/vue3'
import SlipwayLogo from '@/components/SlipwayLogo.vue'
import SlippyLoader from '@/components/SlippyLoader.vue'
import { usePrecognitionValidation } from '@/composables/precognition'

const form = useForm({
  email: ''
})
  .withPrecognition('post', '/forgot-password')
  .setValidationTimeout(350)

const { revalidateWhenInvalid, validateOnBlur } =
  usePrecognitionValidation(form)
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

      <form @submit.prevent="form.post('/forgot-password')" class="space-y-4">
        <div>
          <input
            id="email"
            v-model="form.email"
            type="email"
            placeholder="Enter your email address..."
            autocomplete="email"
            :aria-invalid="form.invalid('email') ? 'true' : undefined"
            :aria-describedby="
              form.invalid('email')
                ? 'forgot-password-email-error'
                : 'forgot-password-email-description'
            "
            class="focus:border-brand h-12 w-full border-b border-dashed border-gray-200 bg-transparent px-1 text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
            @blur="validateOnBlur('email', $event)"
            @input="revalidateWhenInvalid('email')"
          />
          <p
            v-if="form.errors.email"
            id="forgot-password-email-error"
            class="mt-1.5 text-xs text-red-600 dark:text-red-400"
          >
            {{ form.errors.email }}
          </p>
          <p
            v-else
            id="forgot-password-email-description"
            class="mt-2 text-xs text-gray-500"
          >
            We'll send reset instructions to this email
          </p>
        </div>

        <button
          type="submit"
          :disabled="!form.email || form.processing || form.hasErrors"
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
