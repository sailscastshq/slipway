<script setup>
import { Link, Head, useForm } from '@inertiajs/vue3'
import { inject, ref } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  telegram: Object,
  smtp: Object,
  notificationEmails: String,
  preferences: Object
})

const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')

const form = useForm({
  telegramBotToken: props.telegram.botToken,
  telegramChatId: props.telegram.chatId,
  telegramEnabled: props.telegram.enabled,
  smtpHost: props.smtp.host,
  smtpPort: props.smtp.port,
  smtpUser: props.smtp.user,
  smtpPassword: '',
  smtpFrom: props.smtp.from,
  smtpEnabled: props.smtp.enabled,
  notificationEmails: props.notificationEmails,
  notifyOnDeploySuccess: props.preferences.deploySuccess,
  notifyOnDeployFailure: props.preferences.deployFailure
})

const testing = ref(null)
const testResult = ref(null)

function save() {
  form.patch('/settings/notifications')
}

async function testChannel(channel) {
  testing.value = channel
  testResult.value = null

  try {
    const response = await fetch('/settings/notifications/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel })
    })
    const data = await response.json()
    testResult.value = { channel, success: data.success, message: data.message }
  } catch (err) {
    testResult.value = { channel, success: false, message: err.message }
  } finally {
    testing.value = null
  }
}

