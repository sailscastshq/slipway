<script setup>
import InfoCircle from '@/components/ui/icons/InfoCircle.vue'
import Check from '@/components/ui/icons/Check.vue'
import X from '@/components/ui/icons/X.vue'
const props = defineProps({ result: { type: Object, required: true } })
const emit = defineEmits(['dismiss'])
</script>
<template>
  <article
    data-test="bridge-action-result-toast"
    class="w-full min-w-0 rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900"
    aria-live="off"
  >
    <p class="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {{ result.title }}.
      {{ result.counts?.map((c) => `${c.value} ${c.label}`).join(', ') }}
    </p>
    <div class="flex items-start gap-3">
      <component
        :is="
          result.type === 'success'
            ? Check
            : result.type === 'error'
            ? X
            : InfoCircle
        "
        class="mt-0.5 h-5 w-5 shrink-0"
        :class="
          result.type === 'success'
            ? 'text-green-500'
            : result.type === 'error'
            ? 'text-red-500'
            : result.type === 'warning'
            ? 'text-amber-500'
            : 'text-blue-500'
        "
        aria-hidden="true"
      />
      <div class="min-w-0 flex-1">
        <h2 class="text-sm font-semibold text-gray-900 dark:text-white">
          {{ result.title }}
        </h2>
      </div>
      <button
        type="button"
        class="size-8 -mr-1 -mt-1 grid shrink-0 cursor-pointer place-items-center rounded text-gray-400 hover:text-gray-600 focus-visible:outline-2 dark:hover:text-gray-200"
        :aria-label="`Close ${result.title}`"
        @click="emit('dismiss')"
      >
        <X class="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
    <div
      class="ml-8 max-h-[min(32rem,calc(100dvh-10rem))] min-w-0 overflow-y-auto overscroll-contain"
      tabindex="0"
      :aria-label="`${result.title} content`"
    >
      <p
        v-if="result.counts?.length"
        class="mt-2 text-sm font-semibold text-gray-900 dark:text-white"
      >
        {{
          result.counts
            .map((c) => `${c.value.toLocaleString()} ${c.label}`)
            .join(' · ')
        }}
      </p>
      <p
        v-if="result.subject"
        class="wrap-anywhere mt-3 text-sm text-gray-700 dark:text-gray-300"
      >
        Subject: {{ result.subject }}
      </p>
      <component
        :is="result.detailsLabel ? 'details' : 'div'"
        v-if="result.items?.length"
        class="mt-3"
      >
        <summary
          v-if="result.detailsLabel"
          class="cursor-pointer text-sm text-gray-800 focus-visible:outline-2 dark:text-gray-200"
        >
          {{ result.detailsLabel }}
        </summary>
        <ul
          tabindex="0"
          :aria-label="`${result.title} details`"
          class="mt-2 max-h-[min(12rem,28dvh)] list-none space-y-1 overflow-y-auto overscroll-contain pr-2 text-sm text-gray-700 focus-visible:outline-2 dark:text-gray-300"
        >
          <li
            v-for="(item, index) in result.items"
            :key="index"
            class="wrap-anywhere whitespace-pre-wrap"
          >
            {{ item }}
          </li>
        </ul>
      </component>
      <p v-if="result.omittedItems" class="mt-2 text-xs text-gray-500">
        {{ result.omittedItems }} additional items omitted. Narrow your
        selection to inspect them.
      </p>
      <p
        v-if="result.message"
        class="wrap-anywhere mt-3 whitespace-pre-wrap text-xs text-gray-500 dark:text-gray-400"
      >
        {{ result.message }}
      </p>
    </div>
  </article>
</template>
