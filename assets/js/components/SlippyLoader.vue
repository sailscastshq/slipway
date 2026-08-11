<script setup>
import { computed, useAttrs } from 'vue'
import { twMerge } from 'tailwind-merge'

defineOptions({ inheritAttrs: false })

const attrs = useAttrs()

const forwardedAttrs = computed(() => {
  const { class: _class, 'aria-hidden': _ariaHidden, ...rest } = attrs
  return rest
})
</script>

<template>
  <svg
    v-bind="forwardedAttrs"
    aria-hidden="true"
    :class="twMerge('slippy-loader h-5 w-5', attrs.class)"
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
    <path
      class="slippy-t1"
      d="M7 17 C4 21 4 25 8 28"
      stroke="currentColor"
      stroke-width="2.5"
      stroke-linecap="round"
    />
    <path
      class="slippy-t2"
      d="M12 17 C11 21 10 25 13 28"
      stroke="currentColor"
      stroke-width="2.5"
      stroke-linecap="round"
    />
    <path
      class="slippy-t3"
      d="M20 17 C21 21 22 25 19 28"
      stroke="currentColor"
      stroke-width="2.5"
      stroke-linecap="round"
    />
    <path
      class="slippy-t4"
      d="M25 17 C28 21 28 25 24 28"
      stroke="currentColor"
      stroke-width="2.5"
      stroke-linecap="round"
    />
    <!-- Left eye -->
    <circle cx="13" cy="11" r="1.8" fill="currentColor" />
    <!-- Right eye — winks periodically -->
    <ellipse
      class="slippy-wink"
      cx="19"
      cy="11"
      rx="1.8"
      ry="1.8"
      fill="currentColor"
    />
  </svg>
</template>

<style>
.slippy-loader {
  animation: slippy-bob 1.6s ease-in-out infinite;
}

.slippy-t1 {
  transform-origin: 7px 17px;
  animation: slippy-sway-wide 1.8s ease-in-out infinite;
}
.slippy-t2 {
  transform-origin: 12px 17px;
  animation: slippy-sway-narrow 1.4s ease-in-out infinite 0.1s;
}
.slippy-t3 {
  transform-origin: 20px 17px;
  animation: slippy-sway-narrow 1.4s ease-in-out infinite 0.3s;
}
.slippy-t4 {
  transform-origin: 25px 17px;
  animation: slippy-sway-wide 1.8s ease-in-out infinite 0.45s;
}

.slippy-wink {
  animation: slippy-wink 4s ease-in-out infinite;
}

@keyframes slippy-bob {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-15%);
  }
}

@keyframes slippy-sway-wide {
  0%,
  100% {
    transform: rotate(0deg);
  }
  25% {
    transform: rotate(18deg);
  }
  75% {
    transform: rotate(-18deg);
  }
}

@keyframes slippy-sway-narrow {
  0%,
  100% {
    transform: rotate(0deg);
  }
  25% {
    transform: rotate(-12deg);
  }
  75% {
    transform: rotate(12deg);
  }
}

@keyframes slippy-wink {
  0%,
  38%,
  42%,
  100% {
    ry: 1.8;
  }
  40% {
    ry: 0.2;
  }
}

@media (prefers-reduced-motion: reduce) {
  .slippy-loader,
  .slippy-t1,
  .slippy-t2,
  .slippy-t3,
  .slippy-t4,
  .slippy-wink {
    animation: none;
  }
}
</style>
