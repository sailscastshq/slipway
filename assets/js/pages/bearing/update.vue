<script setup>
import { Head } from '@inertiajs/vue3'
import { computed } from 'vue'
import MarkdownContent from '@/components/MarkdownContent.vue'
import ShareLinkButton from '@/components/ShareLinkButton.vue'

const props = defineProps({
  app: Object,
  bearing: Object,
  update: Object,
  publicUrl: String,
  ogImageUrl: String
})

const pageTitle = computed(() => `${props.update.title} · ${props.app.name}`)
const publishedIso = computed(() =>
  new Date(props.update.publishedAt).toISOString()
)
const authorInitials = computed(() =>
  String(props.update.authorName || 'The team')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
)

function longDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date(value))
}
</script>

<template>
  <Head :title="pageTitle">
    <meta head-key="description" name="description" :content="update.excerpt" />
    <meta head-key="og:type" property="og:type" content="article" />
    <meta head-key="og:site_name" property="og:site_name" :content="app.name" />
    <meta head-key="og:title" property="og:title" :content="pageTitle" />
    <meta
      head-key="og:description"
      property="og:description"
      :content="update.excerpt"
    />
    <meta head-key="og:url" property="og:url" :content="publicUrl" />
    <meta head-key="og:image" property="og:image" :content="ogImageUrl" />
    <meta head-key="og:image:width" property="og:image:width" content="1200" />
    <meta head-key="og:image:height" property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" :content="pageTitle" />
    <meta name="twitter:description" :content="update.excerpt" />
    <meta name="twitter:image" :content="ogImageUrl" />
    <link rel="canonical" :href="publicUrl" />
  </Head>

  <div
    class="min-h-screen bg-white text-gray-950 dark:bg-gray-950 dark:text-white"
  >
    <header class="px-5 sm:px-8">
      <nav
        class="mx-auto flex h-16 max-w-5xl items-center justify-between"
        aria-label="Bearing"
      >
        <a :href="app.homeUrl" class="text-sm font-semibold tracking-tight">
          {{ app.name }}
        </a>
        <div class="flex items-center gap-5 text-sm">
          <a
            :href="app.feedbackPath"
            class="text-gray-500 transition hover:text-gray-950 dark:text-gray-400 dark:hover:text-white"
          >
            Feedback
          </a>
          <a
            v-if="bearing.showPublicRoadmap"
            :href="app.roadmapPath"
            class="text-gray-500 transition hover:text-gray-950 dark:text-gray-400 dark:hover:text-white"
          >
            Roadmap
          </a>
          <a
            :href="app.updatesPath"
            class="font-medium text-gray-950 dark:text-white"
            aria-current="page"
          >
            Updates
          </a>
        </div>
      </nav>
    </header>

    <main class="px-5 pb-20 pt-14 sm:px-8 sm:pt-20">
      <article class="mx-auto max-w-prose">
        <header>
          <a
            :href="app.updatesPath"
            class="text-sm text-gray-400 transition hover:text-gray-700 dark:hover:text-gray-200"
          >
            ← All updates
          </a>
          <time
            :datetime="publishedIso"
            class="mt-10 block text-sm text-gray-400"
          >
            {{ longDate(update.publishedAt) }}
          </time>
          <h1
            class="text-balance mt-4 text-3xl font-semibold leading-tight tracking-tight sm:text-5xl"
          >
            {{ update.title }}
          </h1>
          <p
            class="text-pretty mt-5 text-lg leading-8 text-gray-500 dark:text-gray-400"
          >
            {{ update.excerpt }}
          </p>
          <div class="mt-7 flex items-center gap-3">
            <span
              class="size-9 grid place-items-center rounded-full bg-gray-100 text-xs font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-300"
              aria-hidden="true"
            >
              {{ authorInitials }}
            </span>
            <p class="text-sm text-gray-500 dark:text-gray-400">
              Published by
              <span class="font-medium text-gray-800 dark:text-gray-200">
                {{ update.authorName }}
              </span>
            </p>
          </div>
        </header>

        <div class="mt-12">
          <MarkdownContent :source="update.body" />
        </div>

        <section
          v-if="update.linkedFeedback.length"
          class="mt-14 rounded-2xl bg-gray-50 px-5 py-5 dark:bg-gray-900"
          aria-labelledby="delivered-feedback-heading"
        >
          <h2 id="delivered-feedback-heading" class="text-sm font-semibold">
            Delivered with this update
          </h2>
          <ul class="mt-3 space-y-2">
            <li
              v-for="feedback in update.linkedFeedback"
              :key="feedback.publicId"
            >
              <a
                :href="`${app.feedbackPath}/${feedback.publicId}`"
                class="text-sm text-gray-600 transition hover:text-gray-950 dark:text-gray-300 dark:hover:text-white"
              >
                {{ feedback.title }}
              </a>
            </li>
          </ul>
        </section>

        <footer class="mt-14 flex items-center justify-between gap-4">
          <p class="text-sm text-gray-400">{{ app.name }}</p>
          <ShareLinkButton
            :url="publicUrl"
            :title="update.title"
            :text="update.excerpt"
            show-label
          />
        </footer>
      </article>

      <footer
        class="mx-auto mt-20 max-w-prose text-center text-xs text-gray-400"
      >
        <a
          href="https://docs.sailscasts.com/slipway"
          target="_blank"
          rel="noreferrer"
          class="transition hover:text-gray-600 dark:hover:text-gray-300"
        >
          Powered by Slipway
        </a>
      </footer>
    </main>
  </div>
</template>
