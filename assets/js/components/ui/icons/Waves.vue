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
    <path d="M3 6c3-3 6 3 9 0s6 3 9 0" />
    <path d="M3 12c3-3 6 3 9 0s6 3 9 0" />
    <path d="M3 18c3-3 6 3 9 0s6 3 9 0" />
  </svg>
</template>
