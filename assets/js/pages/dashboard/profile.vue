<script setup>
import Input from '@/components/ui/input/Input.vue'
import { Link, Head, usePage, useForm, router } from '@inertiajs/vue3'
import { inject, ref } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import { useToast } from '@/composables/toast'
import { usePrecognitionValidation } from '@/composables/precognition'

defineOptions({
  layout: AppLayout
})

const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')

const toast = useToast()
const loggedInUser = usePage().props.loggedInUser

const form = useForm({
  email: loggedInUser.email,
  fullName: loggedInUser.fullName,
  currentPassword: '',
  password: '',
  confirmPassword: ''
})
  .withPrecognition('patch', '/profile')
  .setValidationTimeout(350)

const { revalidateWhenInvalid, validateOnBlur } =
  usePrecognitionValidation(form)

const deleteAccountForm = useForm({
  password: ''
})

function updateProfile() {
  form.patch('/profile', {
    preserveScroll: true,
    preserveState: true,
    onSuccess: () => {
      form.currentPassword = ''
      form.password = ''
      form.confirmPassword = ''
      toast({ message: 'Profile updated', type: 'success' })
    }
  })
}

const showDeleteModal = ref(false)

function deleteAccount() {
  showDeleteModal.value = true
}

function executeDeleteAccount() {
  deleteAccountForm.delete('/profile')
  showDeleteModal.value = false
}

function cancelDeleteAccount() {
  showDeleteModal.value = false
}

function logout() {
  router.delete('/logout')
}
</script>