const revealToken = ref(false)
</script>
<template>
  <Head title="Notifications | Slipway"></Head>
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
          <span class="font-medium text-gray-900 dark:text-white">notifications</span>
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
          <h1 class="text-xl font-semibold text-gray-900 dark:text-white">Notifications</h1>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Configure how you receive deployment alerts and other notifications.
          </p>
        </div>

        <form @submit.prevent="save" class="space-y-6">
          <!-- Notification Preferences -->
          <div class="rounded-lg border border-gray-200 dark:border-gray-800">
            <div class="px-4 py-3">
              <h2 class="text-sm font-medium text-gray-900 dark:text-white">Notification Events</h2>
              <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                Choose which events trigger notifications
              </p>
            </div>
            <div class="divide-y divide-gray-200 border-t border-gray-200 dark:divide-gray-800 dark:border-gray-800">
              <label class="flex items-center justify-between px-4 py-3">
                <div>
                  <span class="text-sm text-gray-900 dark:text-white">Successful deployments</span>
                  <p class="text-xs text-gray-500 dark:text-gray-400">Notify when a deployment completes successfully</p>
                </div>
                <input
                  type="checkbox"
                  v-model="form.notifyOnDeploySuccess"
                  class="h-4 w-4 rounded border-gray-300 text-brand focus:ring-brand dark:border-gray-600 dark:bg-gray-900"
                />
              </label>
              <label class="flex items-center justify-between px-4 py-3">
                <div>
                  <span class="text-sm text-gray-900 dark:text-white">Failed deployments</span>
                  <p class="text-xs text-gray-500 dark:text-gray-400">Notify when a deployment fails</p>
                </div>
                <input
                  type="checkbox"
                  v-model="form.notifyOnDeployFailure"
                  class="h-4 w-4 rounded border-gray-300 text-brand focus:ring-brand dark:border-gray-600 dark:bg-gray-900"
                />
              </label>
            </div>
          </div>

          <!-- Telegram Section -->
          <div class="rounded-lg border border-gray-200 dark:border-gray-800">
            <div class="flex items-center justify-between px-4 py-3">
              <div class="flex items-center gap-3">
                <svg class="h-5 w-5 text-[#0088cc]" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
                </svg>
                <div>
                  <h2 class="text-sm font-medium text-gray-900 dark:text-white">Telegram</h2>
                  <p class="text-xs text-gray-500 dark:text-gray-400">Receive instant notifications via Telegram bot</p>
                </div>
              </div>
              <label class="relative inline-flex cursor-pointer items-center">
                <input type="checkbox" v-model="form.telegramEnabled" class="peer sr-only" />
                <div class="peer h-5 w-9 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-brand peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none dark:border-gray-600 dark:bg-gray-700"></div>
              </label>
            </div>
            <div v-if="form.telegramEnabled" class="divide-y divide-gray-200 border-t border-gray-200 dark:divide-gray-800 dark:border-gray-800">
              <div class="px-4 py-3">
                <label class="mb-1 block text-sm text-gray-700 dark:text-gray-300">Bot Token</label>
                <div class="flex items-center gap-2">
                  <input
                    :type="revealToken ? 'text' : 'password'"
                    v-model="form.telegramBotToken"
                    placeholder="123456789:ABCDefGhIJKlmNoPQRsTUVwxyZ"
                    class="w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 font-mono text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
                  />
                  <button
                    type="button"
                    @click="revealToken = !revealToken"
                    class="rounded p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  >
                    <svg v-if="revealToken" class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L6.5 6.5m7.378 7.378L17.5 17.5M3 3l18 18" />
                    </svg>
                    <svg v-else class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  </button>
                </div>
                <p class="mt-1 text-xs text-gray-400 dark:text-gray-500">
                  Create a bot via <a href="https://t.me/BotFather" target="_blank" class="text-brand hover:underline">@BotFather</a>
                </p>
              </div>
              <div class="px-4 py-3">
                <label class="mb-1 block text-sm text-gray-700 dark:text-gray-300">Chat ID</label>
                <input
                  type="text"
                  v-model="form.telegramChatId"
                  placeholder="-1001234567890"
                  class="w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 font-mono text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none sm:max-w-xs dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
                />
                <p class="mt-1 text-xs text-gray-400 dark:text-gray-500">
                  The chat, group, or channel ID to send messages to
                </p>
              </div>
              <div class="px-4 py-3">
                <button
                  type="button"
                  @click="testChannel('telegram')"
                  :disabled="testing === 'telegram' || !form.telegramBotToken || !form.telegramChatId"
                  class="rounded-md border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  {{ testing === 'telegram' ? 'Sending...' : 'Send test message' }}
                </button>
                <p v-if="testResult?.channel === 'telegram'" :class="['mt-2 text-sm', testResult.success ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400']">
                  {{ testResult.message }}
                </p>
              </div>
            </div>
          </div>

          <!-- Email Section -->
          <div class="rounded-lg border border-gray-200 dark:border-gray-800">
            <div class="flex items-center justify-between px-4 py-3">
              <div class="flex items-center gap-3">
                <svg class="h-5 w-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <div>
                  <h2 class="text-sm font-medium text-gray-900 dark:text-white">Email (SMTP)</h2>
                  <p class="text-xs text-gray-500 dark:text-gray-400">Receive notifications via email</p>
                </div>
              </div>
              <label class="relative inline-flex cursor-pointer items-center">
                <input type="checkbox" v-model="form.smtpEnabled" class="peer sr-only" />
                <div class="peer h-5 w-9 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-brand peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none dark:border-gray-600 dark:bg-gray-700"></div>
              </label>
            </div>
            <div v-if="form.smtpEnabled" class="divide-y divide-gray-200 border-t border-gray-200 dark:divide-gray-800 dark:border-gray-800">
              <div class="grid gap-4 px-4 py-3 sm:grid-cols-2">
                <div>
                  <label class="mb-1 block text-sm text-gray-700 dark:text-gray-300">SMTP Host</label>
                  <input
                    type="text"
                    v-model="form.smtpHost"
                    placeholder="smtp.example.com"
                    class="w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
                  />
                </div>
                <div>
                  <label class="mb-1 block text-sm text-gray-700 dark:text-gray-300">Port</label>
                  <input
                    type="text"
                    v-model="form.smtpPort"
                    placeholder="587"
                    class="w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
                  />
                </div>
              </div>
              <div class="grid gap-4 px-4 py-3 sm:grid-cols-2">
                <div>
                  <label class="mb-1 block text-sm text-gray-700 dark:text-gray-300">Username</label>
                  <input
                    type="text"
                    v-model="form.smtpUser"
                    placeholder="user@example.com"
                    class="w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
                  />
                </div>
                <div>
                  <label class="mb-1 block text-sm text-gray-700 dark:text-gray-300">Password</label>
                  <input
                    type="password"
                    v-model="form.smtpPassword"
                    placeholder="••••••••"
                    class="w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
                  />
                  <p class="mt-1 text-xs text-gray-400 dark:text-gray-500">Leave blank to keep existing</p>
                </div>
              </div>
              <div class="px-4 py-3">
                <label class="mb-1 block text-sm text-gray-700 dark:text-gray-300">From Address</label>
                <input
                  type="email"
                  v-model="form.smtpFrom"
                  placeholder="noreply@example.com"
                  class="w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none sm:max-w-xs dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
                />
              </div>
              <div class="px-4 py-3">
                <label class="mb-1 block text-sm text-gray-700 dark:text-gray-300">Notification Recipients</label>
                <input
                  type="text"
                  v-model="form.notificationEmails"
                  placeholder="admin@example.com, team@example.com"
                  class="w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
                />
                <p class="mt-1 text-xs text-gray-400 dark:text-gray-500">Comma-separated list of email addresses</p>
              </div>
              <div class="px-4 py-3">
                <button
                  type="button"
                  @click="testChannel('email')"
                  :disabled="testing === 'email' || !form.smtpHost || !form.notificationEmails"
                  class="rounded-md border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  {{ testing === 'email' ? 'Sending...' : 'Send test email' }}
                </button>
                <p v-if="testResult?.channel === 'email'" :class="['mt-2 text-sm', testResult.success ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400']">
                  {{ testResult.message }}
                </p>
              </div>
            </div>
          </div>

          <!-- Save button -->
          <div class="flex justify-end">
            <button
              type="submit"
              :disabled="form.processing"
              class="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
            >
              {{ form.processing ? 'Saving...' : 'Save changes' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
