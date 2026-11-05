<script setup>
import { computed, ref, watch } from 'vue'
const props = defineProps({ appearance: Object, name: String })
const failedLight = ref(false)
const failedDark = ref(false)
const hasLight = computed(() =>
  Boolean(props.appearance?.logoLight && !failedLight.value)
)
const hasDark = computed(() =>
  Boolean(props.appearance?.logoDark && !failedDark.value)
)
watch(
  () => props.appearance?.logoLight,
  () => {
    failedLight.value = false
  }
)
watch(
  () => props.appearance?.logoDark,
  () => {
    failedDark.value = false
  }
)
</script>
<template>
  <span class="app-brand inline-flex min-w-0 max-w-full items-center gap-2.5">
    <span
      v-if="hasLight || hasDark"
      class="app-brand-logos inline-flex shrink-0 items-center rounded-md p-1"
      :class="{
        'app-brand-single': hasLight && !hasDark,
        'app-brand-dark-only': hasDark && !hasLight
      }"
    >
      <img
        v-if="hasLight"
        :src="appearance.logoLight"
        :alt="appearance.logoText || ''"
        class="app-logo-light max-w-28 h-7 object-contain"
        @error="failedLight = true"
      />
      <img
        v-if="hasDark"
        :src="appearance.logoDark"
        :alt="appearance.logoText || ''"
        class="app-logo-dark max-w-28 h-7 object-contain"
        @error="failedDark = true"
      />
    </span>
    <span class="truncate">{{ appearance?.displayName || name }}</span>
  </span>
</template>
