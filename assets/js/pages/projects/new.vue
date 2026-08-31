<script setup>
import SidebarOpen from '@/components/ui/icons/SidebarOpen.vue'
import SidebarClose from '@/components/ui/icons/SidebarClose.vue'
import ExternalLink from '@/components/ui/icons/ExternalLink.vue'
import Textarea from '@/components/ui/textarea/Textarea.vue'
import Input from '@/components/ui/input/Input.vue'
import { useForm, Head, Link } from '@inertiajs/vue3'
import { inject } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'
import { usePrecognitionValidation } from '@/composables/precognition'

defineOptions({
  layout: AppLayout
})

const form = useForm({
  name: '',
  description: ''
})
  .withPrecognition('post', '/projects')
  .setValidationTimeout(350)
const { revalidateWhenInvalid, validateOnBlur } =
  usePrecognitionValidation(form)

const submit = () => {
  form.post('/projects')
}

const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')
</script>
<template>
  <Head title="Create Project | Slipway"></Head>
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
            href="/"
            class="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >
            projects
          </Link>
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <span class="font-medium text-gray-900 dark:text-white">
            <span class="hidden sm:inline">create project</span>
            <span class="sm:hidden">new</span>
          </span>
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
    <div
      class="mx-auto w-full max-w-5xl flex-1 px-4 pb-8 pt-8 sm:px-8 sm:pt-16"
    >
      <div class="flex justify-center">
        <div class="w-full max-w-md">
          <form @submit.prevent="submit" class="space-y-4">
            <Input
              id="name"
              v-model="form.name"
              type="text"
              placeholder="Project name"
              :aria-invalid="form.invalid('name')"
              :aria-describedby="form.errors.name ? 'project-name-error' : null"
              class="focus:border-brand h-12 w-full border-b border-dashed border-gray-200 bg-transparent px-1 text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
              @blur="validateOnBlur('name', $event)"
              @input="revalidateWhenInvalid('name')"
            />
            <p
              v-if="form.errors.name"
              id="project-name-error"
              class="-mt-2 text-sm text-red-600 dark:text-red-400"
            >
              {{ form.errors.name }}
            </p>

            <Textarea
              id="description"
              v-model="form.description"
              placeholder="A brief description about your project"
              class="focus:border-brand w-full resize-none border-b border-dashed border-gray-200 bg-transparent px-1 py-3 text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
              style="field-sizing: content"
              :aria-invalid="form.invalid('description')"
              :aria-describedby="
                form.errors.description ? 'project-description-error' : null
              "
              @blur="validateOnBlur('description', $event)"
              @input="revalidateWhenInvalid('description')"
            />
            <p
              v-if="form.errors.description"
              id="project-description-error"
              class="-mt-2 text-sm text-red-600 dark:text-red-400"
            >
              {{ form.errors.description }}
            </p>

            <div class="flex items-center justify-end space-x-3 pt-4">
              <Link
                href="/"
                class="rounded-md px-3 py-1.5 text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
              >
                Cancel
              </Link>
              <button
                type="submit"
                :disabled="form.processing || form.hasErrors || !form.name"
                class="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
              >
                {{ form.processing ? 'Creating...' : 'Create' }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  </div>
</template>
