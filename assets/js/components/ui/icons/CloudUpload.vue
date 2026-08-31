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
      d="M7.25 18.5H6.5a3.75 3.75 0 0 1-.25-7.5A6.25 6.25 0 0 1 18 9.5a4.5 4.5 0 0 1-.5 9h-.75"
    />
    <path d="M12 20.25V12m-3 3 3-3 3 3" />
  </svg>
</template>
