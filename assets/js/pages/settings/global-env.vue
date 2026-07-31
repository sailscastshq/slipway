<script setup>
import { Link, Head, useForm } from '@inertiajs/vue3'
import { inject, ref, reactive, computed, watch, onMounted } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'
import Tooltip from '@/components/Tooltip.vue'
import CodeEditor from '@/components/CodeEditor.vue'
import ConfigVariableMenu from '@/components/ConfigVariableMenu.vue'
import { useToast } from '@/composables/toast'
import { usePrecognitionValidation } from '@/composables/precognition'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  globalEnvVars: Object,
  globalEnvVarMetadata: Object,
  backupConfigured: Boolean
})

const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')
const toast = useToast()

const localVars = reactive({ ...props.globalEnvVars })
const localMetadata = reactive({ ...props.globalEnvVarMetadata })
const newKey = ref('')
const newValue = ref('')
const saving = ref(false)
const bulkMode = ref(new URLSearchParams(window.location.search).has('bulk'))
const bulkText = ref('')
const revealedKeys = ref(new Set())

const sortedVarKeys = computed(() => Object.keys(localVars).sort())

function metadataFor(key) {
  const metadata = localMetadata[key] || {}
  const kind = metadata.kind === 'plain' ? 'plain' : 'secret'
  return {
    ...metadata,
    kind,
    managed: metadata.managed === true,
    previewPolicy:
      metadata.previewPolicy || (kind === 'plain' ? 'inherit' : 'omit')
  }
}

function isSensitive(key) {
  return metadataFor(key).kind === 'secret'
}

function metadataSummary(key) {
  const metadata = metadataFor(key)
  const type = metadata.managed
    ? 'Managed secret'
    : metadata.kind === 'secret'
    ? 'Secret'
    : 'Plain config'
  const preview = {
    omit: 'omitted from previews',
    inherit: 'inherited by previews',
    randomize: 'regenerated for previews'
  }[metadata.previewPolicy]
  return `${type} · ${preview}`
}

function changeSummary(key) {
  const metadata = metadataFor(key)
  return [
    metadata.changedByName,
    metadata.changedAt ? timeAgo(metadata.changedAt) : null
  ]
    .filter(Boolean)
    .join(' · ')
}

function timeAgo(timestamp) {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
  const intervals = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60]
  ]
  for (const [label, interval] of intervals) {
    const count = Math.floor(seconds / interval)
    if (count >= 1) return `${count} ${label}${count > 1 ? 's' : ''} ago`
  }
  return 'just now'
}

function toggleReveal(key) {
  if (revealedKeys.value.has(key)) {
    revealedKeys.value.delete(key)
  } else {
    revealedKeys.value.add(key)
  }
}

function shouldShowGenerate(key) {
  const upper = key.toUpperCase()
  return upper.includes('SECRET') || upper.includes('KEY')
}

function generateSecret() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  newValue.value = Array.from(bytes, (b) =>
    b.toString(16).padStart(2, '0')
  ).join('')
}

const envForm = useForm({
  envVars: { ...props.globalEnvVars },
  envVarMetadata: { ...props.globalEnvVarMetadata },
  envSource: ''
})
  .withPrecognition('patch', '/settings/global-env')
  .setValidationTimeout(350)

function replaceLocalVars(vars) {
  Object.keys(localVars).forEach((key) => delete localVars[key])
  Object.assign(localVars, vars)
}

function replaceLocalMetadata(metadata) {
  Object.keys(localMetadata).forEach((key) => delete localMetadata[key])
  Object.assign(localMetadata, metadata)
}

function submitVars(onSuccess) {
  saving.value = true
  envForm.patch('/settings/global-env', {
    preserveScroll: true,
    onSuccess,
    onError: () =>
      toast({ message: 'Failed to save environment variables', type: 'error' }),
    onFinish: () => {
      saving.value = false
    }
  })
}

function saveVars(
  vars,
  { metadata = localMetadata, envSource = '', onSuccess } = {}
) {
  envForm.envVars = { ...vars }
  envForm.envVarMetadata = { ...metadata }
  envForm.envSource = envSource
  envForm.validate('envVars', {
    onPrecognitionSuccess: () => submitVars(onSuccess)
  })
}

