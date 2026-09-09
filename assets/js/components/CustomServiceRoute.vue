<script setup>
import { computed, ref } from 'vue'
import { router } from '@inertiajs/vue3'
import Alert from '@/components/ui/alert/Alert.vue'
import Button from '@/components/ui/button/Button.vue'
import Input from '@/components/ui/input/Input.vue'
const props = defineProps({ service: Object, canManage: Boolean })
const route = computed(() => props.service.publicRoute || {})
const editing = ref(false),
  review = ref(null),
  busy = ref(false),
  error = ref('')
const domain = ref(''),
  port = ref(null)
const primary = 'min-h-0 px-3 py-1.5 text-sm'
const secondary =
  'min-h-0 bg-transparent px-3 py-1.5 text-gray-600 hover:bg-gray-100 dark:bg-transparent dark:text-gray-300 dark:hover:bg-gray-800'
function edit() {
  domain.value = route.value.domain || ''
  port.value = route.value.port || props.service.internalPort
  editing.value = true
  error.value = ''
}
function cancel() {
  editing.value = false
  review.value = null
  error.value = ''
}
async function perform(action, removal = false) {
  busy.value = true
  error.value = ''
  try {
    const response = await fetch(
      `/api/v1/services/${props.service.id}/public-route`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          ...(action === 'review'
            ? { domain: removal ? '' : domain.value, port: Number(port.value) }
            : { reviewId: review.value?.id })
        })
      }
    )
    const data = await response.json()
    if (!response.ok)
      throw new Error(data.message || 'The route change could not complete.')
    if (action === 'review') {
      review.value = data.review
      editing.value = false
    } else {
      cancel()
      router.reload({ only: ['service'], preserveScroll: true })
    }
  } catch (e) {
    error.value =
      e.message ||
      'Connection interrupted. Refresh to check the route before retrying.'
    if (action !== 'review') {
      review.value = null
      router.reload({ only: ['service'], preserveScroll: true })
    }
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <section
    class="space-y-3 border-b border-gray-200 p-4 text-sm text-gray-700 dark:border-gray-800 dark:text-gray-300"
    data-test="custom-service-route"
  >
    <h2 class="font-medium text-gray-900 dark:text-white">
      Public HTTP access
    </h2>
    <Alert
      v-if="error || route.error"
      role="alert"
      class="border border-red-200 bg-red-50 p-3 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
      >{{ error || route.error }}</Alert
    >
    <template v-if="route.operation">
      <p>
        {{
          service.status === 'changing'
            ? 'A route change is running. Wait for it to finish.'
            : 'The last route change did not finish. Recover the previous route before making another change.'
        }}
      </p>
      <Button
        v-if="canManage"
        :disabled="busy || service.status === 'changing'"
        :class="primary"
        @click="perform('recover')"
        >{{ busy ? 'Recovering…' : 'Recover previous route' }}</Button
      >
    </template>
    <form
      v-else-if="editing"
      class="space-y-4"
      @submit.prevent="perform('review')"
    >
      <div>
        <label :for="`service-domain-${service.id}`" class="block font-medium"
          >Domain</label
        >
        <Input
          :id="`service-domain-${service.id}`"
          v-model="domain"
          required
          placeholder="search.example.com"
          class="w-full border-0 border-b border-dashed border-gray-300 bg-transparent px-0 py-2 dark:border-gray-700 dark:bg-transparent"
        />
      </div>
      <div>
        <label
          :for="`service-http-port-${service.id}`"
          class="block font-medium"
          >Internal HTTP port</label
        >
        <Input
          :id="`service-http-port-${service.id}`"
          v-model="port"
          type="number"
          min="1"
          max="65535"
          required
          class="w-full border-0 border-b border-dashed border-gray-300 bg-transparent px-0 py-2 dark:border-gray-700 dark:bg-transparent"
        />
      </div>
      <p>
        Traffic goes through Caddy. This does not publish a Docker host port.
      </p>
      <div class="flex justify-end gap-2">
        <Button :disabled="busy" :class="secondary" @click="cancel"
          >Cancel</Button
        ><Button type="submit" :disabled="busy" :class="primary">{{
          busy ? 'Reviewing…' : 'Review route'
        }}</Button>
      </div>
    </form>
    <template v-else-if="review">
      <h3 class="font-medium">
        {{
          review.removal
            ? 'Make this service private?'
            : 'Publish this HTTP endpoint?'
        }}
      </h3>
      <p v-if="review.removal">
        The public route will be removed. The service, its data and private app
        connections stay in place.
      </p>
      <template v-else>
        <p class="break-all">
          https://{{ review.domain }} → {{ review.endpoint }}
        </p>
        <Alert
          class="bg-amber-50 p-3 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
          >Publishing does not add authentication. Enable access controls in the
          service before exposing private data.</Alert
        >
        <p>
          Route verification checks Caddy configuration. DNS and TLS must be
          verified separately.
        </p>
      </template>
      <div class="flex justify-end gap-2">
        <Button :disabled="busy" :class="secondary" @click="cancel"
          >Cancel</Button
        ><Button :disabled="busy" :class="primary" @click="perform('apply')">{{
          busy
            ? 'Applying…'
            : review.removal
            ? 'Remove public route'
            : 'Publish route'
        }}</Button>
      </div>
    </template>
    <template v-else>
      <template v-if="route.domain">
        <a
          :href="`https://${route.domain}`"
          target="_blank"
          rel="noopener noreferrer"
          class="break-all underline"
          >{{ route.domain }}</a
        >
        <p>
          HTTP port {{ route.port }} · Route {{ route.route }} · DNS unverified
          · TLS unverified
        </p>
        <p>
          Point this domain to the Slipway ingress. Open its HTTPS URL to verify
          public access and certificate issuance.
        </p>
      </template>
      <p v-else>Private. Reachable within the Slipway network.</p>
      <div v-if="canManage" class="flex flex-wrap justify-end gap-2">
        <Button
          v-if="route.domain"
          :disabled="busy"
          :class="secondary"
          @click="perform('review', true)"
          >Remove route</Button
        >
        <Button
          :disabled="busy || service.status !== 'running'"
          :class="primary"
          @click="edit"
          >{{ route.domain ? 'Change route' : 'Add public route' }}</Button
        >
      </div>
    </template>
  </section>
</template>
