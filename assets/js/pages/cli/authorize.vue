<script setup>
import Check from '@/components/ui/icons/Check.vue'
import { Head, Link } from '@inertiajs/vue3'
import { ref } from 'vue'
import SlipwayLogo from '@/components/SlipwayLogo.vue'
import Spinner from '@/components/SlipwaySpinner.vue'

const props = defineProps({
  code: String,
  isLoggedIn: Boolean,
  user: Object,
  status: String
})

const confirming = ref(false)
const confirmed = ref(props.status === 'success')
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
      // Update URL to preserve success state on refresh
      const url = new URL(window.location.href)
      url.searchParams.set('status', 'success')
      window.history.replaceState({}, '', url.toString())
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

  <div
    class="flex min-h-screen flex-col items-center justify-center bg-white px-4 dark:bg-black"
  >
    <div class="w-full max-w-sm">
      <!-- Logo -->
      <div class="mb-8 text-center">
        <Link href="/" class="inline-flex flex-col items-center gap-3">
          <SlipwayLogo
            :processing="confirming"
            class="h-12 w-12 text-[#0284c7] dark:text-white"
          />
          <h1
            class="text-2xl font-semibold tracking-tight text-gray-900 dark:text-white"
          >
            Slipway
          </h1>
        </Link>
      </div>

      <!-- Success state -->
      <section v-if="confirmed" class="text-center">
        <div class="mb-6 flex justify-center">
          <div
            class="dark:bg-green/10 flex h-16 w-16 items-center justify-center rounded-full bg-green-50"
          >
            <Check
              class="dark:text-green h-8 w-8 text-green-600"
              stroke-width="2"
            />
          </div>
        </div>
        <h2 class="mb-2 text-lg font-medium text-gray-900 dark:text-white">
          CLI Authorized
        </h2>
        <p class="text-sm text-gray-500">
          You can now close this window and return to your terminal.
        </p>
      </section>

      <!-- Logged in - show confirmation -->
      <section v-else-if="isLoggedIn">
        <p class="mb-6 text-center text-gray-900 dark:text-white">
          Authorize CLI access
        </p>

        <!-- Confirmation Code -->
        <div
          class="mb-4 rounded-md border border-gray-200 p-4 text-center dark:border-gray-800"
        >
          <p class="mb-2 text-xs uppercase tracking-wider text-gray-500">
            Confirmation Code
          </p>
          <p
            class="font-mono text-3xl font-bold tracking-widest text-gray-900 dark:text-white"
          >
            {{ code }}
          </p>
        </div>

        <!-- User info -->
        <div
          class="mb-6 rounded-md border border-gray-200 p-4 dark:border-gray-800"
        >
          <p class="mb-1 text-xs uppercase tracking-wider text-gray-500">
            Authorizing as
          </p>
          <p class="text-gray-900 dark:text-white">{{ user?.email }}</p>
        </div>

        <!-- Error message -->
        <div
          v-if="error"
          class="mb-6 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400"
        >
          {{ error }}
        </div>

        <button
          @click="confirmLogin"
          :disabled="confirming"
          class="flex h-12 w-full items-center justify-center gap-2 rounded-md border border-gray-200 bg-gray-900 font-medium text-white transition-colors hover:bg-gray-800 disabled:bg-gray-100 disabled:text-gray-400 dark:border-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-100 dark:disabled:bg-gray-900 dark:disabled:text-gray-600"
        >
          <Spinner v-if="confirming" class="h-4 w-4" />
          <span>{{ confirming ? 'Authorizing...' : 'Authorize CLI' }}</span>
        </button>

        <p class="mt-4 text-center text-xs text-gray-500">
          Make sure this code matches what you see in your terminal.
        </p>
      </section>

      <!-- Not logged in - redirect to login -->
      <section v-else>
        <p class="mb-6 text-center text-gray-900 dark:text-white">
          Authorize CLI access
        </p>

        <!-- Confirmation Code -->
        <div
          class="mb-6 rounded-md border border-gray-200 p-4 text-center dark:border-gray-800"
        >
          <p class="mb-2 text-xs uppercase tracking-wider text-gray-500">
            Confirmation Code
          </p>
          <p
            class="font-mono text-3xl font-bold tracking-widest text-gray-900 dark:text-white"
          >
            {{ code }}
          </p>
        </div>

        <Link
          :href="`/login?redirect=${encodeURIComponent(
            '/cli/authorize?code=' + code
          )}`"
          class="flex h-12 w-full items-center justify-center rounded-md border border-gray-200 bg-gray-900 font-medium text-white transition-colors hover:bg-gray-800 dark:border-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-100"
        >
          Log in to continue
        </Link>
      </section>
    </div>
  </div>
</template>
