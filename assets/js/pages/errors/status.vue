<script setup>
import { Head } from '@inertiajs/vue3'
import { computed } from 'vue'
import SlipwayLogo from '@/components/SlipwayLogo.vue'
import SlippyLoader from '@/components/SlippyLoader.vue'
import ErrorState from '@/components/ui/error-state/ErrorState.vue'

const FALLBACK_PAGES = {
  403: {
    title: 'Access denied',
    headline: 'This area is not available',
    message:
      'Your account does not have access to this part of Slipway. If that seems wrong, ask your Slipway administrator.',
    actions: [{ label: 'Return to Slipway', type: 'home', href: '/' }]
  },
  404: {
    title: 'Page not found',
    headline: 'Nothing is here',
    message: 'The page may have moved, or the link may no longer be available.',
    actions: [{ label: 'Return to Slipway', type: 'home', href: '/' }]
  },
  419: {
    title: 'Session expired',
    headline: 'Your session has expired',
    message: 'Sign in again to continue safely from where you left off.',
    actions: [
      { label: 'Sign in again', type: 'login', href: '/login' },
      { label: 'Return to Slipway', type: 'home', href: '/' }
    ]
  },
  429: {
    title: 'Too many requests',
    headline: 'Give it a moment',
    message:
      'Slipway is receiving too many requests from this connection. Wait a minute, then try again.',
    actions: [
      { label: 'Try again', type: 'retry', href: '' },
      { label: 'Return to Slipway', type: 'home', href: '/' }
    ]
  },
  500: {
    title: 'Server error',
    headline: 'Something went wrong',
    message:
      'Slipway could not load this page. Try again, or return to your dashboard.',
    actions: [
      { label: 'Try again', type: 'retry', href: '' },
      { label: 'Return to Slipway', type: 'home', href: '/' }
    ]
  },
  503: {
    title: 'Service unavailable',
    headline: 'Slipway is temporarily unavailable',
    message:
      'We are finishing some work behind the scenes. Try again in a moment.',
    actions: [
      { label: 'Try again', type: 'retry', href: '' },
      { label: 'Return to Slipway', type: 'home', href: '/' }
    ]
  }
}

const props = defineProps({
  status: { type: Number, default: 500 },
  title: String,
  headline: String,
  message: String,
  actions: Array
})

const page = computed(() => {
  const fallback = FALLBACK_PAGES[props.status] || FALLBACK_PAGES[500]
  return {
    title: props.title || fallback.title,
    headline: props.headline || fallback.headline,
    message: props.message || fallback.message,
    actions: props.actions?.length ? props.actions : fallback.actions
  }
})
</script>

<template>
  <Head :title="`${page.title} | Slipway`" />

  <div
    :data-error-page="status"
    class="min-h-svh flex flex-col overflow-hidden bg-white text-gray-900 dark:bg-black dark:text-gray-50"
  >
    <header
      class="mx-auto flex w-full max-w-6xl items-center px-5 py-6 sm:px-8"
    >
      <a
        href="/"
        aria-label="Go to Slipway"
        class="min-h-11 inline-flex items-center gap-2.5 text-base font-semibold tracking-tight"
      >
        <SlipwayLogo
          :animated="false"
          class="text-brand h-8 w-8 dark:text-white"
        />
        <span>Slipway</span>
      </a>
    </header>

    <main
      class="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center gap-10 px-5 py-12 sm:px-8 lg:grid lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-center lg:gap-24 lg:py-16"
    >
      <ErrorState
        as="section"
        aria-labelledby="error-heading"
        class="min-h-0 max-w-2xl items-start gap-0 p-0 text-left"
      >
        <p
          class="font-mono text-sm font-semibold tabular-nums tracking-[0.14em] text-gray-400 dark:text-gray-500"
        >
          {{ status }}
        </p>
        <h1
          id="error-heading"
          class="text-balance mt-4 max-w-xl text-[clamp(2.35rem,7vw,4.5rem)] font-semibold leading-[0.98] tracking-[-0.055em]"
        >
          {{ page.headline }}
        </h1>
        <p
          class="text-pretty mt-6 max-w-lg text-base leading-7 text-gray-500 dark:text-gray-400 sm:text-lg sm:leading-8"
        >
          {{ page.message }}
        </p>

        <nav
          aria-label="Recovery"
          class="mt-9 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center"
        >
          <a
            v-for="(action, index) in page.actions"
            :key="`${action.type}-${action.label}`"
            :href="action.href"
            :class="[
              'min-h-12 focus-visible:ring-brand dark:focus-visible:ring-brand-400 inline-flex items-center justify-center rounded-md px-5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-black',
              index === 0
                ? 'bg-gray-900 text-white hover:bg-gray-800 dark:bg-white dark:text-gray-950 dark:hover:bg-gray-100'
                : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
            ]"
          >
            {{ action.label }}
          </a>
        </nav>
      </ErrorState>

      <SlippyLoader
        class="text-brand dark:text-brand-400 order-first h-14 w-14 shrink-0 self-center lg:order-none lg:h-24 lg:w-24 lg:self-auto lg:justify-self-center"
      />
    </main>
  </div>
</template>
