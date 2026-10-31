<script setup>
import { computed, ref, watch, inject } from 'vue'
import { Head, useForm } from '@inertiajs/vue3'
import AppLayout from '@/layouts/AppLayout.vue'
import Input from '@/components/ui/input/Input.vue'
import Button from '@/components/ui/button/Button.vue'
import Breadcrumb from '@/components/ContextBreadcrumb.vue'
import AppNavbarVersion from '@/components/AppNavbarVersion.vue'
import SidebarOpen from '@/components/ui/icons/SidebarOpen.vue'
import SidebarClose from '@/components/ui/icons/SidebarClose.vue'
import { useToast } from '@/composables/toast'
import { inertiaMutation } from '@/lib/inertia-mutation'
import { mutationFailureMessage } from '@/lib/mutation-feedback'
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
const baseline = ref(draft(props.appearance))
const toast = useToast()
const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')
function snapshot(value) {
  return JSON.stringify({
    ...contract.normalize(value, props.project.name),
    logoLight: value.logoLight || null,
    logoDark: value.logoDark || null
  })
}
const isDirty = computed(
  () => snapshot(form.appearance) !== snapshot(baseline.value)
)
const defaults = () => ({
  ...contract.normalize({}, props.project.name),
  logoLight: null,
  logoDark: null
})
const isDefaultDraft = computed(
  () => snapshot(form.appearance) === snapshot(defaults())
)
function adopt(value) {
  baseline.value = draft(value)
  form.appearance = draft(value)
  form.defaults({ appearance: draft(value) })
}
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
    if (!saving.value && !isDirty.value) adopt(value)
  }
)
watch(isDirty, (value) => {
  if (!value) notice.value = ''
})
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
async function save() {
  if (!isDirty.value || saving.value || warnings.value.length) return
  error.value = ''
  notice.value = ''
  saving.value = true
  const value = JSON.parse(JSON.stringify(form.appearance))
  for (const slot of ['logoLight', 'logoDark'])
    if (value[slot] && value[slot] === baseline.value[slot])
      value[slot] = 'keep'
  try {
    const saved = await inertiaMutation('patch', `${base.value}/appearance`, {
      appearance: value
    })
    if (!saved.props?.appearance)
      throw new Error('Saved appearance could not be confirmed.')
    adopt(saved.props.appearance)
    // AppLayout displays the controller's success flash through the shared toast.
  } catch (failure) {
    error.value = mutationFailureMessage(failure)
    toast({ message: error.value, type: 'error' })
  } finally {
    saving.value = false
  }
}
function resetDraft() {
  if (saving.value) return
  form.appearance = defaults()
  error.value = ''
  notice.value = isDirty.value ? 'Previewing defaults. Save to apply them.' : ''
}
</script>
<template>
  <Head :title="`${app.name} appearance | Slipway`" />
  <div
    class="flex h-full min-h-0 flex-col overflow-y-auto text-gray-950 dark:text-white"
  >
    <header
      class="flex items-center justify-between gap-3 border-b border-gray-200 py-4 pl-4 pr-4 dark:border-gray-800 sm:pr-8"
    >
      <div class="flex min-w-0 items-center gap-3">
        <button
          type="button"
          aria-label="Open navigation"
          class="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white md:hidden"
          @click="toggleMobileMenu"
        >
          <SidebarOpen class="size-5" />
        </button>
        <button
          type="button"
          :aria-label="sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
          class="hidden text-gray-400 dark:text-gray-500 md:block"
          @click="toggleSidebar"
        >
          <SidebarOpen v-if="sidebarCollapsed" class="size-5" /><SidebarClose
            v-else
            class="size-5"
          />
        </button>
        <Breadcrumb
          :items="[
            { label: 'projects', href: '/' },
            {
              label: project.name.toLowerCase(),
              href: `/projects/${project.slug}`
            },
            {
              label: environment.name.toLowerCase(),
              href: `/projects/${project.slug}/environments/${environment.slug}`
            },
            { label: `${app.name} settings`, href: `${base}/settings` },
            { label: 'appearance' }
          ]"
        />
      </div>
      <div class="ml-auto shrink-0 pl-2"><AppNavbarVersion /></div>
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
            :disabled="saving || isDefaultDraft"
            @click="resetDraft"
          >
            Reset to defaults</button
          ><Button
            type="button"
            data-test="save-appearance"
            :disabled="!isDirty || saving || warnings.length > 0"
            class="rounded-lg bg-gray-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-gray-950"
            @click="save()"
          >
            {{ saving ? 'Saving…' : 'Save' }}
          </Button>
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
        <form @submit.prevent="save()">
          <fieldset :disabled="saving" class="space-y-8">
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
                      slot === 'logoLight'
                        ? 'Light logo'
                        : 'Dark logo · optional'
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
                PNG, JPEG or WebP · up to 256 KB. One logo works in both modes
                on a white backing.
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
          </fieldset>
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
