<script setup>
import { Link, Head } from '@inertiajs/vue3'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import SlipwayLogo from '@/components/SlipwayLogo.vue'
import ToastContainer from '@/components/ToastContainer.vue'
import { createToast } from '@/composables/toast'
import { useFlashToast } from '@/composables/flash-toast'

const props = defineProps({
  message: String,
  resendCooldownSecondsRemaining: {
    type: Number,
    default: 0
  }
})

const toast = createToast()
useFlashToast(toast)

const resendSecondsRemaining = ref(props.resendCooldownSecondsRemaining)
let countdownInterval

const resendDisabled = computed(() => resendSecondsRemaining.value > 0)
const resendLabel = computed(() =>
  resendDisabled.value
    ? `Resend link in ${resendSecondsRemaining.value}s`
    : 'Resend link'
)

watch(
  () => props.resendCooldownSecondsRemaining,
  (seconds) => {
    resendSecondsRemaining.value = seconds || 0
  }
)

onMounted(() => {
  countdownInterval = setInterval(() => {
    if (resendSecondsRemaining.value > 0) {
      resendSecondsRemaining.value -= 1
    }
  }, 1000)
})

onBeforeUnmount(() => {
  clearInterval(countdownInterval)
  toast.destroy()
})
</script>

<template>
  <Head title="Check your email | Slipway" />

  <div
    class="flex min-h-screen flex-col items-center justify-center bg-white px-4 dark:bg-black"
  >
    <main class="w-full max-w-sm">
      <section class="mb-8 text-center">
        <Link href="/" class="mb-2 inline-flex flex-col items-center gap-3">
          <SlipwayLogo
            :animated="false"
            class="h-12 w-12 text-[#0284c7] dark:text-white"
          />
          <h1
            class="text-2xl font-semibold tracking-tight text-gray-900 dark:text-white"
          >
            Slipway
          </h1>
        </Link>
      </section>

      <section
        aria-labelledby="check-email-heading"
        class="space-y-6 text-center"
      >
        <div class="space-y-3">
          <h2
            id="check-email-heading"
            class="text-xl font-semibold tracking-tight text-gray-900 dark:text-white"
          >
            Check your inbox
          </h2>
          <p
            v-if="props.message"
            class="text-sm leading-6 text-gray-500 dark:text-gray-400"
          >
            {{ props.message }}
          </p>
        </div>

        <a
          href="mailto:"
          class="flex h-12 w-full items-center justify-center rounded-md border border-gray-200 bg-gray-900 font-medium text-white transition-colors hover:bg-gray-800 dark:border-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-100"
        >
          Open mail app
        </a>

        <p class="text-sm text-gray-500 dark:text-gray-400">
          No email yet?
          <Link
            v-if="!resendDisabled"
            href="/resend-link"
            class="font-medium text-gray-900 transition-colors hover:text-gray-600 dark:text-white dark:hover:text-gray-300"
          >
            {{ resendLabel }}
          </Link>
          <button
            v-else
            type="button"
            disabled
            class="font-medium text-gray-400 dark:text-gray-600"
          >
            {{ resendLabel }}
          </button>
        </p>
      </section>

      <div class="mt-6 text-center">
        <Link
          href="/login"
          class="text-sm text-gray-500 transition-colors hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
        >
          Back to login
        </Link>
      </div>
    </main>
  </div>

  <ToastContainer :controller="toast" />
</template>
