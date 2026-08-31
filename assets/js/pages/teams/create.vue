<script setup>
import SidebarOpen from '@/components/ui/icons/SidebarOpen.vue'
import SidebarClose from '@/components/ui/icons/SidebarClose.vue'
import ExternalLink from '@/components/ui/icons/ExternalLink.vue'
import Input from '@/components/ui/input/Input.vue'
import Button from '@/components/ui/button/Button.vue'
import { useForm, Head, Link } from '@inertiajs/vue3'
import { inject } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'

defineOptions({
  layout: AppLayout
})

const form = useForm({
  name: ''
})

const submit = () => {
  form.post('/teams')
}

const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')
</script>
<template>
  <Head title="Create Team | Slipway"></Head>
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
        <nav class="flex items-center text-sm">
          <span class="font-medium text-gray-900 dark:text-white"
            >create team</span
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
    <div
      class="mx-auto w-full max-w-5xl flex-1 px-4 pb-8 pt-8 sm:px-8 sm:pt-16"
    >
      <div class="flex justify-center">
        <div class="w-full max-w-md">
          <p class="mb-8 text-center text-sm text-gray-500 dark:text-gray-400">
            Teams let you organize projects and collaborate with others.
          </p>

          <!-- Error message -->
          <div
            v-if="form.errors.name"
            class="mb-6 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400"
          >
            {{ form.errors.name }}
          </div>

          <form @submit.prevent="submit" class="space-y-4">
            <Input
              id="name"
              v-model="form.name"
              type="text"
              placeholder="Team name"
              autofocus
              class="focus:border-brand h-12 w-full border-b border-dashed border-gray-200 bg-transparent px-1 text-gray-900 placeholder-gray-400 focus:outline-none dark:border-gray-700 dark:text-white dark:placeholder-gray-500"
            />

            <div class="flex items-center justify-end space-x-3 pt-4">
              <Button
                :as="Link"
                href="/"
                class="min-h-0 min-w-0 bg-transparent px-3 py-1.5 text-sm font-normal text-gray-500 hover:bg-transparent hover:text-gray-900 active:bg-transparent dark:bg-transparent dark:text-gray-400 dark:hover:bg-transparent dark:hover:text-white dark:active:bg-transparent"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                :disabled="form.processing || !form.name"
                :aria-busy="form.processing ? 'true' : undefined"
                class="min-h-0 min-w-0 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 active:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100 dark:active:bg-gray-200"
              >
                {{ form.processing ? 'Creating...' : 'Create team' }}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  </div>
</template>
