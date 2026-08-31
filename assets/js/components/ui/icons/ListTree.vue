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
    <path d="M6 5.5v13M6 9h4M6 15h4" />
    <rect x="10" y="6.75" width="9.5" height="4.5" rx="1.5" />
    <rect x="10" y="12.75" width="9.5" height="4.5" rx="1.5" />
  </svg>
</template>
