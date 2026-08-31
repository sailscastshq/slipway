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
      d="M12 3.25c-2.7 2-4.15 5.05-3.9 8.4l.9 4.6h6l.9-4.6c.25-3.35-1.2-6.4-3.9-8.4Z"
    />
    <circle cx="12" cy="9.25" r="1.5" />
    <path
      d="m8.45 12.75-3.2 2.75v3l3.95-1.75M15.55 12.75l3.2 2.75v3l-3.95-1.75"
    />
    <path d="M10 19c.4 1.05 1.05 1.7 2 2 .95-.3 1.6-.95 2-2" />
  </svg>
</template>
