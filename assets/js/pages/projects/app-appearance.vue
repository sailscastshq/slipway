<script setup>
import { computed, ref, watch } from 'vue'
import { Head, Link, useForm } from '@inertiajs/vue3'
import AppLayout from '@/layouts/AppLayout.vue'
import Input from '@/components/ui/input/Input.vue'
import BareSelect from '@/components/BareSelect.vue'
import AppearancePreview from '@/components/appearance/AppearancePreview.vue'
import contract from '../../../../api/lib/app-appearance'
defineOptions({ layout: AppLayout })
const props = defineProps({
  project: Object,
  environment: Object,
  app: Object,
  appearance: Object,
  widgetStyles: String
})
const base = computed(
  () =>
    `/projects/${props.project.slug}/environments/${props.environment.slug}/apps/${props.app.slug}`
)
function draft(value) {
  const { configured, ...result } = value
  return JSON.parse(JSON.stringify(result))
}
const form = useForm({ appearance: draft(props.appearance) })
const palette = ref('light')
function selectPalette(choice) {
  palette.value = choice
  mode.value = choice
}
const mode = ref('light')
const surface = ref('feedback')
const widget = ref(true)
const mobile = ref(false)
const error = ref('')
const saving = ref(false)
const notice = ref('')
const labels = {
  canvas: 'Background',
  surface: 'Surface',
  text: 'Text',
  mutedText: 'Secondary text',
  border: 'Border',
  accent: 'Accent',
  accentText: 'On accent',
  focus: 'Focus ring'
}
const warnings = computed(() =>
  contract.warnings(contract.normalize(form.appearance))
)
watch(
  () => props.appearance,
  (value) => {
    form.appearance = draft(value)
    form.defaults({ appearance: draft(value) })
  }
)
async function logo(event, slot) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  if (
    !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
    file.size > 256 * 1024
  ) {
    error.value = 'Choose a PNG, JPEG or WebP logo smaller than 256 KB.'
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    form.appearance[slot] = reader.result
    error.value = ''
  }
  reader.readAsDataURL(file)
}
async function save(reset = false) {
  error.value = ''
  notice.value = ''
  saving.value = true
  const value = JSON.parse(JSON.stringify(form.appearance))
  for (const slot of ['logoLight', 'logoDark'])
    if (value[slot] && value[slot] === props.appearance[slot])
      value[slot] = 'keep'
  try {
    const response = await fetch(`${base.value}/appearance`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Inertia': 'true'
      },
      body: JSON.stringify({ appearance: value, reset })
    })
    if (!response.ok) {
      let result
      try {
        result = await response.json()
      } catch {}
      throw new Error(
        result?.message || 'Appearance could not be saved. Please try again.'
      )
    }
    // Fetch fresh props through Inertia to preserve the page and flash feedback.
    const { router } = await import('@inertiajs/vue3')
    router.reload({
      only: ['appearance', 'flash'],
      onSuccess: () => {
        notice.value = reset
          ? 'Default appearance restored.'
          : 'Appearance saved.'
      }
    })
  } catch (e) {
    error.value = e.message
  } finally {
    saving.value = false
  }
}
function resetDraft() {
  form.appearance = {
    ...contract.normalize({}, props.project.name),
    logoLight: null,
    logoDark: null
  }
  notice.value = 'Previewing defaults. Save to apply them.'
}
</script>
<template>
  <Head :title="`${app.name} appearance | Slipway`" />
  <div
    class="flex h-full min-h-0 flex-col overflow-y-auto text-gray-950 dark:text-white"
  >
    <header
      class="border-b border-gray-200 px-5 py-5 dark:border-gray-800 sm:px-8"
    >
      <Link
        :href="`${base}/settings`"
        class="text-sm text-gray-500 hover:text-gray-900 dark:hover:text-white"
        >{{ project.name }} / {{ environment.name }} /
        {{ app.name }} settings</Link
      >
    </header>
    <div class="mx-auto w-full max-w-[1500px] px-5 py-8 sm:px-8 lg:py-10">
      <div class="mb-8 flex flex-wrap items-start justify-between gap-5">
        <div>
          <h1 class="text-2xl font-semibold tracking-tight">App appearance</h1>
          <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Make feedback feel at home in
            {{ form.appearance.displayName || project.name }}.
          </p>
        </div>
        <div class="flex items-center gap-4">
          <button
            type="button"
            class="text-sm text-gray-500 hover:text-gray-900 dark:hover:text-white"
            @click="resetDraft"
          >
            Reset to defaults</button
          ><button
            type="button"
            data-test="save-appearance"
            :disabled="saving || warnings.length > 0"
            class="rounded-lg bg-gray-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-gray-950"
            @click="save()"
          >
            {{ saving ? 'Saving…' : 'Save appearance' }}
          </button>
        </div>
      </div>
      <p
        v-if="error"
        role="alert"
        class="mb-5 text-sm text-red-600 dark:text-red-400"
      >
        {{ error }}
      </p>
      <p v-if="notice" role="status" class="mb-5 text-sm text-gray-500">
        {{ notice }}
      </p>
      <div
        class="grid items-start gap-10 xl:grid-cols-[340px_minmax(0,1fr)] xl:gap-14"
      >
        <form class="space-y-8" @submit.prevent="save()">
          <section class="space-y-5">
            <h2 class="text-sm font-semibold">Identity</h2>
            <div>
              <label
                for="appearance-name"
                class="mb-2 block text-sm text-gray-500"
                >Display name</label
              ><Input
                id="appearance-name"
                v-model="form.appearance.displayName"
                maxlength="80"
                class="w-full border-b border-gray-200 bg-transparent pb-2 text-base focus:outline-none dark:border-gray-700"
              />
            </div>
            <div class="grid grid-cols-2 gap-4">
              <div v-for="slot in ['logoLight', 'logoDark']" :key="slot">
                <label
                  :for="`appearance-${slot}`"
                  class="mb-2 block text-sm text-gray-500"
                  >{{
                    slot === 'logoLight' ? 'Light logo' : 'Dark logo · optional'
                  }}</label
                ><label
                  :for="`appearance-${slot}`"
                  :class="slot === 'logoDark' ? 'bg-gray-950' : 'bg-gray-50'"
                  class="appearance-logo-upload flex h-24 cursor-pointer items-center justify-center rounded-xl border border-dashed border-gray-300 p-4"
                  ><img
                    v-if="form.appearance[slot]"
                    :src="form.appearance[slot]"
                    alt="Selected logo"
                    class="max-h-full max-w-full object-contain"
                  /><span
                    v-else
                    class="text-xs"
                    :class="
                      slot === 'logoDark' ? 'text-gray-400' : 'text-gray-500'
                    "
                    >Upload logo</span
                  ></label
                ><input
                  :id="`appearance-${slot}`"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  class="sr-only"
                  @change="logo($event, slot)"
                /><button
                  v-if="form.appearance[slot]"
                  type="button"
                  class="mt-2 text-xs text-gray-500 underline"
                  @click="form.appearance[slot] = null"
                >
                  Remove
                </button>
              </div>
            </div>
            <p class="text-xs text-gray-500">
              PNG, JPEG or WebP · up to 256 KB. One logo works in both modes on
              a white backing.
            </p>
            <div>
              <label
                for="appearance-logo-text"
                class="mb-2 block text-sm text-gray-500"
                >Logo description</label
              ><Input
                id="appearance-logo-text"
                v-model="form.appearance.logoText"
                maxlength="120"
                placeholder="Optional, if the logo adds meaning"
                class="w-full border-b border-gray-200 bg-transparent pb-2 text-sm focus:outline-none dark:border-gray-700"
              />
            </div>
          </section>
          <section
            class="space-y-5 border-t border-gray-200 pt-6 dark:border-gray-800"
          >
            <div class="flex items-center justify-between">
              <h2 class="text-sm font-semibold">Colours</h2>
              <div class="flex gap-3">
                <button
                  v-for="choice in ['light', 'dark']"
                  :key="choice"
                  type="button"
                  :aria-pressed="palette === choice"
                  class="border-b-2 pb-1 text-sm capitalize"
                  :class="
                    palette === choice
                      ? 'border-current'
                      : 'border-transparent text-gray-500'
                  "
                  @click="selectPalette(choice)"
                >
                  {{ choice }}
                </button>
              </div>
            </div>
            <div class="grid grid-cols-2 gap-x-5 gap-y-4">
              <label
                v-for="token in contract.tokens"
                :key="token"
                class="flex min-w-0 items-center gap-2.5"
                ><input
                  v-model="form.appearance[palette][token]"
                  type="color"
                  :aria-label="`${palette} ${labels[token]}`"
                  class="h-8 w-8 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
                /><span class="text-xs"
                  >{{ labels[token]
                  }}<span
                    class="mt-0.5 block font-mono text-[10px] text-gray-500"
                    >{{ form.appearance[palette][token] }}</span
                  ></span
                ></label
              >
            </div>
            <p
              v-if="warnings.length"
              role="status"
              class="text-xs leading-5 text-amber-700 dark:text-amber-400"
            >
              {{ warnings.join(' ') }}
            </p>
            <p v-else class="text-xs text-gray-500">
              Text and focus contrast checks pass.
            </p>
          </section>
          <section
            class="space-y-5 border-t border-gray-200 pt-6 dark:border-gray-800"
          >
            <div>
              <label
                for="appearance-mode"
                class="mb-2 block text-sm font-semibold"
                >Colour mode</label
              ><BareSelect
                id="appearance-mode"
                v-model="form.appearance.mode"
                :options="[
                  { value: 'host', label: 'Follow app' },
                  { value: 'system', label: 'Follow system' },
                  { value: 'light', label: 'Always light' },
                  { value: 'dark', label: 'Always dark' }
                ]"
                class="w-full"
              />
            </div>
            <div v-if="form.appearance.mode === 'host'">
              <label
                for="appearance-fallback"
                class="mb-2 block text-sm text-gray-500"
                >When the app has no mode</label
              ><BareSelect
                id="appearance-fallback"
                v-model="form.appearance.fallbackMode"
                :options="[
                  { value: 'system', label: 'Follow system' },
                  { value: 'light', label: 'Light' },
                  { value: 'dark', label: 'Dark' }
                ]"
                class="w-full"
              />
            </div>
            <div class="grid grid-cols-2 gap-5">
              <div>
                <label
                  for="appearance-font"
                  class="mb-2 block text-sm text-gray-500"
                  >Typography</label
                ><BareSelect
                  id="appearance-font"
                  v-model="form.appearance.font"
                  :options="[
                    { value: 'system', label: 'System' },
                    { value: 'editorial', label: 'Editorial' },
                    { value: 'mono', label: 'Mono' }
                  ]"
                />
              </div>
              <div>
                <label
                  for="appearance-radius"
                  class="mb-2 block text-sm text-gray-500"
                  >Corners</label
                ><BareSelect
                  id="appearance-radius"
                  v-model="form.appearance.radius"
                  :options="[
                    { value: 'square', label: 'Square' },
                    { value: 'soft', label: 'Soft' },
                    { value: 'round', label: 'Round' }
                  ]"
                />
              </div>
            </div>
            <div>
              <label
                for="appearance-density"
                class="mb-2 block text-sm text-gray-500"
                >Density</label
              ><BareSelect
                id="appearance-density"
                v-model="form.appearance.density"
                :options="[
                  { value: 'comfortable', label: 'Comfortable' },
                  { value: 'compact', label: 'Compact' }
                ]"
              />
            </div>
          </section>
        </form>
        <section
          class="min-w-0 xl:sticky xl:top-6"
          aria-label="Live appearance preview"
        >
          <div class="mb-4 flex flex-wrap items-center justify-between gap-4">
            <div class="flex gap-4">
              <button
                type="button"
                :aria-pressed="widget"
                class="text-sm"
                :class="widget ? 'font-semibold' : 'text-gray-500'"
                @click="widget = true"
              >
                Widget</button
              ><button
                type="button"
                :aria-pressed="!widget"
                class="text-sm"
                :class="!widget ? 'font-semibold' : 'text-gray-500'"
                @click="widget = false"
              >
                Public page
              </button>
            </div>
            <div class="flex gap-4">
              <button
                v-for="choice in ['light', 'dark']"
                :key="choice"
                type="button"
                :aria-pressed="mode === choice"
                class="text-xs capitalize"
                :class="mode === choice ? 'font-semibold' : 'text-gray-500'"
                @click="mode = choice"
              >
                {{ choice }}</button
              ><button
                type="button"
                :aria-pressed="mobile"
                class="text-xs"
                @click="mobile = !mobile"
              >
                {{ mobile ? 'Desktop' : 'Mobile' }}
              </button>
            </div>
          </div>
          <div
            class="overflow-hidden rounded-2xl border border-gray-200 bg-gray-100 p-3 dark:border-gray-800 dark:bg-gray-900 sm:p-6"
          >
            <div v-if="!widget" class="mb-5 flex justify-center gap-5">
              <button
                v-for="choice in ['feedback', 'roadmap', 'updates']"
                :key="choice"
                type="button"
                :aria-pressed="surface === choice"
                class="text-xs capitalize"
                :class="surface === choice ? 'font-semibold' : 'text-gray-500'"
                @click="surface = choice"
              >
                {{ choice }}
              </button>
            </div>
            <div class="overflow-hidden rounded-xl">
              <AppearancePreview
                :appearance="form.appearance"
                :fallback-name="project.name"
                :mode="mode"
                v-model:surface="surface"
                :widget-styles="widgetStyles"
                :widget="widget"
                :mobile="mobile"
              />
            </div>
          </div>
          <p class="mt-3 text-center text-xs text-gray-500">
            Live draft · example content · changes apply after saving
          </p>
        </section>
      </div>
    </div>
  </div>
</template>
