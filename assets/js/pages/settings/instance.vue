<script setup>
import SidebarOpen from '@/components/ui/icons/SidebarOpen.vue'
import SidebarClose from '@/components/ui/icons/SidebarClose.vue'
import ExternalLink from '@/components/ui/icons/ExternalLink.vue'
import Input from '@/components/ui/input/Input.vue'
import { Link, Head, useForm } from '@inertiajs/vue3'
import { inject } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'
import { usePrecognitionValidation } from '@/composables/precognition'
defineOptions({
  layout: AppLayout
})

const props = defineProps({
  instanceDomain: String,
  instanceName: String,
  acmeEmail: String
})

const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')

const form = useForm({
  instanceDomain: props.instanceDomain || '',
  instanceName: props.instanceName || '',
  acmeEmail: props.acmeEmail || ''
})
  .withPrecognition('patch', '/settings/instance')
  .setValidationTimeout(350)
const { revalidateWhenInvalid, validateOnBlur } =
  usePrecognitionValidation(form)

function save() {
  form.patch('/settings/instance', { preserveScroll: true })
}
</script>
<template>
  <Head title="Instance Settings | Slipway"></Head>
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
          <SidebarOpen class="h-5 w-5" stroke-width="1" />
        </button>
        <!-- Desktop sidebar toggle -->
        <button
          @click="toggleSidebar"
          class="hidden text-gray-400 dark:text-gray-500 md:block"
        >
          <SidebarOpen
            v-if="sidebarCollapsed"
            class="h-5 w-5"
            stroke-width="1"
          />
          <SidebarClose v-else class="h-5 w-5" stroke-width="1" />
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
            >instance</span
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
          <ExternalLink class="h-3.5 w-3.5" stroke-width="2" />
        </a>
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
      <div class="mx-auto max-w-6xl">
        <!-- Description -->
        <div class="mb-6">
          <h1 class="text-xl font-semibold text-gray-900 dark:text-white">
            Instance Settings
          </h1>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Configure your Slipway instance domain and branding.
          </p>
        </div>

        <form @submit.prevent="save" class="space-y-6">
          <!-- Instance Name -->
          <div class="rounded-lg border border-gray-200 dark:border-gray-800">
            <div class="px-4 py-3">
              <label
                for="instanceName"
                class="text-sm font-medium text-gray-900 dark:text-white"
                >Instance Name</label
              >
              <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                The name displayed in the browser tab and emails
              </p>
            </div>
            <div
              class="border-t border-gray-200 px-4 py-3 dark:border-gray-800"
            >
              <Input
                id="instanceName"
                v-model="form.instanceName"
                type="text"
                placeholder="Slipway"
                :aria-invalid="form.invalid('instanceName')"
                :aria-describedby="
                  form.errors.instanceName ? 'instance-name-error' : null
                "
                class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500 sm:max-w-md"
                @blur="validateOnBlur('instanceName', $event)"
                @input="revalidateWhenInvalid('instanceName')"
              />
              <p
                v-if="form.errors.instanceName"
                id="instance-name-error"
                class="mt-1 text-sm text-red-600 dark:text-red-400"
              >
                {{ form.errors.instanceName }}
              </p>
            </div>
          </div>

          <!-- Instance Domain -->
          <div class="rounded-lg border border-gray-200 dark:border-gray-800">
            <div class="px-4 py-3">
              <label
                for="instanceDomain"
                class="text-sm font-medium text-gray-900 dark:text-white"
                >Instance Domain</label
              >
              <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                The domain where this Slipway instance is hosted. Used for
                generating callback URLs and links.
              </p>
            </div>
            <div
              class="border-t border-gray-200 px-4 py-3 dark:border-gray-800"
            >
              <div class="flex items-center">
                <span class="text-sm text-gray-400 dark:text-gray-500"
                  >https://</span
                >
                <Input
                  id="instanceDomain"
                  v-model="form.instanceDomain"
                  type="text"
                  placeholder="slipway.example.com"
                  :aria-invalid="form.invalid('instanceDomain')"
                  :aria-describedby="
                    form.errors.instanceDomain ? 'instance-domain-error' : null
                  "
                  class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500 sm:max-w-md"
                  @blur="validateOnBlur('instanceDomain', $event)"
                  @input="revalidateWhenInvalid('instanceDomain')"
                />
              </div>
              <p
                v-if="form.errors.instanceDomain"
                id="instance-domain-error"
                class="mt-1 text-sm text-red-600 dark:text-red-400"
              >
                {{ form.errors.instanceDomain }}
              </p>
            </div>
          </div>

          <!-- SSL / Let's Encrypt -->
          <div class="rounded-lg border border-gray-200 dark:border-gray-800">
            <div class="px-4 py-3">
              <label
                for="acmeEmail"
                class="text-sm font-medium text-gray-900 dark:text-white"
                >SSL / Let's Encrypt Email</label
              >
              <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                Provide an email to enable automatic HTTPS via Let's Encrypt.
                Caddy will provision and renew TLS certificates for all
                configured domains.
              </p>
            </div>
            <div
              class="border-t border-gray-200 px-4 py-3 dark:border-gray-800"
            >
              <Input
                id="acmeEmail"
                v-model="form.acmeEmail"
                type="email"
                placeholder="admin@example.com"
                :aria-invalid="form.invalid('acmeEmail')"
                :aria-describedby="
                  form.errors.acmeEmail ? 'acme-email-error' : null
                "
                class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500 sm:max-w-md"
                @blur="validateOnBlur('acmeEmail', $event)"
                @input="revalidateWhenInvalid('acmeEmail')"
              />
              <p
                v-if="form.errors.acmeEmail"
                id="acme-email-error"
                class="mt-1 text-sm text-red-600 dark:text-red-400"
              >
                {{ form.errors.acmeEmail }}
              </p>
            </div>
          </div>

          <!-- Save button -->
          <div class="flex justify-end">
            <button
              type="submit"
              :disabled="form.processing || form.hasErrors || !form.isDirty"
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
