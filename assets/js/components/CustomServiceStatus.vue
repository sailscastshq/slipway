<script setup>
import { ref } from 'vue'
import { router } from '@inertiajs/vue3'
import Button from '@/components/ui/button/Button.vue'
import Alert from '@/components/ui/alert/Alert.vue'
import Checkbox from '@/components/ui/checkbox/Checkbox.vue'
const props = defineProps({
  service: Object,
  canManage: Boolean,
  apps: { type: Array, default: () => [] }
})
const error = ref(''),
  message = ref(''),
  busy = ref(false),
  editing = ref(false),
  selected = ref(props.service.customState?.appIds || [])
async function perform(path, method, body) {
  busy.value = true
  error.value = ''
  message.value = ''
  try {
    const response = await fetch(
      `/api/v1/services/${props.service.id}/${path}`,
      {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }
    )
    const data = await response.json()
    if (!response.ok)
      throw Error(data.message || 'The operation could not complete.')
    message.value = data.message || ''
    editing.value = false
    router.reload({ only: ['service'], preserveScroll: true })
  } catch (e) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}
function edit() {
  selected.value = [...(props.service.customState?.appIds || [])]
  editing.value = true
}
</script>
<template>
  <section
    class="space-y-3 border-b border-gray-200 p-4 text-sm text-gray-700 dark:border-gray-800 dark:text-gray-300"
    data-test="custom-service-status"
  >
    <h2 class="font-medium text-gray-900 dark:text-white">Custom image</h2>
    <p class="break-all">{{ service.customState?.image }}</p>
    <p>
      Health:
      {{
        {
          healthy: 'Healthy',
          unhealthy: 'Unhealthy',
          starting: 'Checking',
          unverified: 'Unverified'
        }[service.customState?.health] || 'Unverified'
      }}
    </p>
    <Alert
      v-if="
        error ||
        service.customState?.error ||
        service.customState?.health === 'unhealthy'
      "
      role="alert"
      class="rounded-lg border border-red-200 bg-red-50 p-3 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
      >{{
        error ||
        service.customState.error ||
        'The container is running but its health check is failing. Check its logs and configuration.'
      }}</Alert
    >
    <Alert
      v-if="message"
      role="status"
      class="rounded-lg border border-gray-200 p-3 dark:border-gray-700"
      >{{ message }}</Alert
    >
    <p v-if="service.customState?.observedAt" class="text-xs text-gray-500">
      Last checked
      {{ new Date(service.customState.observedAt).toLocaleString() }}
    </p>
    <p class="text-xs text-gray-500">
      Data volumes are retained by default on removal.
    </p>
    <p v-if="service.internalPort" class="break-all text-xs">
      Connections use {{ service.customState?.linkPrefix }}_HOST and
      {{ service.customState?.linkPrefix }}_PORT. Redeploy apps after changing
      their connections.
    </p>
    <form
      v-if="editing"
      class="space-y-3"
      @submit.prevent="perform('custom-links', 'PATCH', { appIds: selected })"
    >
      <label v-for="app in apps" :key="app.id" class="flex items-center gap-2"
        ><Checkbox
          :model-value="selected.includes(String(app.id))"
          @update:model-value="
            (checked) =>
              (selected = checked
                ? [...selected, String(app.id)]
                : selected.filter((id) => id !== String(app.id)))
          "
        />{{ app.name }}</label
      >
      <div class="flex justify-end gap-2">
        <Button
          type="button"
          :disabled="busy"
          class="bg-transparent px-3 py-2 text-gray-600 dark:bg-transparent dark:text-gray-300"
          @click="editing = false"
          >Cancel</Button
        ><Button
          type="submit"
          :disabled="busy"
          class="bg-gray-900 px-3 py-2 text-white dark:bg-white dark:text-gray-900"
          >Save connections</Button
        >
      </div>
    </form>
    <div v-else-if="canManage" class="flex justify-end gap-2">
      <Button
        :disabled="busy || !service.internalPort"
        class="bg-transparent px-3 py-2 text-gray-600 dark:bg-transparent dark:text-gray-300"
        @click="edit"
        >Connect apps</Button
      ><Button
        :disabled="busy"
        class="bg-gray-900 px-3 py-2 text-white dark:bg-white dark:text-gray-900"
        @click="perform('custom-state', 'POST', {})"
        >{{ busy ? 'Checking…' : 'Refresh status' }}</Button
      >
    </div>
  </section>
</template>
