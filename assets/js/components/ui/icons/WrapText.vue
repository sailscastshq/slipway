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
    <path d="M4.25 6.5h15.5M4.25 11.5h11a3.25 3.25 0 0 1 0 6.5H11" />
    <path d="m13.75 15.25-2.75 2.75 2.75 2.75M4.25 18h3" />
  </svg>
</template>
