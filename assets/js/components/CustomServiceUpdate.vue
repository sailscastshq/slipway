<script setup>
import { computed, ref } from 'vue'
import { router } from '@inertiajs/vue3'
import Alert from '@/components/ui/alert/Alert.vue'
import Button from '@/components/ui/button/Button.vue'
import Input from '@/components/ui/input/Input.vue'
import Textarea from '@/components/ui/textarea/Textarea.vue'
import Checkbox from '@/components/ui/checkbox/Checkbox.vue'
const props = defineProps({ service: Object, canManage: Boolean })
const editing = ref(false),
  review = ref(null),
  busy = ref(false),
  error = ref('')
const image = ref(''),
  env = ref(''),
  command = ref(''),
  health = ref(''),
  cpus = ref(''),
  memory = ref('')
const replaceEnv = ref(false),
  replaceCommand = ref(false),
  replaceHealth = ref(false)
const persistent = computed(() => props.service.customState?.volumes?.length)
const operation = computed(() => props.service.customState?.update)
const field =
  'focus:border-brand focus:outline-none w-full min-w-0 rounded-none border-0 border-b border-dashed border-gray-300 bg-transparent px-0 py-2 text-sm dark:border-gray-700 dark:bg-transparent'
const secondary =
  'bg-transparent px-3 py-2 text-gray-600 dark:bg-transparent dark:text-gray-300'