function addVar() {
  if (!newKey.value.trim()) return
  const key = newKey.value.trim()
  const nextVars = { ...localVars, [key]: newValue.value }
  const nextMetadata = {
    ...localMetadata,
    [key]: { kind: 'secret', previewPolicy: 'omit' }
  }
  saveVars(nextVars, {
    metadata: nextMetadata,
    onSuccess: () => {
      replaceLocalVars(nextVars)
      replaceLocalMetadata(nextMetadata)
      toast({ message: `Added "${key}"`, type: 'success' })
      newKey.value = ''
      newValue.value = ''
    }
  })
}

function removeVar(key) {
  const nextVars = { ...localVars }
  const nextMetadata = { ...localMetadata }
  delete nextVars[key]
  delete nextMetadata[key]
  saveVars(nextVars, {
    metadata: nextMetadata,
    onSuccess: () => {
      replaceLocalVars(nextVars)
      replaceLocalMetadata(nextMetadata)
      toast({ message: `Removed "${key}"`, type: 'success' })
    }
  })
}

function renameVar(oldKey, el) {
  const trimmed = el.value.trim()
  if (!trimmed || trimmed === oldKey) {
    el.value = oldKey
    return
  }
  if (trimmed in localVars) {
    toast({ message: `Variable "${trimmed}" already exists`, type: 'error' })
    el.value = oldKey
    return
  }
  const value = localVars[oldKey]
  const nextVars = { ...localVars }
  const nextMetadata = { ...localMetadata }
  delete nextVars[oldKey]
  const metadata = nextMetadata[oldKey]
  delete nextMetadata[oldKey]
  nextVars[trimmed] = value
  nextMetadata[trimmed] = metadata || metadataFor(oldKey)
  saveVars(nextVars, {
    metadata: nextMetadata,
    onSuccess: () => {
      replaceLocalVars(nextVars)
      replaceLocalMetadata(nextMetadata)
      toast({
        message: `Renamed "${oldKey}" to "${trimmed}"`,
        type: 'success'
      })
    }
  })
}

function updateVarMetadata(key, metadata) {
  const nextMetadata = { ...localMetadata, [key]: metadata }
  saveVars(localVars, {
    metadata: nextMetadata,
    onSuccess: () => {
      replaceLocalMetadata(nextMetadata)
      toast({ message: `Updated "${key}"`, type: 'success' })
    }
  })
}

function updateVarValue(key, value) {
  if (localVars[key] === value) return
  const nextVars = { ...localVars, [key]: value }
  saveVars(nextVars, {
    onSuccess: () => {
      replaceLocalVars(nextVars)
      toast({ message: `Updated "${key}"`, type: 'success' })
    }
  })
}

const bulkHasChanges = computed(() => {
  const vars = {}
  for (const line of (bulkText.value || '').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const k = trimmed.slice(0, eqIdx).trim()
    const v = trimmed.slice(eqIdx + 1).trim()
    if (k) vars[k] = v
  }
  const keys = Object.keys(vars).sort()
  const currentKeys = Object.keys(localVars).sort()
  if (keys.length !== currentKeys.length) return true
  return keys.some(
    (k, i) => k !== currentKeys[i] || vars[k] !== localVars[currentKeys[i]]
  )
})

function enterBulkMode() {
  bulkText.value = sortedVarKeys.value
    .map((k) => `${k}=${localVars[k]}`)
    .join('\n')
  bulkMode.value = true
}

function exitBulkMode() {
  bulkMode.value = false
}

function saveBulk() {
  const vars = {}
  for (const line of bulkText.value.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const value = trimmed.slice(eqIdx + 1).trim()
    if (key) vars[key] = value
  }
  const oldKeys = Object.keys(localVars).sort().join(',')
  const oldVals = Object.keys(localVars)
    .sort()
    .map((k) => localVars[k])
    .join(',')
  const newKeys = Object.keys(vars).sort().join(',')
  const newVals = Object.keys(vars)
    .sort()
    .map((k) => vars[k])
    .join(',')
  if (oldKeys !== newKeys || oldVals !== newVals) {
    const nextMetadata = Object.fromEntries(
      Object.keys(vars).map((key) => [
        key,
        localMetadata[key] || { kind: 'secret', previewPolicy: 'omit' }
      ])
    )
    saveVars(vars, {
      metadata: nextMetadata,
      envSource: bulkText.value,
      onSuccess: () => {
        replaceLocalVars(vars)
        replaceLocalMetadata(nextMetadata)
        bulkMode.value = false
        toast({ message: 'Environment variables updated', type: 'success' })
      }
    })
    return
  }
  bulkMode.value = false
}

