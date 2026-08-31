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
      d="M3.75 5.25h5.5A2.75 2.75 0 0 1 12 8v11a3.75 3.75 0 0 0-3.25-1.75h-5z"
    />
    <path
      d="M20.25 5.25h-5.5A2.75 2.75 0 0 0 12 8v11a3.75 3.75 0 0 1 3.25-1.75h5z"
    />
  </svg>
</template>
