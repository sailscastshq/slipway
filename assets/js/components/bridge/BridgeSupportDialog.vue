<script setup>
import { ref, watch } from 'vue'
import Dialog from '@/components/ui/dialog/Dialog.vue'
import Alert from '@/components/ui/alert/Alert.vue'
import Input from '@/components/ui/input/Input.vue'
import Textarea from '@/components/ui/textarea/Textarea.vue'
import Button from '@/components/ui/button/Button.vue'
const props = defineProps({ show: Boolean, url: String, appName: String })
const emit = defineEmits(['close'])
const reason = ref(''),
  password = ref(''),
  busy = ref(false),
  error = ref('')
watch(
  () => props.show,
  () => {
    reason.value = ''
    password.value = ''
    error.value = ''
  }
)
const field =
  'focus:border-brand w-full rounded-none border-0 border-b border-dashed border-gray-300 bg-transparent px-0 py-2 focus:outline-none dark:border-gray-700 dark:bg-transparent'
async function start() {
  busy.value = true
  error.value = ''
  try {
    const response = await fetch(props.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: reason.value, password: password.value })
    })
    const data = await response.json()
    if (!response.ok)
      throw Error(
        data.message ||
          'The support view could not start. Confirm your password and the app configuration.'
      )
    password.value = ''
    window.location.assign(data.url)
  } catch (e) {
    error.value = e.message
    password.value = ''
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <Dialog
    :open="show"
    :dismissible="!busy"
    aria-labelledby="support-title"
    class="w-[calc(100%_-_2rem)] max-w-lg rounded-lg border border-gray-200 bg-white p-6 text-gray-900 shadow-xl backdrop:bg-black/50 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
    @update:open="(value) => !value && emit('close')"
  >
    <form class="space-y-4" @submit.prevent="start">
      <h2 id="support-title" class="text-lg font-semibold">
        View {{ appName }} as this user
      </h2>
      <p class="text-sm text-gray-500">
        This read-only support view ends after 15 minutes. Only the app’s
        approved support pages are available. Your normal app login stays
        intact.
      </p>
      <Alert
        v-if="error"
        role="alert"
        class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
        >{{ error }}</Alert
      >
      <div>
        <label for="support-reason" class="text-sm">Reason</label
        ><Textarea
          id="support-reason"
          v-model="reason"
          minlength="10"
          maxlength="500"
          required
          :disabled="busy"
          :class="field"
          placeholder="Investigating missing invoice access"
        />
      </div>
      <div>
        <label for="support-password" class="text-sm"
          >Confirm your Slipway password</label
        ><Input
          id="support-password"
          v-model="password"
          type="password"
          autocomplete="current-password"
          required
          :disabled="busy"
          :class="field"
        />
      </div>
      <div class="flex justify-end gap-2">
        <Button
          type="button"
          :disabled="busy"
          class="bg-transparent px-3 py-2 text-gray-600 dark:bg-transparent dark:text-gray-300"
          @click="emit('close')"
          >Cancel</Button
        ><Button type="submit" :disabled="busy">{{
          busy ? 'Starting…' : 'Start support view'
        }}</Button>
      </div>
    </form>
  </Dialog>
</template>
