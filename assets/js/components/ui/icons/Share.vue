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
    <circle cx="6" cy="12" r="2.25" />
    <circle cx="17.75" cy="6" r="2.25" />
    <circle cx="17.75" cy="18" r="2.25" />
    <path d="m8 10.9 7.75-3.8M8 13.1l7.75 3.8" />
  </svg>
</template>
