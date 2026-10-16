<script setup>
import { computed, ref } from 'vue'
import { useForm } from '@inertiajs/vue3'
import Switch from '@/components/ui/switch/Switch.vue'
import Checkbox from '@/components/ui/checkbox/Checkbox.vue'
import { submitInertiaForm } from '@/lib/inertia-mutation'
const props = defineProps({
  app: Object,
  config: Object,
  paths: Array,
  url: String,
  canManage: Boolean
})
const form = useForm({
  enabled: props.config.enabled,
  paths: [...props.config.paths],
  acknowledged: false
})
const error = ref('')
const prefix = computed(() =>
  props.app.routePath === '/'
    ? ''
    : props.app.routePath?.replace(/\/$/, '') || ''
)
async function save() {
  error.value = ''
  try {
    await submitInertiaForm(form, 'patch', props.url)
    form.acknowledged = false
  } catch (failure) {
    error.value = failure.message
  }
}
</script>

<template>
  <section
    aria-labelledby="decoys-heading"
    class="space-y-5 py-8"
    data-testid="decoy-settings"
  >
    <div class="flex items-start justify-between gap-6">
      <div>
        <h2
          id="decoys-heading"
          class="text-base font-semibold text-gray-900 dark:text-white"
        >
          Lookout Decoys
        </h2>
        <p class="mt-1 max-w-xl text-sm text-gray-500 dark:text-gray-400">
          Turn probes for unused credential files into a separate signal in
          Lookout.
        </p>
      </div>
      <Switch
        v-model="form.enabled"
        aria-label="Enable Lookout Decoys"
        :disabled="!canManage || form.processing"
        class="checked:bg-brand dark:checked:bg-brand"
      />
    </div>
    <p class="text-xs font-medium text-gray-500 dark:text-gray-400">
      {{
        config.enabled
          ? app.hostPort
            ? 'Configured · proxy route verified when saved'
            : 'Configured · applies on first deployment'
          : 'Off · no paths intercepted'
      }}
    </p>
    <form class="space-y-5" @submit.prevent="save">
      <fieldset
        v-if="form.enabled"
        :disabled="!canManage || form.processing"
        class="space-y-3"
      >
        <legend
          class="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          Choose verified-unused paths
        </legend>
        <label
          v-for="path in paths"
          :key="path"
          class="flex cursor-pointer items-center gap-3 text-sm text-gray-700 dark:text-gray-300"
        >
          <Checkbox
            v-model="form.paths"
            :value="path"
            class="text-brand h-4 w-4 rounded border-gray-300 focus-visible:outline focus-visible:outline-2 dark:border-gray-600"
          />
          <code class="break-all">{{ prefix }}{{ path }}</code>
        </label>
        <p
          id="decoy-warning"
          class="pt-2 text-sm leading-relaxed text-gray-500 dark:text-gray-400"
        >
          These responses replace your app’s handler for the selected paths.
          Slipway cannot discover dynamic routes inside your app. Enable only
          paths you have verified are unused.
        </p>
        <label
          class="flex items-start gap-3 text-sm text-gray-700 dark:text-gray-300"
        >
          <Checkbox
            v-model="form.acknowledged"
            aria-describedby="decoy-warning"
            class="text-brand mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300"
          />
          I verified that the selected paths are unused.
        </label>
        <p class="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
          Fixed, harmless JSON · GET/HEAD only · no credentials or callbacks.
          Observations are sampled, collected about every five minutes and
          retained for seven days. This does not rate-limit incoming traffic.
        </p>
      </fieldset>
      <p
        v-if="error || form.errors.decoys"
        role="alert"
        class="text-sm text-red-600 dark:text-red-400"
      >
        {{ form.errors.decoys || error }}
      </p>
      <button
        v-if="canManage"
        type="submit"
        :disabled="form.processing || (form.enabled &amp;&amp; (!form.acknowledged || !form.paths.length))"
        class="bg-brand rounded-md px-3 py-2 text-sm font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {{ form.processing ? 'Applying…' : 'Save decoy settings' }}
      </button>
      <p v-else class="text-sm text-gray-500 dark:text-gray-400">
        A team owner or admin can configure decoys.
      </p>
    </form>
  </section>
</template>
