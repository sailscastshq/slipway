<script setup>
import { Link, Head, useForm } from '@inertiajs/vue3'
import { inject, ref, computed } from 'vue'
import { useToast } from '@/composables/toast'
import AppLayout from '@/layouts/AppLayout.vue'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  telegram: Object,
  discord: Object,
  slack: Object,
  webhook: Object,
  smtp: Object,
  notificationEmails: String,
  preferences: Object
})

const toast = useToast()
const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')

const search = ref('')

const form = useForm({
  telegramBotToken: props.telegram.botToken || '',
  telegramChatId: props.telegram.chatId || '',
  telegramThreadId: props.telegram.threadId || '',
  telegramEnabled: props.telegram.enabled || false,
  discordWebhookUrl: props.discord?.webhookUrl || '',
  discordEnabled: props.discord?.enabled || false,
  slackWebhookUrl: props.slack?.webhookUrl || '',
  slackEnabled: props.slack?.enabled || false,
  webhookUrl: props.webhook?.url || '',
  webhookEnabled: props.webhook?.enabled || false,
  smtpHost: props.smtp.host || '',
  smtpPort: props.smtp.port || '',
  smtpUser: props.smtp.user || '',
  smtpPassword: '',
  smtpFrom: props.smtp.from || '',
  smtpEnabled: props.smtp.enabled || false,
  notificationEmails: props.notificationEmails || '',
  // Deployment
  notifyOnDeploySuccess: props.preferences.deploySuccess,
  notifyOnDeployFailure: props.preferences.deployFailure,
  // Backup
  notifyOnBackupSuccess: props.preferences.backupSuccess,
  notifyOnBackupFailure: props.preferences.backupFailure,
  // Lookout
  notifyOnContainerRestart: props.preferences.containerRestart,
  notifyOnHighResourceUsage: props.preferences.highResourceUsage,
  // Quest
  notifyOnJobFailure: props.preferences.jobFailure
})

const testing = ref(null)
const testResult = ref(null)

function save() {
  form.patch('/settings/notifications', { preserveScroll: true })
}