<template>
  <Head title="Profile | Slipway"></Head>
  <div class="flex h-full flex-col">
    <!-- Header -->
    <div
      class="flex items-center justify-between border-b border-gray-200 py-4 pl-4 pr-4 dark:border-gray-800 sm:pl-4 sm:pr-8"
    >
      <div class="flex items-center space-x-3">
        <!-- Mobile menu button -->
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
        <nav class="flex items-center text-sm">
          <span class="font-medium text-gray-900 dark:text-white">profile</span>
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
      <div class="mx-auto max-w-2xl space-y-6">
        <!-- Profile Info -->
        <form
          @submit.prevent="updateProfile"
          class="rounded-lg border border-gray-200 dark:border-gray-800"
        >
          <div class="px-4 py-3">
            <h2 class="text-sm font-medium text-gray-900 dark:text-white">
              Profile Information
            </h2>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              Update your account's profile information and email address.
            </p>
          </div>
          <div
            class="divide-y divide-gray-200 border-t border-gray-200 dark:divide-gray-800 dark:border-gray-800"
          >
            <div class="px-4 py-3">
              <label class="mb-1 block text-sm text-gray-700 dark:text-gray-300"
                >Full Name</label
              >
              <Input
                id="profile-full-name"
                v-model="form.fullName"
                type="text"
                autocomplete="name"
                :aria-invalid="form.invalid('fullName') ? 'true' : undefined"
                :aria-describedby="
                  form.invalid('fullName')
                    ? 'profile-full-name-error'
                    : undefined
                "
                class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500 sm:max-w-xs"
                @blur="validateOnBlur('fullName', $event)"
                @input="revalidateWhenInvalid('fullName')"
              />
              <p
                v-if="form.errors.fullName"
                id="profile-full-name-error"
                class="mt-1 text-xs text-red-600 dark:text-red-400"
              >
                {{ form.errors.fullName }}
              </p>
            </div>
            <div class="px-4 py-3">
              <label class="mb-1 block text-sm text-gray-700 dark:text-gray-300"
                >Email</label
              >
              <Input
                id="profile-email"
                v-model="form.email"
                type="email"
                autocomplete="email"
                :aria-invalid="form.invalid('email') ? 'true' : undefined"
                :aria-describedby="
                  form.invalid('email')
                    ? 'profile-email-error'
                    : 'profile-email-description'
                "
                class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500 sm:max-w-xs"
                @blur="validateOnBlur('email', $event)"
                @input="revalidateWhenInvalid('email')"
              />
              <p
                v-if="form.errors.email"
                id="profile-email-error"
                class="mt-1 text-xs text-red-600 dark:text-red-400"
              >
                {{ form.errors.email }}
              </p>
              <p
                v-else
                id="profile-email-description"
                class="mt-1 text-xs text-gray-400 dark:text-gray-500"
              >
                Changing your email requires verification
              </p>
            </div>
            <div class="flex items-center justify-end px-4 py-3">
              <button
                type="submit"
                :disabled="form.processing || !form.isDirty || form.hasErrors"
                class="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
              >
                {{ form.processing ? 'Saving...' : 'Save changes' }}
              </button>
            </div>
          </div>
        </form>

        <!-- Change Password -->
        <form
          @submit.prevent="updateProfile"
          class="rounded-lg border border-gray-200 dark:border-gray-800"
        >
          <div class="px-4 py-3">
            <h2 class="text-sm font-medium text-gray-900 dark:text-white">
              Change Password
            </h2>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              Ensure your account is using a strong, random password.
            </p>
          </div>
          <div
            class="divide-y divide-gray-200 border-t border-gray-200 dark:divide-gray-800 dark:border-gray-800"
          >
            <div class="px-4 py-3">
              <label class="mb-1 block text-sm text-gray-700 dark:text-gray-300"
                >Current Password</label
              >
              <Input
                id="profile-current-password"
                v-model="form.currentPassword"
                type="password"
                autocomplete="current-password"
                :aria-invalid="
                  form.invalid('currentPassword') ? 'true' : undefined
                "
                :aria-describedby="
                  form.invalid('currentPassword')
                    ? 'profile-current-password-error'
                    : undefined
                "
                class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500 sm:max-w-xs"
                @blur="validateOnBlur('currentPassword', $event)"
                @input="revalidateWhenInvalid('currentPassword')"
              />
              <p
                v-if="form.errors.currentPassword"
                id="profile-current-password-error"
                class="mt-1 text-xs text-red-600 dark:text-red-400"
              >
                {{ form.errors.currentPassword }}
              </p>
            </div>
            <div class="px-4 py-3">
              <label class="mb-1 block text-sm text-gray-700 dark:text-gray-300"
                >New Password</label
              >
              <Input
                id="profile-new-password"
                v-model="form.password"
                type="password"
                autocomplete="new-password"
                :aria-invalid="form.invalid('password') ? 'true' : undefined"
                :aria-describedby="
                  form.invalid('password')
                    ? 'profile-new-password-error'
                    : undefined
                "
                class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500 sm:max-w-xs"
                @blur="validateOnBlur('password', $event)"
                @input="revalidateWhenInvalid('password')"
              />
              <p
                v-if="form.errors.password"
                id="profile-new-password-error"
                class="mt-1 text-xs text-red-600 dark:text-red-400"
              >
                {{ form.errors.password }}
              </p>
            </div>
            <div class="px-4 py-3">
              <label class="mb-1 block text-sm text-gray-700 dark:text-gray-300"
                >Confirm Password</label
              >
              <Input
                id="profile-confirm-password"
                v-model="form.confirmPassword"
                type="password"
                autocomplete="new-password"
                :aria-invalid="
                  form.invalid('confirmPassword') ? 'true' : undefined
                "
                :aria-describedby="
                  form.invalid('confirmPassword')
                    ? 'profile-confirm-password-error'
                    : undefined
                "
                class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500 sm:max-w-xs"
                @blur="validateOnBlur('confirmPassword', $event)"
                @input="revalidateWhenInvalid('confirmPassword')"
              />
              <p
                v-if="form.errors.confirmPassword"
                id="profile-confirm-password-error"
                class="mt-1 text-xs text-red-600 dark:text-red-400"
              >
                {{ form.errors.confirmPassword }}
              </p>
            </div>
            <div class="flex items-center justify-end px-4 py-3">
              <button
                type="submit"
                :disabled="
                  form.processing ||
                  !form.isDirty ||
                  !form.currentPassword ||
                  !form.password ||
                  form.hasErrors
                "
                class="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
              >
                {{ form.processing ? 'Updating...' : 'Update password' }}
              </button>
            </div>
          </div>
        </form>

        <!-- Danger Zone -->
        <div class="rounded-lg border border-red-200 dark:border-red-900/50">
          <div class="px-4 py-3">
            <h2 class="text-sm font-medium text-red-600 dark:text-red-400">
              Danger Zone
            </h2>
          </div>
          <div
            class="divide-y divide-red-100 border-t border-red-200 dark:divide-red-900/30 dark:border-red-900/50"
          >
            <div class="flex items-center justify-between px-4 py-3">
              <div>
                <p class="text-sm font-medium text-gray-900 dark:text-white">
                  Sign out
                </p>
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  Sign out of your account on this device
                </p>
              </div>
              <button
                @click="logout"
                type="button"
                class="rounded-md border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                Sign out
              </button>
            </div>
            <div class="flex items-center justify-between px-4 py-3">
              <div>
                <p class="text-sm font-medium text-gray-900 dark:text-white">
                  Delete account
                </p>
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  Permanently delete your account and all data
                </p>
              </div>
              <button
                @click="deleteAccount"
                type="button"
                class="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
              >
                Delete account
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <ConfirmModal
      :show="showDeleteModal"
      title="Delete account"
      message="Are you sure you want to delete your account? All of your data will be permanently removed. This action cannot be undone."
      confirm-label="Delete account"
      :destructive="true"
      @confirm="executeDeleteAccount"
      @cancel="cancelDeleteAccount"
    >
      <template #form>
        <div class="mt-4">
          <label
            for="delete-account-password"
            class="mb-1 block text-sm text-gray-700 dark:text-gray-300"
            >Enter your password to confirm</label
          >
          <Input
            id="delete-account-password"
            v-model="deleteAccountForm.password"
            type="password"
            autocomplete="current-password"
            class="focus:border-brand w-full border-b border-dashed border-gray-200 bg-transparent px-1 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
          />
        </div>
      </template>
    </ConfirmModal>
  </div>
</template>
