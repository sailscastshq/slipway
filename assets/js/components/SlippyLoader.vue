<script setup>
defineProps({
  size: {
    type: String,
    default: null
  }
})
</script>

<template>
  <svg
    :class="[size || 'h-5 w-5', 'slippy-loader']"
    viewBox="0 0 32 32"
    fill="none"
  >
    <!-- Head -->
    <path
      d="M7 17 C7 3 25 3 25 17 Z"
      stroke="currentColor"
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      fill="currentColor"
      fill-opacity="0.1"
    />
    <!-- Tentacles — each sways with a different delay -->
    <path class="slippy-t1" d="M7 17 C4 21 4 25 8 28" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
    <path class="slippy-t2" d="M12 17 C11 21 10 25 13 28" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
    <path class="slippy-t3" d="M20 17 C21 21 22 25 19 28" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
    <path class="slippy-t4" d="M25 17 C28 21 28 25 24 28" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
    <!-- Eyes -->
    <circle cx="13" cy="11" r="1.8" fill="currentColor" />
    <circle cx="19" cy="11" r="1.8" fill="currentColor" />
  </svg>
</template>

<style>
.slippy-loader {
  animation: slippy-bob 2s ease-in-out infinite;
}

.slippy-t1 { transform-origin: 7px 17px; animation: slippy-sway-wide 2.2s ease-in-out infinite; }
.slippy-t2 { transform-origin: 12px 17px; animation: slippy-sway-narrow 1.8s ease-in-out infinite 0.15s; }
.slippy-t3 { transform-origin: 20px 17px; animation: slippy-sway-narrow 1.8s ease-in-out infinite 0.35s; }
.slippy-t4 { transform-origin: 25px 17px; animation: slippy-sway-wide 2.2s ease-in-out infinite 0.5s; }

@keyframes slippy-bob {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-8%); }
}

@keyframes slippy-sway-wide {
  0%, 100% { transform: rotate(0deg); }
  25% { transform: rotate(10deg); }
  75% { transform: rotate(-10deg); }
}

@keyframes slippy-sway-narrow {
  0%, 100% { transform: rotate(0deg); }
  25% { transform: rotate(-6deg); }
  75% { transform: rotate(6deg); }
}
</style>
