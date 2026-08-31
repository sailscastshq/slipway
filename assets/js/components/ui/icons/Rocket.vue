<script setup>
defineOptions({ inheritAttrs: false })
</script>

<template>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width="1em"
    height="1em"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
    data-slot="icon"
    v-bind="$attrs"
  >
    <path d="M9 14.75 5.75 14.5 3.75 16.5l4.6 1.15" />
    <path d="m14.75 9 .25-3.25-2-2-1.15 4.6" />
    <path
      d="M8.35 17.65 6.5 20.5l3.7-1 9.15-9.15c1.12-1.12 1.17-4.3.9-6.6-2.3-.27-5.48-.22-6.6.9L4.5 13.8l-1 3.7 2.85-1.85"
    />
    <circle cx="15.75" cy="8.25" r="1.75" />
  </svg>
</template>
