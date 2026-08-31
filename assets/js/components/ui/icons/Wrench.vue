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
      d="M14.25 5.25a4.5 4.5 0 0 0-5.5 5.5l-4.5 4.5a2.65 2.65 0 0 0 3.75 3.75l4.5-4.5a4.5 4.5 0 0 0 5.5-5.5l-2.75 2.75-3-3z"
    />
    <path d="M6.25 17h.01" stroke-width="2" />
  </svg>
</template>
