<script setup>
import { ref } from 'vue'
import { router } from '@inertiajs/vue3'
import ExternalPostgresFields from '@/components/ExternalPostgresFields.vue'
import Alert from '@/components/ui/alert/Alert.vue'
import Button from '@/components/ui/button/Button.vue'
const props = defineProps({ service: Object })
const busy = ref(false)
const editing = ref(false)
const form = ref({
  dsn: '',
  sslMode: props.service.externalTlsMode || 'verify-full',
  caCertificate: '',
  allowInsecure: false
})
function cancelEditing() {
  editing.value = false
  form.value.dsn = ''
}
async function save() {
  busy.value = true
  try {
    const response = await fetch(
      `/api/v1/services/${props.service.id}/external`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ configuration: form.value })
      }
    )
    const body = await response.json()
    if (!response.ok)
      throw new Error(body.message || 'The connection could not be saved.')
    result.value = { status: 'unverified', message: body.message }
    form.value.dsn = ''
    editing.value = false
    router.reload({ only: ['service'], preserveScroll: true })
  } catch (error) {
    result.value = { status: 'unreachable', message: error.message }
  } finally {
    busy.value = false
  }
}
const result = ref(props.service.externalVerification || {})
async function verify() {
  busy.value = true
  try {
    const response = await fetch(
      `/api/v1/services/${props.service.id}/verify-external`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      }
    )
    const body = await response.json()
    if (!response.ok)
      throw new Error(
        'Connection verification could not start. Check your access and retry.'
      )
    result.value = body.verification
    router.reload({ only: ['service'], preserveScroll: true })
  } catch (error) {
    result.value = { status: 'unreachable', message: error.message }
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <section class="space-y-3 p-4" data-test="external-database-status">
    <h2 class="text-sm font-medium text-gray-900 dark:text-white">
      External PostgreSQL
    </h2>
    <p class="text-sm text-gray-500">
      The database stays with its provider. Slipway verifies access and creates
      logical backups.
    </p>
    <Alert
      :role="result.status === 'unreachable' ? 'alert' : 'status'"
      :class="[
        'rounded-lg border p-3 text-sm',
        result.status === 'unreachable'
          ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300'
          : 'border-gray-200 text-gray-700 dark:border-gray-800 dark:text-gray-300'
      ]"
      >{{
        result.message || 'Verify the connection before creating backups.'
      }}</Alert
    >
    <p class="text-xs text-gray-500">
      Connection variable: {{ service.envVarKey }}. Restore through Slipway is
      disabled for external databases.
    </p>
    <form v-if="editing" class="space-y-4" @submit.prevent="save">
      <p class="text-xs text-gray-500">
        Leave the connection URL and CA blank to keep the saved values.
      </p>
      <ExternalPostgresFields v-model="form" />
      <div class="flex justify-end gap-2">
        <Button
          type="button"
          :disabled="busy"
          class="bg-transparent px-3 py-2 text-gray-600 dark:bg-transparent dark:text-gray-300"
          @click="cancelEditing"
          >Cancel</Button
        ><Button
          type="submit"
          :disabled="busy"
          class="bg-gray-900 px-3 py-2 text-white dark:bg-white dark:text-gray-900"
          >Save</Button
        >
      </div>
    </form>
    <div v-else class="flex justify-end gap-2">
      <Button
        :disabled="busy"
        class="bg-transparent px-3 py-2 text-sm text-gray-600 dark:bg-transparent dark:text-gray-300"
        @click="editing = true"
        >Edit connection</Button
      >
      <Button
        :disabled="busy"
        class="bg-gray-900 px-3 py-2 text-sm text-white dark:bg-white dark:text-gray-900"
        @click="verify"
        >{{ busy ? 'Verifying...' : 'Verify connection' }}</Button
      >
    </div>
  </section>
</template>
