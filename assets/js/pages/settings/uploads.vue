<script setup>
import { Link, Head, useForm } from '@inertiajs/vue3'
import { inject, ref, computed } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'
import { useToast } from '@/composables/toast'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  isConfigured: Boolean,
  provider: String,
  config: Object,
  backupSchedule: Object
})

const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')
const toast = useToast()

const selectedProvider = ref(props.provider || 'r2')
const showSecrets = ref(false)

function getProviderDefaults() {
  if (selectedProvider.value === 'r2') {
    return {
      bucket: props.config.r2Bucket || '',
      endpoint: props.config.r2Endpoint || '',
      region: '',
      publicUrl: props.config.r2PublicUrl || ''
    }
  } else if (selectedProvider.value === 's3') {
    return {
      bucket: props.config.s3Bucket || '',
      endpoint: props.config.s3Endpoint || '',
      region: props.config.s3Region || 'us-east-1',
      publicUrl: props.config.s3PublicUrl || ''
    }
  } else {
    return {
      bucket: props.config.spacesBucket || '',
      endpoint: props.config.spacesEndpoint || '',
      region: props.config.spacesRegion || 'nyc3',
      publicUrl: props.config.spacesPublicUrl || ''
    }
  }
}

const storageForm = useForm({
  provider: selectedProvider.value,
  accessKey: '',
  secretKey: '',
  ...getProviderDefaults()
})

function onProviderChange() {
  const defaults = getProviderDefaults()
  storageForm.provider = selectedProvider.value
  storageForm.accessKey = ''
  storageForm.secretKey = ''
  storageForm.bucket = defaults.bucket
  storageForm.endpoint = defaults.endpoint
  storageForm.region = defaults.region
  storageForm.publicUrl = defaults.publicUrl
}

const isCurrentProvider = computed(() => selectedProvider.value === props.provider)

function save() {
  storageForm.patch('/settings/uploads', {
    preserveScroll: true,
    onSuccess: () => {
      storageForm.accessKey = ''
      storageForm.secretKey = ''
    },
    onError: () => toast({ message: 'Failed to save configuration', type: 'error' })
  })
}

// Backup schedule
const scheduleForm = useForm({
  backupSchedule: {
    enabled: props.backupSchedule?.enabled || false,
    intervalHours: props.backupSchedule?.intervalHours || 24,
    retentionCount: props.backupSchedule?.retentionCount || 10
  }
})

function saveSchedule() {
  scheduleForm.patch('/settings/uploads', {
    preserveScroll: true,
    onError: () => toast({ message: 'Failed to save schedule', type: 'error' })
  })
}

