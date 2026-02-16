<script setup>
import { Link, Head, router, useForm } from '@inertiajs/vue3'
import { inject, ref, computed } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'
import Breadcrumb from '@/components/Breadcrumb.vue'
import Tooltip from '@/components/Tooltip.vue'
import SlippyLoader from '@/components/SlippyLoader.vue'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  project: Object,
  environment: Object,
  hasQuestFeature: Boolean,
  questFeature: Object,
  appRunning: Boolean,
  jobs: Array,
  jobsError: String
})

const toggleMobileMenu = inject('toggleMobileMenu')
const toggleSidebar = inject('toggleSidebar')
const sidebarCollapsed = inject('sidebarCollapsed')

// Local state for actions
const runningJob = ref(null)
const jobOutputs = ref({}) // Per-job output tracking
const pauseForm = useForm({})
const resumeForm = useForm({})

// Computed for error display
const error = computed(() => props.jobsError)

// Run a job (keep as fetch since it returns output to display)
async function runJob(jobName) {
  runningJob.value = jobName
  jobOutputs.value[jobName] = { running: true, output: null }

  try {
    const envPath = props.environment.slug !== 'production'
      ? `/environments/${props.environment.slug}`
      : ''
    const res = await fetch(`/api/v1/projects/${props.project.slug}${envPath}/quest/jobs/${jobName}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    })
    const data = await res.json()

    jobOutputs.value[jobName] = {
      running: false,
      output: {
        success: data.success,
        stdout: data.output || '',
        stderr: data.error || '',
        exitCode: data.exitCode
      }
    }

    // Refresh job list via Inertia
    router.reload({ only: ['jobs', 'jobsError'] })
  } catch (e) {
    jobOutputs.value[jobName] = {
      running: false,
      output: {
        success: false,
        stdout: '',
        stderr: e.message,
        exitCode: 1
      }
    }
  } finally {
    runningJob.value = null
  }
}

// Dismiss job output
function dismissOutput(jobName) {
  delete jobOutputs.value[jobName]
}

// Pause a job
function pauseJob(jobName) {
  const envPath = props.environment.slug !== 'production'
    ? `/environments/${props.environment.slug}`
    : ''
  pauseForm.post(`/projects/${props.project.slug}${envPath}/quest/${jobName}/pause`, {
    preserveScroll: true
  })
}

// Resume a job
function resumeJob(jobName) {
  const envPath = props.environment.slug !== 'production'
    ? `/environments/${props.environment.slug}`
    : ''
  resumeForm.post(`/projects/${props.project.slug}${envPath}/quest/${jobName}/resume`, {
    preserveScroll: true
  })
}

function formatSchedule(job) {
  if (job.scheduleType === 'cron') return job.schedule
  if (job.scheduleType === 'interval') return job.schedule
  if (job.scheduleType === 'timeout') return job.schedule
  return 'manual'
}

function refresh() {
  router.reload({ only: ['jobs', 'jobsError'] })
}
</script>
<template>
  <Head :title="`Quest - ${project.name} | Slipway`"></Head>
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
        <Breadcrumb :items="[
          { label: 'projects', href: '/' },
          { label: project.name.toLowerCase(), href: `/projects/${project.slug}` },
          { label: environment.name.toLowerCase(), href: `/projects/${project.slug}/environments/${environment.slug}` },
          { label: 'quest' }
        ]" />
      </div>
      <div class="flex items-center space-x-4">
        <a
          href="https://docs.sailscasts.com/slipway/quest"
          target="_blank"
          class="flex items-center space-x-1 text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
        >
          <span>Docs</span>
          <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
      <div class="mx-auto max-w-4xl">
        <!-- Header -->
        <div class="mb-8">
          <h1 class="text-xl font-semibold text-gray-900 dark:text-white">Quest</h1>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Manage scheduled jobs running in your application.
          </p>
        </div>

        <!-- Feature not available -->
        <div v-if="!hasQuestFeature" class="rounded-lg border border-dashed border-gray-300 px-6 py-12 text-center dark:border-gray-700">
          <svg class="mx-auto h-10 w-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h3 class="mt-4 text-sm font-medium text-gray-900 dark:text-white">sails-hook-quest not detected</h3>
          <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Deploy your app with <code class="rounded bg-gray-100 px-1.5 py-0.5 text-xs dark:bg-gray-800">sails-hook-quest</code> installed to enable job scheduling.
          </p>
          <a
            href="https://docs.sailscasts.com/sails-quest"
            target="_blank"
            class="mt-4 inline-flex items-center space-x-1 text-sm text-amber-600 hover:text-amber-500 dark:text-amber-400"
          >
            <span>Learn more</span>
            <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        </div>

        <!-- App not running -->
        <div v-else-if="!appRunning" class="rounded-lg border border-dashed border-gray-300 px-6 py-12 text-center dark:border-gray-700">
          <svg class="mx-auto h-10 w-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M5.636 18.364a9 9 0 010-12.728m12.728 0a9 9 0 010 12.728m-9.9-2.829a5 5 0 010-7.07m7.072 0a5 5 0 010 7.07M13 12a1 1 0 11-2 0 1 1 0 012 0z" />
          </svg>
          <h3 class="mt-4 text-sm font-medium text-gray-900 dark:text-white">App not running</h3>
          <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Deploy your app to see and manage scheduled jobs.
          </p>
        </div>

        <!-- Error -->
        <div v-else-if="error" class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-900/50 dark:bg-red-950/20">
          <p class="text-sm text-red-700 dark:text-red-400">{{ error }}</p>
          <button @click="refresh" class="mt-2 text-sm text-red-600 underline hover:text-red-500 dark:text-red-400">
            Try again
          </button>
        </div>

        <!-- Jobs list -->
        <div v-else-if="jobs.length > 0" class="space-y-4">
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-medium text-gray-900 dark:text-white">Scripts</h2>
            <Tooltip text="Refresh">
              <button
                @click="refresh"
                class="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
              >
                <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </Tooltip>
          </div>

          <div class="rounded-lg border border-gray-200 bg-white divide-y divide-gray-200 dark:border-gray-800 dark:bg-gray-950 dark:divide-gray-800">
            <div
              v-for="job in jobs"
              :key="job.name"
              class="px-4 py-4"
            >
              <div class="flex items-start justify-between">
                <div class="flex-1">
                  <div class="flex items-center space-x-3">
                    <h3 class="text-sm font-medium text-gray-900 dark:text-white">{{ job.friendlyName }}</h3>
                    <span v-if="job.isRunning" class="inline-flex rounded-md px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                      Running
                    </span>
                    <span v-else-if="job.paused" class="inline-flex rounded-md px-2 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
                      Paused
                    </span>
                    <span v-if="job.withoutOverlapping" class="inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                      no overlap
                    </span>
                  </div>
                  <p v-if="job.description" class="mt-1 text-sm text-gray-500 dark:text-gray-400">{{ job.description }}</p>
                  <div class="mt-2 flex items-center space-x-4">
                    <div class="flex items-center space-x-1 text-xs text-gray-400 dark:text-gray-500">
                      <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>{{ formatSchedule(job) }}</span>
                    </div>
                  </div>
                </div>

                <div class="flex items-center space-x-1">
                  <!-- Run button (icon only) -->
                  <Tooltip text="Run now">
                    <button
                      @click="runJob(job.name)"
                      :disabled="runningJob === job.name || job.isRunning"
                      class="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                    >
                      <SlippyLoader v-if="runningJob === job.name" size="h-4 w-4" />
                      <svg v-else class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </button>
                  </Tooltip>

                  <!-- Pause/Resume button (icon only, only for scheduled jobs) -->
                  <template v-if="job.scheduleType !== 'manual'">
                    <Tooltip :text="job.paused ? 'Resume' : 'Pause'">
                      <button
                        @click="job.paused ? resumeJob(job.name) : pauseJob(job.name)"
                        :disabled="pauseForm.processing || resumeForm.processing"
                        class="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                      >
                        <!-- Resume icon -->
                        <svg v-if="job.paused" class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                        </svg>
                        <!-- Pause icon -->
                        <svg v-else class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </button>
                    </Tooltip>
                  </template>
                </div>
              </div>

              <!-- Inline output -->
              <div v-if="jobOutputs[job.name]" class="mt-4">
                <div class="rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
                  <div class="flex items-center justify-between bg-gray-50 px-3 py-2 dark:bg-gray-900">
                    <div class="flex items-center space-x-2">
                      <span v-if="jobOutputs[job.name].running" class="flex items-center space-x-1 text-xs text-gray-500 dark:text-gray-400">
                        <SlippyLoader size="h-3 w-3" />
                        <span>Running...</span>
                      </span>
                      <span v-else-if="jobOutputs[job.name].output?.success" class="text-xs text-green-600 dark:text-green-400">Completed</span>
                      <span v-else class="text-xs text-red-600 dark:text-red-400">Failed (exit {{ jobOutputs[job.name].output?.exitCode }})</span>
                    </div>
                    <button
                      @click="dismissOutput(job.name)"
                      class="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                    >
                      <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  <div class="bg-gray-950 p-4 font-mono text-sm text-gray-300 max-h-60 overflow-y-auto">
                    <template v-if="jobOutputs[job.name].running">
                      <div class="flex items-center space-x-2 text-gray-500">
                        <SlippyLoader size="h-4 w-4" />
                        <span>Executing script...</span>
                      </div>
                    </template>
                    <template v-else-if="jobOutputs[job.name].output">
                      <pre v-if="jobOutputs[job.name].output.stdout" class="whitespace-pre-wrap text-gray-300">{{ jobOutputs[job.name].output.stdout }}</pre>
                      <pre v-if="jobOutputs[job.name].output.stderr" class="whitespace-pre-wrap text-red-400" :class="{ 'mt-2': jobOutputs[job.name].output.stdout }">{{ jobOutputs[job.name].output.stderr }}</pre>
                      <div v-if="!jobOutputs[job.name].output.stdout && !jobOutputs[job.name].output.stderr" class="text-gray-500">No output</div>
                    </template>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Empty state -->
        <div v-else class="rounded-lg border border-dashed border-gray-300 px-6 py-12 text-center dark:border-gray-700">
          <svg class="mx-auto h-10 w-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h3 class="mt-4 text-sm font-medium text-gray-900 dark:text-white">No scripts found</h3>
          <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Create scripts in your <code class="rounded bg-gray-100 px-1.5 py-0.5 text-xs dark:bg-gray-800">scripts/</code> directory.
          </p>
        </div>

      </div>
    </div>
  </div>
</template>
