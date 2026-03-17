<script setup>
defineProps({
  animated: {
    type: Boolean,
    default: true
  },
  processing: {
    type: Boolean,
    default: false
  }
})
</script>

<template>
  <svg
    viewBox="0 0 32 32"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    :class="{ processing }"
  >
    <!-- Mantle/Head -->
    <path
      d="M7 17 C7 3 25 3 25 17 Z"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <!-- Tentacles — each gets a unique animation -->
    <path
      :class="['tentacle t1', { animated }]"
      style="transform-origin: 7px 17px"
      d="M7 17 C4 21 4 25 8 28"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
    />
    <path
      :class="['tentacle t2', { animated }]"
      style="transform-origin: 12px 17px"
      d="M12 17 C11 21 10 25 13 28"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
    />
    <path
      :class="['tentacle t3', { animated }]"
      style="transform-origin: 20px 17px"
      d="M20 17 C21 21 22 25 19 28"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
    />
    <path
      :class="['tentacle t4', { animated }]"
      style="transform-origin: 25px 17px"
      d="M25 17 C28 21 28 25 24 28"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
    />
    <!-- Eyes -->
    <circle cx="13" cy="11" r="1.5" fill="currentColor" />
    <circle cx="19" cy="11" r="1.5" fill="currentColor" />
  </svg>
</template>

<style scoped>
.tentacle {
  transform-box: view-box;
}

/* Idle — gentle drift */
.t1.animated {
  animation: flow-1 2.8s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}
.t2.animated {
  animation: flow-2 2.2s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}
.t3.animated {
  animation: flow-3 2.4s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}
.t4.animated {
  animation: flow-4 3s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}

/* Processing — faster, more energetic */
.processing .t1.animated {
  animation-duration: 0.7s;
}
.processing .t2.animated {
  animation-duration: 0.55s;
}
.processing .t3.animated {
  animation-duration: 0.6s;
}
.processing .t4.animated {
  animation-duration: 0.75s;
}

/* Left outer — wide sweep */
@keyframes flow-1 {
  0%,
  100% {
    transform: rotate(0deg) skewX(0deg);
  }
  20% {
    transform: rotate(-7deg) skewX(-3deg);
  }
  50% {
    transform: rotate(9deg) skewX(4deg);
  }
  80% {
    transform: rotate(-4deg) skewX(-2deg);
  }
}

/* Left inner — subtle drift */
@keyframes flow-2 {
  0%,
  100% {
    transform: rotate(0deg) skewX(0deg);
  }
  30% {
    transform: rotate(5deg) skewX(2deg);
  }
  60% {
    transform: rotate(-4deg) skewX(-2deg);
  }
  85% {
    transform: rotate(2deg) skewX(1deg);
  }
}

/* Right inner — offset subtle drift */
@keyframes flow-3 {
  0%,
  100% {
    transform: rotate(0deg) skewX(0deg);
  }
  25% {
    transform: rotate(-4deg) skewX(-2deg);
  }
  55% {
    transform: rotate(5deg) skewX(3deg);
  }
  80% {
    transform: rotate(-2deg) skewX(-1deg);
  }
}

/* Right outer — wide sweep, opposite phase */
@keyframes flow-4 {
  0%,
  100% {
    transform: rotate(0deg) skewX(0deg);
  }
  15% {
    transform: rotate(6deg) skewX(3deg);
  }
  45% {
    transform: rotate(-9deg) skewX(-4deg);
  }
  75% {
    transform: rotate(5deg) skewX(3deg);
  }
}
</style>