async function testChannel(channel) {
  testing.value = channel
  testResult.value = null

  try {
    // Send form values so test works even before saving
    const payload = { channel }
    if (channel === 'telegram') {
      payload.telegramBotToken = form.telegramBotToken
      payload.telegramChatId = form.telegramChatId
      payload.telegramThreadId = form.telegramThreadId
    } else if (channel === 'discord') {
      payload.discordWebhookUrl = form.discordWebhookUrl
    } else if (channel === 'slack') {
      payload.slackWebhookUrl = form.slackWebhookUrl
    } else if (channel === 'webhook') {
      payload.webhookUrl = form.webhookUrl
    } else if (channel === 'email') {
      payload.smtpHost = form.smtpHost
      payload.smtpPort = form.smtpPort
      payload.smtpUser = form.smtpUser
      payload.smtpPassword = form.smtpPassword
      payload.smtpFrom = form.smtpFrom
      payload.notificationEmails = form.notificationEmails
    }

    const response = await fetch('/settings/notifications/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    const data = await response.json()
    if (data.success) {
      toast({ message: data.message, type: 'success' })
      testResult.value = null
    } else {
      testResult.value = { channel, success: false, message: data.message }
    }
  } catch (err) {
    testResult.value = { channel, success: false, message: err.message }
  } finally {
    testing.value = null
  }
}

const revealToken = ref(false)

// Define all notification events for filtering
const allEvents = [
  {
    id: 'deploySuccess',
    label: 'Successful deployments',
    description: 'Notify when a deployment completes successfully',
    category: 'Deployments',
    model: 'notifyOnDeploySuccess'
  },
  {
    id: 'deployFailure',
    label: 'Failed deployments',
    description: 'Notify when a deployment fails',
    category: 'Deployments',
    model: 'notifyOnDeployFailure'
  },
  {
    id: 'backupSuccess',
    label: 'Successful backups',
    description: 'Notify when a backup completes successfully',
    category: 'Backups',
    model: 'notifyOnBackupSuccess'
  },
  {
    id: 'backupFailure',
    label: 'Failed backups',
    description: 'Notify when a backup fails',
    category: 'Backups',
    model: 'notifyOnBackupFailure'
  },
  {
    id: 'containerRestart',
    label: 'Container restarts',
    description: 'Notify when a container unexpectedly restarts',
    category: 'Lookout',
    model: 'notifyOnContainerRestart'
  },
  {
    id: 'highResourceUsage',
    label: 'High resource usage',
    description: 'Notify when CPU or memory usage exceeds thresholds',
    category: 'Lookout',
    model: 'notifyOnHighResourceUsage'
  },
  {
    id: 'jobFailure',
    label: 'Failed jobs',
    description: 'Notify when a Quest background job fails',
    category: 'Quest',
    model: 'notifyOnJobFailure'
  }
]

// Define all channels for filtering
const allChannels = [
  {
    id: 'discord',
    label: 'Discord',
    description: 'Receive notifications via Discord webhook'
  },
  {
    id: 'slack',
    label: 'Slack',
    description: 'Receive notifications via Slack webhook'
  },
  {
    id: 'telegram',
    label: 'Telegram',
    description: 'Receive instant notifications via Telegram bot'
  },
  {
    id: 'email',
    label: 'Email',
    description: 'Receive notifications via email'
  },
  {
    id: 'webhook',
    label: 'Webhook',
    description: 'Send structured JSON to any URL'
  }
]

const filteredEvents = computed(() => {
  const q = search.value.toLowerCase().trim()
  if (!q) return allEvents
  return allEvents.filter(
    (e) =>
      e.label.toLowerCase().includes(q) ||
      e.description.toLowerCase().includes(q) ||
      e.category.toLowerCase().includes(q)
  )
})

const filteredChannels = computed(() => {
  const q = search.value.toLowerCase().trim()
  if (!q) return allChannels
  return allChannels.filter(
    (c) =>
      c.label.toLowerCase().includes(q) ||
      c.description.toLowerCase().includes(q)
  )
})

const groupedEvents = computed(() => {
  const groups = {}
  for (const event of filteredEvents.value) {
    if (!groups[event.category]) groups[event.category] = []
    groups[event.category].push(event)
  }
  return groups
})

const categoryIcons = {
  Deployments: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />`,
  Backups: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />`,
  Lookout: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />`,
  Quest: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />`
}
</script>
<template>
  <Head title="Notifications | Slipway"></Head>
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
            >notifications</span
          >
        </nav>
      </div>
      <div class="flex items-center space-x-4">
        <a
          href="https://docs.sailscasts.com/slipway/notifications"
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
      <div class="mx-auto max-w-4xl">
        <!-- Description -->
        <div class="mb-6">
          <h1 class="text-xl font-semibold text-gray-900 dark:text-white">
            Notifications
          </h1>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Configure how you receive deployment alerts and other notifications.
          </p>
        </div>

        <!-- Search -->
        <div class="mb-6">
          <input
            v-model="search"
            type="text"
            placeholder="Search notifications..."
            class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500 sm:max-w-xs"
          />
        </div>

        <form @submit.prevent="save" class="space-y-8">
          <!-- Notification Events -->
          <div v-if="Object.keys(groupedEvents).length > 0">
            <h2 class="mb-4 text-sm font-medium text-gray-900 dark:text-white">
              Notification Events
            </h2>
            <div class="space-y-4">
              <div
                v-for="(events, category) in groupedEvents"
                :key="category"
                class="rounded-lg border border-gray-200 dark:border-gray-800"
              >
                <div
                  class="border-b border-gray-200 bg-gray-50/50 px-4 py-2 dark:border-gray-800 dark:bg-gray-900/50"
                >
                  <div class="flex items-center gap-2">
                    <svg
                      class="h-4 w-4 text-gray-500"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      v-html="categoryIcons[category]"
                    ></svg>
                    <span
                      class="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400"
                      >{{ category }}</span
                    >
                  </div>
                </div>
                <div class="divide-y divide-gray-200 dark:divide-gray-800">
                  <label
                    v-for="event in events"
                    :key="event.id"
                    class="flex cursor-pointer items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-900/30"
                  >
                    <div>
                      <span class="text-sm text-gray-900 dark:text-white">{{
                        event.label
                      }}</span>
                      <p class="text-xs text-gray-500 dark:text-gray-400">
                        {{ event.description }}
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      v-model="form[event.model]"
                      class="accent-brand text-brand focus:ring-brand h-4 w-4 rounded border-gray-300 dark:border-gray-600 dark:bg-gray-900"
                    />
                  </label>
                </div>
              </div>
            </div>
          </div>

          <!-- Notification Channels -->
          <div v-if="filteredChannels.length > 0">
            <h2 class="mb-4 text-sm font-medium text-gray-900 dark:text-white">
              Notification Channels
            </h2>
            <div
              class="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800"
            >
              <!-- Discord Section -->
              <div v-if="filteredChannels.some((c) => c.id === 'discord')">
                <div class="flex items-center justify-between px-4 py-3">
                  <div class="flex items-center gap-3">
                    <svg
                      class="h-5 w-5 text-[#5865F2]"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <path
                        d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"
                      />
                    </svg>
                    <div>
                      <h3
                        class="text-sm font-medium text-gray-900 dark:text-white"
                      >
                        Discord
                      </h3>
                      <p class="text-xs text-gray-500 dark:text-gray-400">
                        Receive notifications via Discord webhook
                      </p>
                    </div>
                  </div>
                  <label
                    class="relative inline-flex cursor-pointer items-center"
                  >
                    <input
                      type="checkbox"
                      v-model="form.discordEnabled"
                      class="peer sr-only"
                    />
                    <div
                      class="peer-checked:bg-brand peer h-5 w-9 rounded-full bg-gray-200 after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none dark:border-gray-600 dark:bg-gray-700"
                    ></div>
                  </label>
                </div>
                <div
                  v-if="form.discordEnabled"
                  class="border-t border-gray-200 dark:border-gray-800"
                >
                  <div class="px-4 py-3">
                    <label
                      class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
                      >Webhook URL</label
                    >
                    <input
                      type="text"
                      v-model="form.discordWebhookUrl"
                      placeholder="https://discord.com/api/webhooks/..."
                      class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 font-mono text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
                    />
                    <p class="mt-1 text-xs text-gray-400 dark:text-gray-500">
                      Create a webhook in your Discord server settings under
                      Integrations
                    </p>
                  </div>
                  <div class="px-4 py-3">
                    <button
                      type="button"
                      @click="testChannel('discord')"
                      :disabled="
                        testing === 'discord' || !form.discordWebhookUrl
                      "
                      class="rounded-md border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      {{
                        testing === 'discord'
                          ? 'Sending...'
                          : 'Send test message'
                      }}
                    </button>
                    <p
                      v-if="testResult?.channel === 'discord'"
                      class="mt-2 text-sm text-red-600 dark:text-red-400"
                    >
                      {{ testResult.message }}
                    </p>
                  </div>
                </div>
              </div>

              <!-- Slack Section -->
              <div
                v-if="filteredChannels.some((c) => c.id === 'slack')"
                class="border-t border-gray-200 dark:border-gray-800"
              >
                <div class="flex items-center justify-between px-4 py-3">
                  <div class="flex items-center gap-3">
                    <svg
                      class="h-5 w-5 text-[#4A154B]"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" />
                    </svg>
                    <div>
                      <h3
                        class="text-sm font-medium text-gray-900 dark:text-white"
                      >
                        Slack
                      </h3>
                      <p class="text-xs text-gray-500 dark:text-gray-400">
                        Receive notifications via Slack webhook
                      </p>
                    </div>
                  </div>
                  <label
                    class="relative inline-flex cursor-pointer items-center"
                  >
                    <input
                      type="checkbox"
                      v-model="form.slackEnabled"
                      class="peer sr-only"
                    />
                    <div
                      class="peer-checked:bg-brand peer h-5 w-9 rounded-full bg-gray-200 after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none dark:border-gray-600 dark:bg-gray-700"
                    ></div>
                  </label>
                </div>
                <div
                  v-if="form.slackEnabled"
                  class="border-t border-gray-200 dark:border-gray-800"
                >
                  <div class="px-4 py-3">
                    <label
                      class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
                      >Webhook URL</label
                    >
                    <input
                      type="text"
                      v-model="form.slackWebhookUrl"
                      placeholder="https://hooks.slack.com/services/..."
                      class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 font-mono text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
                    />
                    <p class="mt-1 text-xs text-gray-400 dark:text-gray-500">
                      Create an incoming webhook in your Slack workspace settings
                    </p>
                  </div>
                  <div class="px-4 py-3">
                    <button
                      type="button"
                      @click="testChannel('slack')"
                      :disabled="
                        testing === 'slack' || !form.slackWebhookUrl
                      "
                      class="rounded-md border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      {{
                        testing === 'slack'
                          ? 'Sending...'
                          : 'Send test message'
                      }}
                    </button>
                    <p
                      v-if="testResult?.channel === 'slack'"
                      class="mt-2 text-sm text-red-600 dark:text-red-400"
                    >
                      {{ testResult.message }}
                    </p>
                  </div>
                </div>
              </div>

              <!-- Telegram Section -->
              <div
                v-if="filteredChannels.some((c) => c.id === 'telegram')"
                class="border-t border-gray-200 dark:border-gray-800"
              >
                <div class="flex items-center justify-between px-4 py-3">
                  <div class="flex items-center gap-3">
                    <svg
                      class="h-5 w-5 text-[#0088cc]"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <path
                        d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"
                      />
                    </svg>
                    <div>
                      <h3
                        class="text-sm font-medium text-gray-900 dark:text-white"
                      >
                        Telegram
                      </h3>
                      <p class="text-xs text-gray-500 dark:text-gray-400">
                        Receive instant notifications via Telegram bot
                      </p>
                    </div>
                  </div>
                  <label
                    class="relative inline-flex cursor-pointer items-center"
                  >
                    <input
                      type="checkbox"
                      v-model="form.telegramEnabled"
                      class="peer sr-only"
                    />
                    <div
                      class="peer-checked:bg-brand peer h-5 w-9 rounded-full bg-gray-200 after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none dark:border-gray-600 dark:bg-gray-700"
                    ></div>
                  </label>
                </div>
                <div
                  v-if="form.telegramEnabled"
                  class="border-t border-gray-200 dark:border-gray-800"
                >
                  <div class="px-4 py-3">
                    <label
                      class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
                      >Bot Token</label
                    >
                    <div class="flex items-center gap-2">
                      <input
                        :type="revealToken ? 'text' : 'password'"
                        v-model="form.telegramBotToken"
                        placeholder="123456789:ABCDefGhIJKlmNoPQRsTUVwxyZ"
                        class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 font-mono text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
                      />
                      <button
                        type="button"
                        @click="revealToken = !revealToken"
                        class="rounded p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                      >
                        <svg
                          v-if="revealToken"
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
                    </div>
                    <p class="mt-1 text-xs text-gray-400 dark:text-gray-500">
                      Create a bot via
                      <a
                        href="https://t.me/BotFather"
                        target="_blank"
                        class="text-brand hover:underline"
                        >@BotFather</a
                      >
                    </p>
                  </div>
                  <div class="px-4 py-3">
                    <label
                      class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
                      >Chat ID</label
                    >
                    <input
                      type="text"
                      v-model="form.telegramChatId"
                      placeholder="-1001234567890"
                      class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 font-mono text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500 sm:max-w-xs"
                    />
                    <p class="mt-1 text-xs text-gray-400 dark:text-gray-500">
                      The chat, group, or channel ID to send messages to
                    </p>
                  </div>
                  <div class="px-4 py-3">
                    <label
                      class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
                      >Topic Thread ID
                      <span class="font-normal text-gray-400 dark:text-gray-500"
                        >(optional)</span
                      ></label
                    >
                    <input
                      type="text"
                      v-model="form.telegramThreadId"
                      placeholder="12345"
                      class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 font-mono text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500 sm:max-w-xs"
                    />
                    <p class="mt-1 text-xs text-gray-400 dark:text-gray-500">
                      For groups with Topics enabled, send to a specific topic thread
                    </p>
                  </div>
                  <div class="px-4 py-3">
                    <button
                      type="button"
                      @click="testChannel('telegram')"
                      :disabled="
                        testing === 'telegram' ||
                        !form.telegramBotToken ||
                        !form.telegramChatId
                      "
                      class="rounded-md border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      {{
                        testing === 'telegram'
                          ? 'Sending...'
                          : 'Send test message'
                      }}
                    </button>
                    <p
                      v-if="testResult?.channel === 'telegram'"
                      class="mt-2 text-sm text-red-600 dark:text-red-400"
                    >
                      {{ testResult.message }}
                    </p>
                  </div>
                </div>
              </div>

              <!-- Email Section -->
              <div
                v-if="filteredChannels.some((c) => c.id === 'email')"
                class="border-t border-gray-200 dark:border-gray-800"
              >
                <div class="flex items-center justify-between px-4 py-3">
                  <div class="flex items-center gap-3">
                    <svg
                      class="h-5 w-5 text-gray-500"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="1.5"
                        d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                      />
                    </svg>
                    <div>
                      <h3
                        class="text-sm font-medium text-gray-900 dark:text-white"
                      >
                        Email
                      </h3>
                      <p class="text-xs text-gray-500 dark:text-gray-400">
                        Receive notifications via email
                      </p>
                    </div>
                  </div>
                  <label
                    class="relative inline-flex cursor-pointer items-center"
                  >
                    <input
                      type="checkbox"
                      v-model="form.smtpEnabled"
                      class="peer sr-only"
                    />
                    <div
                      class="peer-checked:bg-brand peer h-5 w-9 rounded-full bg-gray-200 after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none dark:border-gray-600 dark:bg-gray-700"
                    ></div>
                  </label>
                </div>
                <div
                  v-if="form.smtpEnabled"
                  class="border-t border-gray-200 dark:border-gray-800"
                >
                  <!-- Env vars notice -->
                  <div
                    v-if="smtp.fromEnv"
                    class="flex items-start gap-3 bg-blue-50/50 px-4 py-3 dark:bg-blue-950/20"
                  >
                    <svg
                      class="mt-0.5 h-4 w-4 text-blue-500"
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
                    <p class="text-xs text-blue-700 dark:text-blue-300">
                      SMTP settings are being loaded from your global
                      environment variables (MAIL_HOST, MAIL_USER, etc.).
                      Changes here will override those values.
                    </p>
                  </div>
                  <div class="grid gap-4 px-4 py-3 sm:grid-cols-2">
                    <div>
                      <label
                        class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
                        >SMTP Host</label
                      >
                      <input
                        type="text"
                        v-model="form.smtpHost"
                        placeholder="smtp.example.com"
                        class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
                      />
                    </div>
                    <div>
                      <label
                        class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
                        >Port</label
                      >
                      <input
                        type="text"
                        v-model="form.smtpPort"
                        placeholder="587"
                        class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
                      />
                    </div>
                  </div>
                  <div class="grid gap-4 px-4 py-3 sm:grid-cols-2">
                    <div>
                      <label
                        class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
                        >Username</label
                      >
                      <input
                        type="text"
                        v-model="form.smtpUser"
                        placeholder="user@example.com"
                        class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
                      />
                    </div>
                    <div>
                      <label
                        class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
                        >Password</label
                      >
                      <input
                        type="password"
                        v-model="form.smtpPassword"
                        :placeholder="
                          smtp.hasPassword ? '••••••••' : 'Enter password'
                        "
                        class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
                      />
                      <p class="mt-1 text-xs text-gray-400 dark:text-gray-500">
                        Leave blank to keep existing
                      </p>
                    </div>
                  </div>
                  <div class="px-4 py-3">
                    <label
                      class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
                      >From Address</label
                    >
                    <input
                      type="email"
                      v-model="form.smtpFrom"
                      placeholder="noreply@example.com"
                      class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500 sm:max-w-xs"
                    />
                  </div>
                  <div class="px-4 py-3">
                    <label
                      class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
                      >Notification Recipients</label
                    >
                    <input
                      type="text"
                      v-model="form.notificationEmails"
                      placeholder="admin@example.com, team@example.com"
                      class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
                    />
                    <p class="mt-1 text-xs text-gray-400 dark:text-gray-500">
                      Comma-separated list of email addresses
                    </p>
                  </div>
                  <div class="px-4 py-3">
                    <button
                      type="button"
                      @click="testChannel('email')"
                      :disabled="
                        testing === 'email' ||
                        !form.smtpHost ||
                        !form.notificationEmails
                      "
                      class="rounded-md border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      {{
                        testing === 'email' ? 'Sending...' : 'Send test email'
                      }}
                    </button>
                    <p
                      v-if="testResult?.channel === 'email'"
                      class="mt-2 text-sm text-red-600 dark:text-red-400"
                    >
                      {{ testResult.message }}
                    </p>
                  </div>
                </div>
              </div>

              <!-- Webhook Section -->
              <div
                v-if="filteredChannels.some((c) => c.id === 'webhook')"
                class="border-t border-gray-200 dark:border-gray-800"
              >
                <div class="flex items-center justify-between px-4 py-3">
                  <div class="flex items-center gap-3">
                    <svg
                      class="h-5 w-5 text-gray-500"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="1.5"
                        d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                      />
                    </svg>
                    <div>
                      <h3
                        class="text-sm font-medium text-gray-900 dark:text-white"
                      >
                        Webhook
                      </h3>
                      <p class="text-xs text-gray-500 dark:text-gray-400">
                        Send structured JSON to any URL (n8n, Zapier, custom)
                      </p>
                    </div>
                  </div>
                  <label
                    class="relative inline-flex cursor-pointer items-center"
                  >
                    <input
                      type="checkbox"
                      v-model="form.webhookEnabled"
                      class="peer sr-only"
                    />
                    <div
                      class="peer-checked:bg-brand peer h-5 w-9 rounded-full bg-gray-200 after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none dark:border-gray-600 dark:bg-gray-700"
                    ></div>
                  </label>
                </div>
                <div
                  v-if="form.webhookEnabled"
                  class="border-t border-gray-200 dark:border-gray-800"
                >
                  <div class="px-4 py-3">
                    <label
                      class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
                      >Webhook URL</label
                    >
                    <input
                      type="text"
                      v-model="form.webhookUrl"
                      placeholder="https://example.com/webhook"
                      class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 font-mono text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
                    />
                    <p class="mt-1 text-xs text-gray-400 dark:text-gray-500">
                      Receives POST with JSON payload: { event, timestamp, data }
                    </p>
                  </div>
                  <div class="px-4 py-3">
                    <button
                      type="button"
                      @click="testChannel('webhook')"
                      :disabled="
                        testing === 'webhook' || !form.webhookUrl
                      "
                      class="rounded-md border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      {{
                        testing === 'webhook'
                          ? 'Sending...'
                          : 'Send test webhook'
                      }}
                    </button>
                    <p
                      v-if="testResult?.channel === 'webhook'"
                      class="mt-2 text-sm text-red-600 dark:text-red-400"
                    >
                      {{ testResult.message }}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- No results -->
          <div
            v-if="
              Object.keys(groupedEvents).length === 0 &&
              filteredChannels.length === 0
            "
            class="py-8 text-center"
          >
            <p class="text-sm text-gray-500 dark:text-gray-400">
              No results for "{{ search }}"
            </p>
          </div>

          <!-- Save button -->
          <div
            class="flex justify-end pt-6"
          >
            <button
              type="submit"
              :disabled="form.processing || !form.isDirty"
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
