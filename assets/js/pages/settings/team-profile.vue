<script setup>
import Input from '@/components/ui/input/Input.vue'
import { Link, Head, useForm } from '@inertiajs/vue3'
import { inject, ref, computed } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'
import Spinner from '@/components/SlipwaySpinner.vue'
import Avatar from '@/components/ui/avatar/Avatar.vue'
import { usePrecognitionValidation } from '@/composables/precognition'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  team: Object,
  uploadsConfigured: Boolean
})

const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')

const form = useForm({
  name: props.team.name
})
  .withPrecognition('patch', '/settings/team-profile')
  .setValidationTimeout(350)
const { revalidateWhenInvalid, validateOnBlur } =
  usePrecognitionValidation(form)

const logoForm = useForm({
  logo: null
})
const removeLogoForm = useForm({})
const logoPreview = ref(props.team.logoUrl)
const uploading = computed(
  () => logoForm.processing || removeLogoForm.processing
)
const uploadError = computed(
  () => logoForm.errors.logo || removeLogoForm.errors.logo
)

function save() {
  form.patch('/settings/team-profile', {
    preserveScroll: true
  })
}

function handleLogoUpload(event) {
  const file = event.target.files?.[0]
  if (!file) return

  logoForm.clearErrors()
  removeLogoForm.clearErrors()

  if (!file.type.startsWith('image/')) {
    logoForm.setError('logo', 'Please select an image file')
    return
  }

  if (file.size > 5 * 1024 * 1024) {
    logoForm.setError('logo', 'Image must be smaller than 5MB')
    return
  }

  const reader = new FileReader()
  reader.onload = (e) => {
    logoPreview.value = e.target.result
  }
  reader.readAsDataURL(file)

  logoForm.logo = file
  logoForm.post('/settings/team-profile/logo', {
    forceFormData: true,
    preserveScroll: true,
    onError: () => {
      logoPreview.value = props.team.logoUrl
    },
    onFinish: () => {
      logoForm.logo = null
      event.target.value = ''
    }
  })
}

function removeLogo() {
  logoForm.clearErrors()
  removeLogoForm.clearErrors()
  removeLogoForm.delete('/settings/team-profile/logo', {
    preserveScroll: true,
    onSuccess: () => {
      logoPreview.value = null
    }
  })
}

const initials = computed(() => {
  return props.team.name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
})
</script>
<template>
  <Head title="Team Profile | Slipway"></Head>
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
            >team profile</span
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
            Team Profile
          </h1>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Customize your team's name and logo.
          </p>
        </div>

        <!-- Logo section -->
        <div
          class="mb-6 rounded-lg border border-gray-200 dark:border-gray-800"
        >
          <div class="px-4 py-3">
            <h2 class="text-sm font-medium text-gray-900 dark:text-white">
              Team Logo
            </h2>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              Displayed in the sidebar and team switcher. Recommended size:
              128x128px.
            </p>
          </div>
          <div class="border-t border-gray-200 px-4 py-4 dark:border-gray-800">
            <div class="flex items-center gap-4">
              <!-- Logo preview -->
              <div class="relative">
                <Avatar
                  data-test="team-profile-avatar"
                  :src="logoPreview"
                  :alt="`${props.team.name} team logo`"
                  :class="[
                    'bg-brand h-16 w-16 rounded-lg object-cover text-xl font-semibold text-white',
                    logoPreview
                      ? 'border border-gray-200 dark:border-gray-700'
                      : ''
                  ]"
                >
                  {{ initials }}
                </Avatar>
                <!-- Uploading overlay -->
                <div
                  v-if="uploading"
                  role="status"
                  class="absolute inset-0 flex items-center justify-center rounded-lg bg-black/50"
                >
                  <Spinner class="h-5 w-5 text-white" />
                  <span class="sr-only">Uploading team logo</span>
                </div>
              </div>

              <!-- Upload controls -->
              <div class="flex flex-col gap-2">
                <template v-if="uploadsConfigured">
                  <div class="flex items-center gap-2">
                    <label
                      class="cursor-pointer rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      <span>{{ logoPreview ? 'Change' : 'Upload' }}</span>
                      <input
                        type="file"
                        accept="image/*"
                        class="hidden"
                        @change="handleLogoUpload"
                        :disabled="uploading"
                      />
                    </label>
                    <button
                      v-if="logoPreview"
                      @click="removeLogo"
                      :disabled="uploading"
                      class="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-gray-600 dark:text-red-400 dark:hover:bg-red-900/20"
                    >
                      Remove
                    </button>
                  </div>
                  <p
                    v-if="uploadError"
                    class="text-xs text-red-600 dark:text-red-400"
                  >
                    {{ uploadError }}
                  </p>
                </template>
                <template v-else>
                  <div
                    class="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50/50 px-3 py-2 dark:border-amber-900/50 dark:bg-amber-950/20"
                  >
                    <svg
                      class="h-4 w-4 text-amber-500"
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
                    <span class="text-sm text-amber-700 dark:text-amber-400">
                      <Link
                        href="/settings/uploads"
                        class="underline hover:no-underline"
                        >Configure file storage</Link
                      >
                      {{ ' ' }}to enable logo uploads.
                    </span>
                  </div>
                </template>
              </div>
            </div>
          </div>
        </div>

        <!-- Team name form -->
        <form @submit.prevent="save" class="space-y-6">
          <div class="rounded-lg border border-gray-200 dark:border-gray-800">
            <div class="px-4 py-3">
              <label
                for="teamName"
                class="text-sm font-medium text-gray-900 dark:text-white"
                >Team Name</label
              >
              <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                The name of your team. This will also update the team slug.
              </p>
            </div>
            <div
              class="border-t border-gray-200 px-4 py-3 dark:border-gray-800"
            >
              <Input
                id="teamName"
                v-model="form.name"
                type="text"
                required
                placeholder="My Team"
                :aria-invalid="form.invalid('name')"
                :aria-describedby="form.errors.name ? 'team-name-error' : null"
                class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500 sm:max-w-md"
                @blur="validateOnBlur('name', $event)"
                @input="revalidateWhenInvalid('name')"
              />
              <p
                v-if="form.errors.name"
                id="team-name-error"
                class="mt-1 text-sm text-red-600 dark:text-red-400"
              >
                {{ form.errors.name }}
              </p>
              <p class="mt-2 text-xs text-gray-400 dark:text-gray-500">
                Slug:
                <span class="font-mono">{{
                  form.name
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/^-|-$/g, '') || 'my-team'
                }}</span>
              </p>
            </div>
          </div>

          <!-- Save button -->
          <div class="flex justify-end">
            <button
              type="submit"
              :disabled="
                form.processing ||
                form.hasErrors ||
                !form.isDirty ||
                !form.name.trim()
              "
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