function cancel() {
  editing.value = false
  review.value = null
  env.value = ''
  command.value = ''
  health.value = ''
}
function edit() {
  image.value = props.service.customState.image
  cpus.value = ''
  memory.value = ''
  replaceEnv.value = false
  replaceCommand.value = false
  replaceHealth.value = false
  error.value = ''
  editing.value = true
}
async function perform(action) {
  busy.value = true
  error.value = ''
  try {
    const changes = { image: image.value }
    if (action === 'review') {
      if (cpus.value) changes.cpus = Number(cpus.value)
      if (memory.value) changes.memoryMiB = Number(memory.value)
      if (replaceCommand.value)
        changes.command = command.value.split('\n').filter(Boolean)
      if (replaceHealth.value)
        changes.healthCommand = health.value.split('\n').filter(Boolean)
      if (replaceEnv.value) {
        changes.env = {}
        for (const line of env.value.split('\n').filter(Boolean)) {
          const at = line.indexOf('=')
          if (at < 1) throw Error('Enter variables as KEY=value, one per line.')
          changes.env[line.slice(0, at)] = line.slice(at + 1)
        }
      }
    }
    const response = await fetch(
      `/api/v1/services/${props.service.id}/custom-update`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          ...(action === 'review' ? { changes } : {}),
          reviewId: review.value?.id
        })
      }
    )
    const data = await response.json()
    if (!response.ok)
      throw Error(data.message || 'The update could not complete.')
    if (data.review) {
      review.value = data.review
      editing.value = false
      env.value = ''
      command.value = ''
      health.value = ''
    } else {
      cancel()
      router.reload({ only: ['service'], preserveScroll: true })
    }
  } catch (e) {
    error.value = e.message
    if (['apply', 'recover'].includes(action)) {
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
    data-test="custom-service-update"
    class="space-y-3 border-b border-gray-200 p-4 text-sm text-gray-700 dark:border-gray-800 dark:text-gray-300"
  >
    <h2 class="font-medium text-gray-900 dark:text-white">
      Image and configuration
    </h2>
    <Alert
      v-if="error"
      role="alert"
      class="rounded-lg border border-red-200 bg-red-50 p-3 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
      >{{ error }}</Alert
    >
    <Alert
      v-if="persistent"
      role="status"
      class="rounded-lg border border-gray-200 p-3 dark:border-gray-700"
      >This service has persistent data. Automated updates require an
      application-consistent recovery method and are unavailable here.</Alert
    >
    <template v-else-if="operation">
      <p>
        {{
          service.status === 'changing'
            ? 'Checking the candidate and applying the update…'
            : 'The update was interrupted. Restore the previous image and configuration before continuing.'
        }}
      </p>
      <Button
        v-if="canManage"
        :disabled="busy || service.status === 'changing'"
        @click="perform('recover')"
        >Recover previous image</Button
      >
    </template>
    <form
      v-else-if="editing"
      class="space-y-4"
      @submit.prevent="perform('review')"
    >
      <fieldset :disabled="busy" class="min-w-0 space-y-4">
        <div>
          <label for="update-image">Image</label
          ><Input
            id="update-image"
            v-model="image"
            :class="field"
            required
            autocomplete="off"
          />
        </div>
        <details>
          <summary class="cursor-pointer">Configuration changes</summary>
          <div class="mt-3 space-y-3">
            <p>
              Existing values are kept unless you replace them. Secrets are
              never loaded into this form.
            </p>
            <label class="flex items-center gap-2"
              ><Checkbox v-model="replaceEnv" />Replace environment
              variables</label
            >
            <template v-if="replaceEnv"
              ><p class="text-xs">
                Supply the complete set, including credentials. An empty set
                removes all custom variables. Connected apps may also need
                credential changes.
              </p>
              <Textarea
                v-model="env"
                aria-label="New environment variables"
                placeholder="KEY=value"
                autocomplete="off"
                spellcheck="false"
                :class="field"
            /></template>
            <label class="flex items-center gap-2"
              ><Checkbox v-model="replaceCommand" />Replace startup
              command</label
            >
            <Textarea
              v-if="replaceCommand"
              v-model="command"
              aria-label="New startup command"
              placeholder="Executable and each argument on separate lines"
              :class="field"
            />
            <label class="flex items-center gap-2"
              ><Checkbox v-model="replaceHealth" />Replace health check</label
            >
            <Textarea
              v-if="replaceHealth"
              v-model="health"
              aria-label="New health check"
              placeholder="Executable and each argument on separate lines"
              :class="field"
            />
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label for="update-cpus">CPUs</label
                ><Input
                  id="update-cpus"
                  v-model="cpus"
                  placeholder="Keep current"
                  type="number"
                  step="0.1"
                  :class="field"
                />
              </div>
              <div>
                <label for="update-memory">Memory (MiB)</label
                ><Input
                  id="update-memory"
                  v-model="memory"
                  placeholder="Keep current"
                  type="number"
                  :class="field"
                />
              </div>
            </div>
          </div>
        </details>
      </fieldset>
      <div class="flex justify-end gap-2">
        <Button
          type="button"
          :disabled="busy"
          :class="secondary"
          @click="cancel"
          >Cancel</Button
        ><Button type="submit" :disabled="busy">{{
          busy ? 'Reviewing…' : 'Review update'
        }}</Button>
      </div>
    </form>
    <template v-else-if="review">
      <p class="break-all">
        {{ review.before.image }} → {{ review.after.image }}
      </p>
      <p class="break-all text-xs text-gray-500">
        Pinned image: {{ review.imageReference }}
      </p>
      <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt>CPUs</dt>
        <dd>{{ review.before.cpus }} → {{ review.after.cpus }}</dd>
        <dt>Memory</dt>
        <dd>
          {{ review.before.memoryMiB }} → {{ review.after.memoryMiB }} MiB
        </dd>
        <dt>Variables</dt>
        <dd class="min-w-0 break-words">
          {{ review.after.envKeys.join(', ') || 'None'
          }}{{
            review.changed.includes('env')
              ? ' (values replaced)'
              : ' (unchanged)'
          }}
        </dd>
        <dt>Startup command</dt>
        <dd>
          {{ review.changed.includes('command') ? 'Replaced' : 'Unchanged' }}
        </dd>
        <dt>Health check</dt>
        <dd>
          {{
            review.changed.includes('healthCommand') ? 'Replaced' : 'Unchanged'
          }}
        </dd>
      </dl>
      <Alert
        role="status"
        class="rounded-lg border border-gray-200 p-3 dark:border-gray-700"
        >The candidate runs alongside the current service for its health check.
        Cutover briefly interrupts connections. The hostname and connected apps
        stay the same. Revert image restores configuration, including old
        credentials; it does not restore external data or undo side
        effects.</Alert
      >
      <div class="flex justify-end gap-2">
        <Button :disabled="busy" :class="secondary" @click="cancel"
          >Cancel</Button
        ><Button :disabled="busy" @click="perform('apply')">{{
          busy ? 'Applying…' : review.revert ? 'Revert image' : 'Apply update'
        }}</Button>
      </div>
    </template>
    <template v-else>
      <p>
        Review a pinned image and check its health before replacing this
        stateless service. Previous containers are retained until you remove the
        service.
      </p>
      <div v-if="canManage" class="flex justify-end gap-2">
        <Button
          v-if="service.customState?.previousImage"
          :disabled="busy || service.status !== 'running'"
          :class="secondary"
          @click="perform('revert')"
          >Revert image</Button
        ><Button
          :disabled="
            busy ||
            service.status !== 'running' ||
            !!service.publicRoute?.operation
          "
          @click="edit"
          >Update image</Button
        >
      </div>
    </template>
  </section>
</template>