const providers = [
  { id: 'r2', name: 'Cloudflare R2', description: 'S3-compatible object storage from Cloudflare' },
  { id: 's3', name: 'Amazon S3', description: 'AWS Simple Storage Service' },
  { id: 'spaces', name: 'DigitalOcean Spaces', description: 'S3-compatible object storage from DigitalOcean' }
]
</script>
<template>
  <Head title="File Storage | Slipway"></Head>
  <div class="flex h-full flex-col">
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-gray-200 py-4 pl-4 pr-4 dark:border-gray-800 sm:pl-4 sm:pr-8">
      <div class="flex items-center space-x-3">
        <button
          @click="toggleMobileMenu"
          class="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white md:hidden"
        >
          <svg class="h-5 w-5" viewBox="-0.5 -0.5 16 16" fill="none" stroke="currentColor">
            <path d="M12.777 14.285H2.223c-.833 0-1.508-.675-1.508-1.508V2.223c0-.833.675-1.508 1.508-1.508h10.554c.833 0 1.508.675 1.508 1.508v10.554c0 .833-.675 1.508-1.508 1.508Z" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" />
            <path d="M5.615 14.285V.715" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" />
            <path d="M2.6 5.992 3.919 7.5 2.6 9.008" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" />
          </svg>
        </button>
        <!-- Desktop sidebar toggle -->
        <button
          @click="toggleSidebar"
          class="hidden text-gray-400 dark:text-gray-500 md:block"
        >
          <svg v-if="sidebarCollapsed" class="h-5 w-5" viewBox="-0.5 -0.5 16 16" fill="none" stroke="currentColor">
            <path d="M12.777 14.285H2.223c-.833 0-1.508-.675-1.508-1.508V2.223c0-.833.675-1.508 1.508-1.508h10.554c.833 0 1.508.675 1.508 1.508v10.554c0 .833-.675 1.508-1.508 1.508Z" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" />
            <path d="M5.615 14.285V.715" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" />
            <path d="M2.6 5.992 3.919 7.5 2.6 9.008" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" />
          </svg>
          <svg v-else class="h-5 w-5" viewBox="-0.5 -0.5 16 16" fill="none" stroke="currentColor">
            <path d="M12.777 14.285H2.223c-.833 0-1.508-.675-1.508-1.508V2.223c0-.833.675-1.508 1.508-1.508h10.554c.833 0 1.508.675 1.508 1.508v10.554c0 .833-.675 1.508-1.508 1.508Z" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" />
            <path d="M5.615 14.285V.715" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" />
            <path d="M3.919 5.992 2.6 7.5l1.319 1.508" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" />
          </svg>
        </button>
        <nav class="flex items-center space-x-2 text-sm">
          <Link href="/settings" class="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">
            settings
          </Link>
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <span class="font-medium text-gray-900 dark:text-white">file storage</span>
        </nav>
      </div>
      <div class="flex items-center space-x-4">
        <a
          href="https://docs.sailscasts.com/slipway"
          target="_blank"
          class="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
        >
          Docs
          <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
      <div class="mx-auto max-w-6xl">
        <!-- Description -->
        <div class="mb-6">
          <h1 class="text-xl font-semibold text-gray-900 dark:text-white">File Storage</h1>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Configure S3-compatible object storage for team logos and database backups.
          </p>
        </div>

        <!-- Status indicator -->
        <div class="mb-6">
          <div :class="[
            'flex items-center gap-2 rounded-lg border px-4 py-3',
            isConfigured
              ? 'border-green-200 bg-green-50/50 dark:border-green-900/50 dark:bg-green-950/20'
              : 'border-amber-200 bg-amber-50/50 dark:border-amber-900/50 dark:bg-amber-950/20'
          ]">
            <svg v-if="isConfigured" class="h-4 w-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
            </svg>
            <svg v-else class="h-4 w-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span :class="['text-sm', isConfigured ? 'text-green-700 dark:text-green-400' : 'text-amber-700 dark:text-amber-400']">
              <template v-if="isConfigured">
                File storage configured via {{ provider === 'r2' ? 'Cloudflare R2' : provider === 's3' ? 'Amazon S3' : provider === 'spaces' ? 'DigitalOcean Spaces' : 'environment variables' }}
              </template>
              <template v-else>
                File storage not configured. Configure below to enable team logos and database backups.
              </template>
            </span>
          </div>
        </div>

        <!-- Provider selection -->
        <div class="mb-6 rounded-lg border border-gray-200 dark:border-gray-800">
          <div class="px-4 py-3">
            <h2 class="text-sm font-medium text-gray-900 dark:text-white">Storage Provider</h2>
          </div>
          <div class="divide-y divide-gray-200 border-t border-gray-200 dark:divide-gray-800 dark:border-gray-800">
            <label
              v-for="p in providers"
              :key="p.id"
              :class="[
                'flex cursor-pointer items-center justify-between px-4 py-3 transition-colors hover:bg-gray-50 dark:hover:bg-gray-900/50',
                selectedProvider === p.id ? 'bg-gray-50/50 dark:bg-gray-900/30' : ''
              ]"
            >
              <div class="flex items-center space-x-3">
                <input
                  type="radio"
                  :value="p.id"
                  v-model="selectedProvider"
                  @change="onProviderChange"
                  class="h-4 w-4 border-gray-300 text-brand focus:ring-brand dark:border-gray-600"
                />
                <div>
                  <span class="text-sm font-medium text-gray-900 dark:text-white">{{ p.name }}</span>
                  <p class="text-xs text-gray-500 dark:text-gray-400">{{ p.description }}</p>
                </div>
              </div>
              <span
                v-if="provider === p.id"
                class="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400"
              >
                Active
              </span>
            </label>
          </div>
        </div>

        <!-- Configuration form -->
        <form @submit.prevent="save" class="space-y-6">
          <div class="rounded-lg border border-gray-200 dark:border-gray-800">
            <div class="px-4 py-3">
              <h2 class="text-sm font-medium text-gray-900 dark:text-white">
                {{ selectedProvider === 'r2' ? 'Cloudflare R2' : selectedProvider === 's3' ? 'Amazon S3' : 'DigitalOcean Spaces' }} Configuration
              </h2>
              <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                <template v-if="isCurrentProvider && isConfigured">
                  Currently configured. Enter new credentials to update.
                </template>
                <template v-else>
                  Enter your credentials to configure this provider.
                </template>
              </p>
            </div>

            <div class="space-y-4 border-t border-gray-200 px-4 py-4 dark:border-gray-800">
              <!-- Access Key -->
              <div>
                <label class="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
                  Access Key
                  <span v-if="isCurrentProvider && (selectedProvider === 'r2' ? props.config.r2AccessKey : selectedProvider === 's3' ? props.config.s3AccessKey : props.config.spacesAccessKey)" class="text-gray-400">
                    (current: {{ selectedProvider === 'r2' ? props.config.r2AccessKey : selectedProvider === 's3' ? props.config.s3AccessKey : props.config.spacesAccessKey }})
                  </span>
                </label>
                <input
                  v-model="storageForm.accessKey"
                  type="text"
                  required
                  placeholder="Enter access key"
                  class="w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 font-mono text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none sm:max-w-md dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
                />
              </div>

              <!-- Secret Key -->
              <div>
                <label class="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">Secret Key</label>
                <div class="flex items-center gap-2">
                  <input
                    v-model="storageForm.secretKey"
                    :type="showSecrets ? 'text' : 'password'"
                    required
                    placeholder="Enter secret key"
                    class="w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 font-mono text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none sm:max-w-md dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
                  />
                  <button
                    type="button"
                    @click="showSecrets = !showSecrets"
                    class="rounded p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  >
                    <svg v-if="showSecrets" class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L6.5 6.5m7.378 7.378L17.5 17.5M3 3l18 18" />
                    </svg>
                    <svg v-else class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  </button>
                </div>
              </div>

              <!-- Bucket -->
              <div>
                <label class="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">Bucket Name</label>
                <input
                  v-model="storageForm.bucket"
                  type="text"
                  required
                  placeholder="my-bucket"
                  class="w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 font-mono text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none sm:max-w-md dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
                />
              </div>

              <!-- Region (S3/Spaces only) -->
              <div v-if="selectedProvider === 's3' || selectedProvider === 'spaces'">
                <label class="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">Region</label>
                <input
                  v-model="storageForm.region"
                  type="text"
                  :placeholder="selectedProvider === 's3' ? 'us-east-1' : 'nyc3'"
                  class="w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 font-mono text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none sm:max-w-md dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
                />
              </div>

              <!-- Endpoint -->
              <div>
                <label class="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
                  Endpoint
                  <span v-if="selectedProvider === 's3'" class="text-gray-400">(optional, for custom endpoints)</span>
                </label>
                <input
                  v-model="storageForm.endpoint"
                  type="text"
                  :placeholder="selectedProvider === 'r2' ? 'https://accountid.r2.cloudflarestorage.com' : selectedProvider === 'spaces' ? 'https://nyc3.digitaloceanspaces.com' : 'https://s3.us-east-1.amazonaws.com'"
                  :required="selectedProvider === 'r2' || selectedProvider === 'spaces'"
                  class="w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 font-mono text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
                />
              </div>

              <!-- Public URL -->
              <div>
                <label class="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
                  Public URL
                  <span class="text-gray-400">(for serving files to browsers)</span>
                </label>
                <input
                  v-model="storageForm.publicUrl"
                  type="text"
                  :placeholder="selectedProvider === 'r2' ? 'https://pub-xxx.r2.dev' : selectedProvider === 'spaces' ? 'https://my-bucket.nyc3.cdn.digitaloceanspaces.com' : 'https://my-bucket.s3.us-east-1.amazonaws.com'"
                  class="w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 font-mono text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
                />
                <p class="mt-1 text-xs text-gray-400 dark:text-gray-500">
                  The public-facing URL for accessing uploaded files (e.g. R2 public bucket URL, CloudFront distribution, or custom domain)
                </p>
              </div>
            </div>
          </div>

          <!-- Save button -->
          <div class="flex justify-end">
            <button
              type="submit"
              :disabled="storageForm.processing || !storageForm.bucket || (!isCurrentProvider && (!storageForm.accessKey || !storageForm.secretKey))"
              class="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
            >
              {{ storageForm.processing ? 'Saving...' : 'Save configuration' }}
            </button>
          </div>
        </form>

        <!-- Scheduled Backups -->
        <div v-if="isConfigured" class="mt-8 rounded-lg border border-gray-200 dark:border-gray-800">
          <div class="px-4 py-3">
            <h2 class="text-sm font-medium text-gray-900 dark:text-white">Scheduled Backups</h2>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              Automatically back up all database services at a regular interval.
            </p>
          </div>
          <div class="space-y-4 border-t border-gray-200 px-4 py-4 dark:border-gray-800">
            <div class="flex items-center justify-between">
              <div>
                <span class="text-sm font-medium text-gray-700 dark:text-gray-300">Enable scheduled backups</span>
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  When enabled, all running database services will be backed up automatically.
                </p>
              </div>
              <button
                type="button"
                @click="scheduleForm.backupSchedule.enabled = !scheduleForm.backupSchedule.enabled"
                :class="[
                  'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none',
                  scheduleForm.backupSchedule.enabled ? 'bg-brand' : 'bg-gray-200 dark:bg-gray-700'
                ]"
              >
                <span
                  :class="[
                    'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
                    scheduleForm.backupSchedule.enabled ? 'translate-x-5' : 'translate-x-0'
                  ]"
                ></span>
              </button>
            </div>

            <div v-if="scheduleForm.backupSchedule.enabled" class="grid grid-cols-2 gap-4">
              <div>
                <label class="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">Backup Interval</label>
                <select
                  v-model="scheduleForm.backupSchedule.intervalHours"
                  class="w-full rounded-md border border-gray-200 bg-transparent px-3 py-1.5 text-sm text-gray-900 focus:border-brand focus:outline-none dark:border-gray-700 dark:text-white"
                >
                  <option :value="6">Every 6 hours</option>
                  <option :value="12">Every 12 hours</option>
                  <option :value="24">Every 24 hours</option>
                  <option :value="48">Every 48 hours</option>
                  <option :value="168">Weekly</option>
                </select>
              </div>
              <div>
                <label class="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">Retention</label>
                <select
                  v-model="scheduleForm.backupSchedule.retentionCount"
                  class="w-full rounded-md border border-gray-200 bg-transparent px-3 py-1.5 text-sm text-gray-900 focus:border-brand focus:outline-none dark:border-gray-700 dark:text-white"
                >
                  <option :value="5">Keep last 5</option>
                  <option :value="10">Keep last 10</option>
                  <option :value="20">Keep last 20</option>
                  <option :value="50">Keep last 50</option>
                </select>
              </div>
            </div>

            <div class="flex justify-end">
              <button
                @click="saveSchedule"
                :disabled="scheduleForm.processing"
                class="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
              >
                {{ scheduleForm.processing ? 'Saving...' : 'Save schedule' }}
              </button>
            </div>
          </div>
        </div>

        <!-- Info section -->
        <div class="mt-8 rounded-lg border border-gray-200 dark:border-gray-800">
          <div class="px-4 py-3">
            <h2 class="text-sm font-medium text-gray-900 dark:text-white">What is this used for?</h2>
          </div>
          <div class="divide-y divide-gray-200 border-t border-gray-200 text-sm dark:divide-gray-800 dark:border-gray-800">
            <div class="flex items-start gap-3 px-4 py-3">
              <svg class="mt-0.5 h-4 w-4 shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <div>
                <span class="font-medium text-gray-700 dark:text-gray-300">Team logos</span>
                <p class="text-gray-500 dark:text-gray-400">Upload and display your team's logo in the sidebar</p>
              </div>
            </div>
            <div class="flex items-start gap-3 px-4 py-3">
              <svg class="mt-0.5 h-4 w-4 shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
              </svg>
              <div>
                <span class="font-medium text-gray-700 dark:text-gray-300">Database backups</span>
                <p class="text-gray-500 dark:text-gray-400">Automatic PostgreSQL backups for your managed services</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
