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
    <path
      d="M3.5 7.5c0-1.24 1.01-2.25 2.25-2.25h3.1l2 2.25h7.9c.97 0 1.75.78 1.75 1.75v7.5c0 1.24-1.01 2.25-2.25 2.25H5.75A2.25 2.25 0 0 1 3.5 16.75z"
    />
    <path d="M3.5 9.5h17" />
  </svg>
</template>
