<script setup>
import { ref, watch } from 'vue'
import { router } from '@inertiajs/vue3'
import Input from '@/components/ui/input/Input.vue'
import Button from '@/components/ui/button/Button.vue'
import Alert from '@/components/ui/alert/Alert.vue'
import Checkbox from '@/components/ui/checkbox/Checkbox.vue'
import Textarea from '@/components/ui/textarea/Textarea.vue'
const props = defineProps({
  projectSlug: String,
  environmentSlug: String,
  apps: { type: Array, default: () => [] }
})
const emit = defineEmits(['cancel'])
const image = ref(''),
  name = ref(''),
  port = ref(''),
  envText = ref(''),
  volumes = ref(''),
  command = ref(''),
  healthCommand = ref(''),
  cpus = ref('0.5'),
  memory = ref('256'),
  appIds = ref([]),
  review = ref(null),
  busy = ref(false),
  error = ref('')
const field =
  'focus:border-brand w-full min-w-0 rounded-none border-0 border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 focus:outline-none dark:border-gray-700 dark:bg-transparent dark:text-white'
watch(image, (value, previous) => {
  const suggest = (v) =>
    v
      .split('/')
      .pop()
      .split(/[:@]/)[0]
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
  if (!name.value || name.value === suggest(previous))
    name.value = suggest(value)
})
watch(
  [
    image,
    name,
    port,
    envText,
    volumes,
    command,
    healthCommand,
    cpus,
    memory,
    appIds
  ],
  () => {
    review.value = null
  },
  { deep: true }
)
function lines(text) {
  return text
    .split('\n')
    .map((v) => v.trim())
    .filter(Boolean)
}
async function request(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  const data = await response.json()
  if (!response.ok)
    throw Error(
      data.message ||
        'The operation could not complete. Retry when Docker is available.'
    )
  return data
}
async function inspect() {
  busy.value = true
  error.value = ''
  try {
    const env = {}
    for (const line of envText.value.split('\n').filter(Boolean)) {
      const at = line.indexOf('=')
      if (at < 1)
        throw Error('Enter environment variables as KEY=value, one per line.')
      env[line.slice(0, at)] = line.slice(at + 1)
    }
    const result = await request(
      `/api/v1/projects/${props.projectSlug}/environments/${props.environmentSlug}/services/custom/review`,
      {
        definition: {
          image: image.value,
          name: name.value,
          port: port.value,
          env,
          volumes: lines(volumes.value),
          command: lines(command.value),
          healthCommand: lines(healthCommand.value),
          cpus: Number(cpus.value),
          memoryMiB: Number(memory.value),
          appIds: appIds.value
        }
      }
    )
    review.value = result.review
  } catch (e) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}
