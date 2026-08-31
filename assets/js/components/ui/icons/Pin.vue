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
    <path d="m8 4.25 8-.5-.5 5.5 2.25 2.25-4.5 1.5-4.75 4.75-.25-6.25-2-2z" />
    <path d="m8.5 17.5-3 3" />
  </svg>
</template>
