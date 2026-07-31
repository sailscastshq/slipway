<script setup>
import { Head, useForm } from '@inertiajs/vue3'
import { computed } from 'vue'
import SlipwayLogo from '@/components/SlipwayLogo.vue'
import SlippyLoader from '@/components/SlippyLoader.vue'
import { usePrecognitionValidation } from '@/composables/precognition'

const form = useForm({
  email: '',
  password: '',
  confirmPassword: ''
})
  .withPrecognition('post', '/setup')
  .setValidationTimeout(350)

const { revalidateWhenInvalid, validateOnBlur } =
  usePrecognitionValidation(form)

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
  return (
    form.email &&
    passwordIsValid.value &&
    containsSpecialChars.value &&
    passwordsMatch.value &&
    !form.hasErrors &&
    !form.processing
  )
})
</script>

<template>
  <Head title="Setup | Slipway" />

  <div
    class="flex min-h-screen flex-col items-center justify-center bg-white px-4 dark:bg-black"
  >
    <div class="w-full max-w-sm">
      <!-- Logo -->
      <div class="mb-8 text-center">
        <div class="mb-2 inline-flex flex-col items-center gap-3">
          <SlipwayLogo
            :processing="form.processing"
            class="h-12 w-12 text-[#0284c7] dark:text-white"
          />
          <h1
            class="text-2xl font-semibold tracking-tight text-gray-900 dark:text-white"
          >
            Slipway
          </h1>
        </div>
        <p class="text-sm text-gray-500">
          Create an admin account to get started
        </p>
      </div>

      <!-- Error message -->
      <div
        v-if="form.errors.setup"
        class="mb-6 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400"
      >
        {{ form.errors.setup }}
      </div>

      <form @submit.prevent="form.post('/setup')" class="space-y-4">
        <div>
          <input
            id="email"
            v-model="form.email"
            type="email"
            placeholder="Enter your email address..."
            autocomplete="email"
            :aria-invalid="form.invalid('email') ? 'true' : undefined"
            :aria-describedby="
              form.invalid('email') ? 'setup-email-error' : undefined
            "
            class="focus:border-brand h-12 w-full border-b border-dashed border-gray-200 bg-transparent px-1 text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
            @blur="validateOnBlur('email', $event)"
            @input="revalidateWhenInvalid('email')"
          />
          <p
            v-if="form.errors.email"
            id="setup-email-error"
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
            placeholder="Create a password"
            autocomplete="new-password"
            :aria-invalid="form.invalid('password') ? 'true' : undefined"
            :aria-describedby="
              form.invalid('password') ? 'setup-password-error' : undefined
            "
            class="focus:border-brand h-12 w-full border-b border-dashed border-gray-200 bg-transparent px-1 text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
            @blur="validateOnBlur('password', $event)"
            @input="revalidateWhenInvalid('password')"
          />
          <p
            v-if="form.errors.password"
            id="setup-password-error"
            class="mt-1.5 text-xs text-red-600 dark:text-red-400"
          >
            {{ form.errors.password }}
          </p>
        </div>

        <div>
          <input
            id="confirmPassword"
            v-model="form.confirmPassword"
            type="password"
            placeholder="Confirm password"
            autocomplete="new-password"
            :aria-invalid="form.invalid('confirmPassword') ? 'true' : undefined"
            :aria-describedby="
              form.invalid('confirmPassword')
                ? 'setup-confirm-password-error'
                : undefined
            "
            class="focus:border-brand h-12 w-full border-b border-dashed border-gray-200 bg-transparent px-1 text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
            @blur="validateOnBlur('confirmPassword', $event)"
            @input="revalidateWhenInvalid('confirmPassword')"
          />
          <p
            v-if="form.errors.confirmPassword"
            id="setup-confirm-password-error"
            class="mt-1.5 text-xs text-red-600 dark:text-red-400"
          >
            {{ form.errors.confirmPassword }}
          </p>
        </div>

        <!-- Password Requirements -->
        <p class="text-xs text-gray-400">
          <span
            :class="passwordIsValid ? 'text-green-600 dark:text-green-500' : ''"
            >8+ chars</span
          >
          <span class="mx-1.5">·</span>
          <span
            :class="
              containsSpecialChars ? 'text-green-600 dark:text-green-500' : ''
            "
            >1 special</span
          >
          <span class="mx-1.5">·</span>
          <span
            :class="passwordsMatch ? 'text-green-600 dark:text-green-500' : ''"
            >match</span
          >
        </p>

        <button
          type="submit"
          :disabled="!isFormValid"
          class="flex h-12 w-full items-center justify-center gap-2 rounded-md border border-gray-200 bg-gray-900 font-medium text-white transition-colors hover:bg-gray-800 disabled:bg-gray-100 disabled:text-gray-400 dark:border-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-100 dark:disabled:bg-gray-900 dark:disabled:text-gray-600"
        >
          <SlippyLoader v-if="form.processing" size="h-4 w-4" />
          <span>{{
            form.processing ? 'Creating account...' : 'Create account'
          }}</span>
        </button>
      </form>
    </div>
  </div>
</template>
