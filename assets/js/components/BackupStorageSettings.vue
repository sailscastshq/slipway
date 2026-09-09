<script setup>
import { computed, reactive, ref } from 'vue'
import Alert from '@/components/ui/alert/Alert.vue'
import Button from '@/components/ui/button/Button.vue'
import Checkbox from '@/components/ui/checkbox/Checkbox.vue'
import Input from '@/components/ui/input/Input.vue'
import Select from '@/components/ui/select/Select.vue'
const props = defineProps({ configuration: Object })
const emit = defineEmits(['saved'])
const form = reactive({
  ...props.configuration,
  key: '',
  secret: '',
  sasToken: '',
  accountKey: ''
})
const busy = ref(false)
const message = ref('')
const failed = ref(false)
const field =
  'focus:border-brand w-full rounded-none border-0 border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 focus:outline-none dark:border-gray-700 dark:text-white'
const credentialsHint = computed(() =>
  form.hasCredentials ? 'Leave blank to keep saved credentials.' : ''
)
function changeProvider() {
  Object.assign(form, {
    bucket: '',
    endpoint: '',
    region: 'us-east-1',
    account: '',
    authMethod: 'sas',
    key: '',
    secret: '',
    sasToken: '',
    accountKey: '',
    hasCredentials: false,
    allowInsecure: false
  })
  message.value = ''
}
async function submit(testOnly) {
  if (busy.value) return
  busy.value = true
  message.value = ''
  try {
    const response = await fetch('/settings/backup-storage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': window.__SLIPWAY_CSRF_TOKEN__ || ''
      },
      body: JSON.stringify({ configuration: form, testOnly })
    })
    const result = await response.json()
    if (!response.ok)
      throw new Error(
        result.error ||
          'Backup storage could not be verified. Your settings have not changed.'
      )
    failed.value = false
    message.value = result.message
    if (!testOnly) {
      Object.assign(form, result.config, {
        key: '',
        secret: '',
        sasToken: '',
        accountKey: ''
      })
      emit('saved', result.config)
    }
  } catch (error) {
    failed.value = true
    message.value =
      error instanceof TypeError
        ? 'Connection interrupted. Check the current settings before retrying.'
        : error.message
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <section
    class="mt-8 rounded-lg border border-gray-200 dark:border-gray-800"
    data-test="backup-storage-settings"
    aria-labelledby="backup-storage-heading"
  >
    <div class="border-b border-gray-200 px-4 py-3 dark:border-gray-800">
      <h2
        id="backup-storage-heading"
        class="text-sm font-medium text-gray-900 dark:text-white"
      >
        Backup storage
      </h2>
      <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
        Keep database backups private. Existing backups retain their storage
        location.
      </p>
    </div>
    <form class="space-y-4 p-4" @submit.prevent="submit(false)">
      <fieldset :disabled="busy" class="space-y-4">
        <div>
          <label for="backup-provider" class="mb-1 block text-xs text-gray-500"
            >Provider</label
          >
          <Select
            id="backup-provider"
            v-model="form.provider"
            :class="field"
            :options="[
              { value: 'shared', label: 'Use file storage settings' },
              { value: 's3', label: 'S3-compatible storage' },
              { value: 'azure', label: 'Azure Blob Storage' }
            ]"
            @change="changeProvider"
          />
        </div>
        <p v-if="form.provider === 'shared'" class="text-sm text-gray-500">
          Use the credentials above. Backup objects must deny anonymous access.
        </p>
        <template v-else>
          <div v-if="form.provider === 'azure'">
            <label for="backup-account" class="mb-1 block text-xs text-gray-500"
              >Storage account</label
            >
            <Input
              id="backup-account"
              v-model="form.account"
              required
              :class="field"
              autocomplete="off"
            />
          </div>
          <div>
            <label
              for="backup-bucket"
              class="mb-1 block text-xs text-gray-500"
              >{{ form.provider === 'azure' ? 'Container' : 'Bucket' }}</label
            >
            <Input
              id="backup-bucket"
              v-model="form.bucket"
              required
              :class="field"
              autocomplete="off"
            />
          </div>
          <template v-if="form.provider === 'azure'">
            <div>
              <label for="backup-auth" class="mb-1 block text-xs text-gray-500"
                >Authentication</label
              >
              <Select
                id="backup-auth"
                v-model="form.authMethod"
                :class="field"
                :options="[
                  { value: 'sas', label: 'Scoped SAS token' },
                  { value: 'account-key', label: 'Account key' }
                ]"
              />
            </div>
            <div v-if="form.authMethod === 'sas'">
              <label for="backup-sas" class="mb-1 block text-xs text-gray-500"
                >SAS token</label
              >
              <Input
                id="backup-sas"
                v-model="form.sasToken"
                type="password"
                autocomplete="new-password"
                :class="field"
                aria-describedby="backup-credentials-help"
              />
              <p class="mt-1 text-xs text-gray-500">
                Container-scoped, with read, write, delete and a future expiry.
              </p>
            </div>
            <div v-else>
              <label
                for="backup-account-key"
                class="mb-1 block text-xs text-gray-500"
                >Account key</label
              >
              <Input
                id="backup-account-key"
                v-model="form.accountKey"
                type="password"
                autocomplete="new-password"
                :class="field"
                aria-describedby="backup-credentials-help"
              />
            </div>
          </template>
          <template v-else>
            <div>
              <label
                for="backup-region"
                class="mb-1 block text-xs text-gray-500"
                >Region</label
              >
              <Input
                id="backup-region"
                v-model="form.region"
                required
                :class="field"
              />
            </div>
            <div>
              <label for="backup-key" class="mb-1 block text-xs text-gray-500"
                >Access key</label
              >
              <Input
                id="backup-key"
                v-model="form.key"
                type="password"
                autocomplete="new-password"
                :class="field"
                aria-describedby="backup-credentials-help"
              />
            </div>
            <div>
              <label
                for="backup-secret"
                class="mb-1 block text-xs text-gray-500"
                >Secret key</label
              >
              <Input
                id="backup-secret"
                v-model="form.secret"
                type="password"
                autocomplete="new-password"
                :class="field"
                aria-describedby="backup-credentials-help"
              />
            </div>
          </template>
          <p id="backup-credentials-help" class="text-xs text-gray-500">
            {{ credentialsHint }}
          </p>
          <details :open="Boolean(form.endpoint)">
            <summary
              class="cursor-pointer text-sm text-gray-600 dark:text-gray-400"
            >
              Custom endpoint
            </summary>
            <div class="mt-3">
              <label
                for="backup-endpoint"
                class="mb-1 block text-xs text-gray-500"
                >Endpoint URL</label
              >
              <Input
                id="backup-endpoint"
                v-model="form.endpoint"
                type="url"
                placeholder="https://storage.example.com"
                :class="field"
              />
              <label
                v-if="form.endpoint.startsWith('http:')"
                class="mt-3 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400"
              >
                <Checkbox v-model="form.allowInsecure" /> Allow HTTP on a
                trusted private network
              </label>
            </div>
          </details>
        </template>
      </fieldset>
      <Alert
        v-if="message"
        :role="failed ? 'alert' : 'status'"
        :class="[
          'break-words rounded-lg border p-3 text-sm',
          failed
            ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300'
            : 'border-gray-200 text-gray-700 dark:border-gray-800 dark:text-gray-300'
        ]"
        >{{ message }}</Alert
      >
      <div class="flex justify-end gap-2">
        <Button
          type="button"
          :disabled="busy"
          class="border border-gray-200 bg-transparent px-3 py-2 text-sm text-gray-700 dark:border-gray-700 dark:bg-transparent dark:text-gray-300"
          @click="submit(true)"
          >Test connection</Button
        >
        <Button
          type="submit"
          :disabled="busy"
          class="bg-gray-900 px-3 py-2 text-sm text-white dark:bg-white dark:text-gray-900"
          >{{ busy ? 'Verifying...' : 'Save' }}</Button
        >
      </div>
    </form>
  </section>
</template>
