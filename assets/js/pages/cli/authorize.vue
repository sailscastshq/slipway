<script setup>
import { Head, Link, router } from '@inertiajs/vue3'
import { ref, computed } from 'vue'
import InputButton from '@/components/InputButton.vue'

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
      error.value = data.message || 'Failed to confirm CLI login'
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
  <section
    class="bg-linear-to-b from-brand-50/10 flex min-h-screen flex-col justify-center to-[#F9FAFB] text-black sm:items-center"
  >
    <main
      class="mt-10 bg-white px-4 py-10 text-black sm:w-7/12 sm:rounded-lg sm:px-8 sm:shadow-lg md:w-6/12 lg:w-5/12 xl:w-4/12"
    >
      <!-- Success state -->
      <section v-if="confirmed" class="text-center">
        <div class="mb-6 flex justify-center">
          <svg
            class="h-16 w-16 text-green-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
        <h1 class="mb-4 text-2xl font-semibold">CLI Authorized</h1>
        <p class="text-gray-600">
          You can now close this window and return to your terminal.
        </p>
      </section>

      <!-- Logged in - show confirmation -->
      <section v-else-if="isLoggedIn" class="text-center">
        <h1 class="mb-4 text-2xl font-semibold">Authorize Slipway CLI</h1>
        <p class="mb-6 text-gray-600">
          The Slipway CLI is requesting access to your account.
        </p>

        <div class="mb-6 rounded-lg bg-gray-50 p-4">
          <p class="text-sm text-gray-500">Confirmation Code</p>
          <p class="font-mono text-2xl font-bold tracking-wider">{{ code }}</p>
        </div>

        <div class="mb-6 rounded-lg border border-gray-200 p-4">
          <p class="text-sm text-gray-500">Logging in as</p>
          <p class="font-medium">{{ user?.email }}</p>
        </div>

        <p
          v-if="error"
          class="mb-4 rounded-sm border-red-400 bg-red-100 p-4 text-red-500"
        >
          {{ error }}
        </p>

        <InputButton
          @click="confirmLogin"
          :processing="confirming"
          :disabled="confirming"
        >
          Authorize CLI
        </InputButton>

        <p class="mt-4 text-sm text-gray-500">
          Make sure this code matches what you see in your terminal.
        </p>
      </section>

      <!-- Not logged in - redirect to login -->
      <section v-else class="text-center">
        <h1 class="mb-4 text-2xl font-semibold">Authorize Slipway CLI</h1>
        <p class="mb-6 text-gray-600">Please log in to authorize the CLI.</p>

        <div class="mb-6 rounded-lg bg-gray-50 p-4">
          <p class="text-sm text-gray-500">Confirmation Code</p>
          <p class="font-mono text-2xl font-bold tracking-wider">{{ code }}</p>
        </div>

        <Link
          :href="`/login?redirect=${encodeURIComponent('/cli/authorize?code=' + code)}`"
          class="bg-brand hover:bg-brand-600 inline-block w-full rounded-md px-4 py-3 text-center font-medium text-white"
        >
          Log in to continue
        </Link>
      </section>
    </main>
  </section>
</template>