async function create() {
  busy.value = true
  error.value = ''
  try {
    await request('/api/v1/services/custom', { reviewId: review.value.id })
    envText.value = ''
    emit('cancel')
    router.reload({ preserveScroll: true })
  } catch (e) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <form
    class="space-y-4"
    data-test="custom-service-form"
    @submit.prevent="review ? create() : inspect()"
  >
    <Alert
      v-if="error"
      role="alert"
      class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
      >{{ error }}</Alert
    >
    <fieldset v-if="!review" :disabled="busy" class="min-w-0 space-y-4">
      <div>
        <label for="custom-image" class="text-xs text-gray-500">Image</label
        ><Input
          id="custom-image"
          v-model="image"
          placeholder="registry/image:version"
          :class="field"
          :disabled="busy"
          required
          autocomplete="off"
        />
      </div>
      <div>
        <label for="custom-name" class="text-xs text-gray-500"
          >Service name</label
        ><Input
          id="custom-name"
          v-model="name"
          :class="field"
          :disabled="busy"
          required
        />
      </div>
      <p class="text-xs text-gray-500">
        Private connection. Slipway pins the image and uses its default startup
        command.
      </p>
      <details class="text-sm text-gray-600 dark:text-gray-400">
        <summary class="cursor-pointer">Advanced</summary>
        <div class="mt-3 space-y-3">
          <div>
            <label for="custom-port">Internal port</label
            ><Input
              id="custom-port"
              v-model="port"
              type="number"
              placeholder="Use the image's declared port"
              :class="field"
            />
          </div>
          <div>
            <label for="custom-env">Environment variables</label
            ><Textarea
              id="custom-env"
              v-model="envText"
              placeholder="KEY=value"
              autocomplete="off"
              spellcheck="false"
              :class="field"
            />
            <p class="text-xs">
              Stored encrypted. Only these variables are supplied to the
              service.
            </p>
          </div>
          <div>
            <label for="custom-volumes">Data paths</label
            ><Textarea
              id="custom-volumes"
              v-model="volumes"
              placeholder="One absolute container path per line"
              :class="field"
            />
            <p class="text-xs">
              Declared image volumes are included. Data is retained on removal
              by default.
            </p>
          </div>
          <div>
            <label for="custom-command">Startup command</label
            ><Textarea
              id="custom-command"
              v-model="command"
              placeholder="Optional: executable and each argument on separate lines"
              :class="field"
            />
          </div>
          <div>
            <label for="custom-health">Health command</label
            ><Textarea
              id="custom-health"
              v-model="healthCommand"
              placeholder="Optional: executable and each argument on separate lines"
              :class="field"
            />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label for="custom-cpus">CPU limit</label
              ><Input
                id="custom-cpus"
                v-model="cpus"
                type="number"
                step="0.1"
                :class="field"
              />
            </div>
            <div>
              <label for="custom-memory">Memory (MiB)</label
              ><Input
                id="custom-memory"
                v-model="memory"
                type="number"
                :class="field"
              />
            </div>
          </div>
        </div>
      </details>
      <fieldset v-if="apps.length" class="space-y-2">
        <legend class="mb-2 text-xs text-gray-500">
          Connect apps (optional)
        </legend>
        <label
          v-for="app in apps"
          :key="app.id"
          class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300"
          ><Checkbox
            :model-value="appIds.includes(String(app.id))"
            @update:model-value="
              (checked) =>
                (appIds = checked
                  ? [...appIds, String(app.id)]
                  : appIds.filter((id) => id !== String(app.id)))
            "
          />{{ app.name }}</label
        >
      </fieldset>
    </fieldset>
    <section
      v-else
      class="space-y-3 text-sm text-gray-700 dark:text-gray-300"
      data-test="custom-service-review"
    >
      <h3 class="font-medium text-gray-900 dark:text-white">
        Review {{ review.name }}
      </h3>
      <dl class="space-y-2">
        <div>
          <dt class="text-xs text-gray-500">Image</dt>
          <dd class="break-all">{{ review.image }}</dd>
          <dd class="break-all font-mono text-xs text-gray-500">
            {{ review.imageReference }}
          </dd>
        </div>
        <div>
          <dt class="text-xs text-gray-500">Connection</dt>
          <dd>
            Private ·
            {{
              review.port
                ? `port ${review.port}`
                : 'no primary endpoint selected'
            }}
          </dd>
        </div>
        <div>
          <dt class="text-xs text-gray-500">Health</dt>
          <dd>{{ review.health }}</dd>
        </div>
        <div>
          <dt class="text-xs text-gray-500">Resources</dt>
          <dd>{{ review.cpus }} CPU · {{ review.memoryMiB }} MiB</dd>
        </div>
        <div>
          <dt class="text-xs text-gray-500">Persistent data</dt>
          <dd class="break-all">
            {{ review.volumes.join(', ') || 'No data paths configured' }}
          </dd>
        </div>
        <div>
          <dt class="text-xs text-gray-500">Environment keys</dt>
          <dd class="break-all">{{ review.envKeys.join(', ') || 'None' }}</dd>
        </div>
        <div>
          <dt class="text-xs text-gray-500">Connected apps</dt>
          <dd>
            {{
              apps
                .filter((app) => review.appIds.includes(String(app.id)))
                .map((app) => app.name)
                .join(', ') || 'None'
            }}
          </dd>
        </div>
      </dl>
      <details>
        <summary class="cursor-pointer text-xs">View Docker command</summary>
        <pre class="mt-2 whitespace-pre-wrap break-all text-xs">{{
          review.dockerCommand
        }}</pre>
      </details>
    </section>
    <div class="flex justify-end gap-2">
      <Button
        type="button"
        :disabled="busy"
        class="bg-transparent px-3 py-2 text-sm text-gray-600 dark:bg-transparent dark:text-gray-300"
        @click="review ? (review = null) : emit('cancel')"
        >{{ review ? 'Back' : 'Cancel' }}</Button
      ><Button
        type="submit"
        :disabled="busy || !image || !name"
        class="bg-gray-900 px-3 py-2 text-sm text-white dark:bg-white dark:text-gray-900"
        >{{ busy ? 'Working…' : review ? 'Create' : 'Review' }}</Button
      >
    </div>
  </form>
</template>