watch(bulkMode, (open) => {
  const url = new URL(window.location)
  if (open) {
    url.searchParams.set('bulk', '1')
  } else {
    url.searchParams.delete('bulk')
  }
  window.history.replaceState({}, '', url)
})

onMounted(() => {
  if (bulkMode.value) {
    bulkText.value = sortedVarKeys.value
      .map((k) => `${k}=${localVars[k]}`)
      .join('\n')
  }
})
</script>
<template>
  <Head title="Global Environment | Slipway"></Head>
  <div class="flex h-full flex-col">
    <!-- Header -->
    <div
      class="flex items-center justify-between border-b border-gray-200 py-4 pl-4 pr-4 dark:border-gray-800 sm:pl-4 sm:pr-8"
    >
      <div class="flex items-center space-x-3">
        <button
          @click="toggleMobileMenu"
          class="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white md:hidden"
        >
          <svg
            class="h-5 w-5"
            viewBox="-0.5 -0.5 16 16"
            fill="none"
            stroke="currentColor"
          >
            <path
              d="M12.777 14.285H2.223c-.833 0-1.508-.675-1.508-1.508V2.223c0-.833.675-1.508 1.508-1.508h10.554c.833 0 1.508.675 1.508 1.508v10.554c0 .833-.675 1.508-1.508 1.508Z"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1"
            />
            <path
              d="M5.615 14.285V.715"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1"
            />
            <path
              d="M2.6 5.992 3.919 7.5 2.6 9.008"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1"
            />
          </svg>
        </button>
        <!-- Desktop sidebar toggle -->
        <button
          @click="toggleSidebar"
          class="hidden text-gray-400 dark:text-gray-500 md:block"
        >
          <svg
            v-if="sidebarCollapsed"
            class="h-5 w-5"
            viewBox="-0.5 -0.5 16 16"
            fill="none"
            stroke="currentColor"
          >
            <path
              d="M12.777 14.285H2.223c-.833 0-1.508-.675-1.508-1.508V2.223c0-.833.675-1.508 1.508-1.508h10.554c.833 0 1.508.675 1.508 1.508v10.554c0 .833-.675 1.508-1.508 1.508Z"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1"
            />
            <path
              d="M5.615 14.285V.715"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1"
            />
            <path
              d="M2.6 5.992 3.919 7.5 2.6 9.008"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1"
            />
          </svg>
          <svg
            v-else
            class="h-5 w-5"
            viewBox="-0.5 -0.5 16 16"
            fill="none"
            stroke="currentColor"
          >
            <path
              d="M12.777 14.285H2.223c-.833 0-1.508-.675-1.508-1.508V2.223c0-.833.675-1.508 1.508-1.508h10.554c.833 0 1.508.675 1.508 1.508v10.554c0 .833-.675 1.508-1.508 1.508Z"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1"
            />
            <path
              d="M5.615 14.285V.715"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1"
            />
            <path
              d="M3.919 5.992 2.6 7.5l1.319 1.508"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1"
            />
          </svg>
        </button>
        <nav class="flex items-center space-x-2 text-sm">
          <Link
            href="/settings"
            class="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >
            settings
          </Link>
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <span class="font-medium text-gray-900 dark:text-white"
            >global environment</span
          >
        </nav>
      </div>
      <div class="flex items-center space-x-4">
        <a
          href="https://docs.sailscasts.com/slipway"
          target="_blank"
          class="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
        >
          Docs
          <svg
            class="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
            />
          </svg>
        </a>
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
      <div class="mx-auto max-w-6xl">
        <!-- Description -->
        <div class="mb-6">
          <h1 class="text-xl font-semibold text-gray-900 dark:text-white">
            Global Environment Variables
          </h1>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Instance-wide variables automatically injected into all deployed
            applications. Per-environment variables override these.
          </p>
        </div>

        <!-- Backup storage status -->
        <div class="mb-6">
          <div
            :class="[
              'flex items-center gap-2 rounded-lg border px-4 py-3',
              backupConfigured
                ? 'border-green-200 bg-green-50/50 dark:border-green-900/50 dark:bg-green-950/20'
                : 'border-gray-200 bg-gray-50/50 dark:border-gray-800 dark:bg-gray-900/50'
            ]"
          >
            <svg
              v-if="backupConfigured"
              class="h-4 w-4 text-green-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M5 13l4 4L19 7"
              />
            </svg>
            <svg
              v-else
              class="h-4 w-4 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span
              :class="[
                'text-sm',
                backupConfigured
                  ? 'text-green-700 dark:text-green-400'
                  : 'text-gray-500 dark:text-gray-400'
              ]"
            >
              {{
                backupConfigured
                  ? 'Backup storage configured'
                  : 'Set R2_ACCESS_KEY, R2_SECRET_KEY, R2_BUCKET, and R2_ENDPOINT to enable database backups'
              }}
            </span>
          </div>
        </div>

        <!-- Variables -->
        <div
          data-test="global-config"
          class="rounded-lg border border-gray-200 dark:border-gray-800"
        >
          <!-- Header with bulk toggle -->
          <div class="px-4 py-3">
            <div class="flex items-center justify-between">
              <h2 class="text-sm font-medium text-gray-900 dark:text-white">
                Variables
              </h2>
              <div class="flex items-center gap-2">
                <span
                  class="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                >
                  {{ sortedVarKeys.length }}
                </span>
                <Tooltip :text="bulkMode ? 'Single edit' : 'Bulk edit'">
                  <button
                    @click="bulkMode ? exitBulkMode() : enterBulkMode()"
                    class="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                  >
                    <svg
                      v-if="bulkMode"
                      class="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M4 6h16M4 12h16M4 18h16"
                      />
                    </svg>
                    <svg
                      v-else
                      class="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
                      />
                    </svg>
                  </button>
                </Tooltip>
              </div>
            </div>
            <p
              v-if="envForm.errors.envVars || envForm.errors.envVarMetadata"
              class="mt-1 text-sm text-red-600 dark:text-red-400"
            >
              {{ envForm.errors.envVars || envForm.errors.envVarMetadata }}
            </p>
          </div>

          <!-- Bulk edit mode -->
          <template v-if="bulkMode">
            <div class="border-t border-gray-200 dark:border-gray-800">
              <CodeEditor
                v-model="bulkText"
                language="env"
                aria-label="Global environment variables"
                test-id="global-env-editor"
                class="bg-gray-50 dark:bg-gray-900"
                placeholder="KEY=value&#10;R2_ACCESS_KEY=abc123&#10;# Comments are ignored"
                padding="compact"
              />
              <div
                class="flex items-center justify-between border-t border-gray-200 px-4 py-3 dark:border-gray-800"
              >
                <p class="text-xs text-gray-400 dark:text-gray-500">
                  One KEY=value per line. Lines starting with # are ignored.
                </p>
                <button
                  @click="saveBulk"
                  :disabled="saving || !bulkHasChanges"
                  class="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
                >
                  Save
                </button>
              </div>
            </div>
          </template>

          <!-- Single mode -->
          <template v-else>
            <div
              v-if="sortedVarKeys.length > 0"
              class="divide-y divide-gray-200 border-t border-gray-200 dark:divide-gray-800 dark:border-gray-800"
            >
              <div v-for="key in sortedVarKeys" :key="key" class="px-4 py-3">
                <div class="flex items-center justify-between">
                  <input
                    :value="key"
                    :readonly="metadataFor(key).managed"
                    @blur="renameVar(key, $event.target)"
                    @keydown.enter="$event.target.blur()"
                    autocomplete="off"
                    spellcheck="false"
                    class="min-w-0 flex-1 border-b border-dashed border-transparent bg-transparent font-mono text-sm font-medium text-gray-900 focus:border-gray-300 focus:outline-none dark:text-white dark:focus:border-gray-600"
                  />
                  <div class="flex items-center space-x-1">
                    <button
                      v-if="isSensitive(key)"
                      @click="toggleReveal(key)"
                      class="rounded p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    >
                      <svg
                        v-if="revealedKeys.has(key)"
                        class="h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L6.5 6.5m7.378 7.378L17.5 17.5M3 3l18 18"
                        />
                      </svg>
                      <svg
                        v-else
                        class="h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                        />
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                        />
                      </svg>
                    </button>
                    <ConfigVariableMenu
                      :variable-key="key"
                      :metadata="metadataFor(key)"
                      @update="updateVarMetadata(key, $event)"
                      @remove="removeVar(key)"
                    />
                  </div>
                </div>
                <input
                  :value="localVars[key]"
                  :readonly="metadataFor(key).managed"
                  :type="
                    isSensitive(key) && !revealedKeys.has(key)
                      ? 'password'
                      : 'text'
                  "
                  @blur="updateVarValue(key, $event.target.value)"
                  @keydown.enter="$event.target.blur()"
                  autocomplete="off"
                  spellcheck="false"
                  class="mt-1 w-full border-b border-dashed border-transparent bg-transparent font-mono text-sm text-gray-500 focus:border-gray-300 focus:outline-none dark:text-gray-400 dark:focus:border-gray-600"
                />
                <p class="mt-1 text-xs text-gray-400 dark:text-gray-500">
                  {{ metadataSummary(key) }}
                  <template v-if="changeSummary(key)">
                    · {{ changeSummary(key) }}
                  </template>
                </p>
              </div>
            </div>

            <div
              v-else
              class="border-t border-gray-200 px-4 py-6 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400"
            >
              No global environment variables set.
            </div>

            <!-- Add new var -->
            <div
              class="border-t border-gray-200 px-4 py-3 dark:border-gray-800"
            >
              <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  v-model="newKey"
                  type="text"
                  placeholder="KEY"
                  class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 font-mono text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500 sm:flex-1"
                  @keydown.enter="addVar"
                />
                <input
                  v-model="newValue"
                  type="text"
                  placeholder="value"
                  class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 font-mono text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500 sm:flex-1"
                  @keydown.enter="addVar"
                />
                <button
                  v-if="shouldShowGenerate(newKey)"
                  @click="generateSecret"
                  type="button"
                  class="w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800 sm:w-auto"
                >
                  Generate
                </button>
                <button
                  @click="addVar"
                  :disabled="!newKey.trim() || saving"
                  class="w-full rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100 sm:w-auto"
                >
                  Add
                </button>
              </div>
            </div>
          </template>
        </div>

        <!-- Common variables reference -->
        <div
          class="mt-8 rounded-lg border border-gray-200 dark:border-gray-800"
        >
          <div class="px-4 py-3">
            <h2 class="text-sm font-medium text-gray-900 dark:text-white">
              Common variables
            </h2>
          </div>
          <div
            class="divide-y divide-gray-200 border-t border-gray-200 dark:divide-gray-800 dark:border-gray-800"
          >
            <div class="px-4 py-3">
              <p class="text-sm font-medium text-gray-700 dark:text-gray-300">
                Cloudflare R2 / S3-Compatible Storage
              </p>
              <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                Used for file uploads and database backups
              </p>
              <div
                class="mt-2 rounded bg-gray-50 px-3 py-2 font-mono text-xs text-gray-600 dark:bg-gray-900 dark:text-gray-400"
              >
                R2_ACCESS_KEY, R2_SECRET_KEY, R2_BUCKET, R2_ENDPOINT
              </div>
            </div>
            <div class="px-4 py-3">
              <p class="text-sm font-medium text-gray-700 dark:text-gray-300">
                Email
              </p>
              <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                For transactional email via Sails Mail SMTP transport
              </p>
              <div
                class="mt-2 rounded bg-gray-50 px-3 py-2 font-mono text-xs text-gray-600 dark:bg-gray-900 dark:text-gray-400"
              >
                MAIL_HOST, MAIL_PORT, MAIL_USERNAME, MAIL_PASSWORD
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
