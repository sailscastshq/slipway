<script setup>
import { Link, Head, router } from '@inertiajs/vue3'
import { inject, ref, computed } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'
import Tooltip from '@/components/Tooltip.vue'

defineOptions({
  layout: AppLayout
})

const props = defineProps({
  project: Object,
  environment: Object,
  hasQuestFeature: Boolean,
  questFeature: Object,
  appRunning: Boolean
})

const toggleMobileMenu = inject('toggleMobileMenu')

// State
const jobs = ref([])
const loading = ref(true)
const error = ref(null)
const runningJob = ref(null)
const pausingJob = ref(null)
const jobOutput = ref(null)
const showOutput = ref(false)

// Fetch jobs on mount
async function fetchJobs() {
  if (!props.hasQuestFeature || !props.appRunning) {
    loading.value = false
    return
  }

  loading.value = true
  error.value = null
  try {
    const envPath = props.environment.slug !== 'production'
      ? `/environments/${props.environment.slug}`
      : ''
    const res = await fetch(`/api/v1/projects/${props.project.slug}${envPath}/quest/jobs`)
    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.message || 'Failed to load jobs')
    }
    const data = await res.json()
    jobs.value = data.jobs || []
    // Show API error if returned (e.g., hook loading issues)
    if (data.error) {
      error.value = data.error
    }
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

// Run a job
async function runJob(jobName) {
  runningJob.value = jobName
  jobOutput.value = null
  showOutput.value = true
  error.value = null

  try {
    const envPath = props.environment.slug !== 'production'
      ? `/environments/${props.environment.slug}`
      : ''
    const res = await fetch(`/api/v1/projects/${props.project.slug}${envPath}/quest/jobs/${jobName}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    })
    const data = await res.json()

    jobOutput.value = {
      job: jobName,
      success: data.success,
      output: data.output || '',
      error: data.error || '',
      exitCode: data.exitCode,
      triggeredAt: data.triggeredAt
    }

    // Refresh job list
    await fetchJobs()
  } catch (e) {
    jobOutput.value = {
      job: jobName,
      success: false,
      output: '',
      error: e.message,
      exitCode: 1
    }
  } finally {
    runningJob.value = null
  }
}

// Pause a job
async function pauseJob(jobName) {
  pausingJob.value = jobName
  try {
    const envPath = props.environment.slug !== 'production'
      ? `/environments/${props.environment.slug}`
      : ''
    const res = await fetch(`/api/v1/projects/${props.project.slug}${envPath}/quest/jobs/${jobName}/pause`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    })
    await fetchJobs()
  } catch (e) {
    error.value = e.message
  } finally {
    pausingJob.value = null
  }
}

// Resume a job
async function resumeJob(jobName) {
  pausingJob.value = jobName
  try {
    const envPath = props.environment.slug !== 'production'
      ? `/environments/${props.environment.slug}`
      : ''
    const res = await fetch(`/api/v1/projects/${props.project.slug}${envPath}/quest/jobs/${jobName}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    })
    await fetchJobs()
  } catch (e) {
    error.value = e.message
  } finally {
    pausingJob.value = null
  }
}

function formatSchedule(job) {
  if (job.scheduleType === 'cron') {
    return `cron: ${job.schedule}`
  } else if (job.scheduleType === 'interval') {
    return `every ${job.schedule}`
  } else if (job.scheduleType === 'timeout') {
    return `once after ${job.schedule}`
  } else if (job.scheduleType === 'manual') {
    return 'Manual only'
  }
  return 'No schedule'
}

function getStatusBadge(job) {
  if (job.isRunning) {
    return { label: 'Running', classes: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' }
  }
  if (job.paused) {
    return { label: 'Paused', classes: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' }
  }
  return { label: 'Active', classes: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' }
}

// Initialize
fetchJobs()
</script>
<template>
  <Head :title="`Quest - ${project.name} | Slipway`"></Head>
  <div class="flex h-full flex-col">
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-gray-200 px-4 py-4 dark:border-gray-800 sm:px-8">
      <div class="flex items-center space-x-3">
        <button
          @click="toggleMobileMenu"
          class="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white md:hidden"
        >
          <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <nav class="flex items-center space-x-2 text-sm">
          <Link href="/" class="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">
            projects
          </Link>
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <Link
            :href="`/projects/${project.slug}`"
            class="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >
            {{ project.name.toLowerCase() }}
          </Link>
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <Link
            :href="`/projects/${project.slug}/environments/${environment.slug}`"
            class="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >
            {{ environment.name.toLowerCase() }}
          </Link>
          <span class="text-gray-400 dark:text-gray-600">/</span>
          <span class="font-medium text-gray-900 dark:text-white">quest</span>
        </nav>
      </div>
      <div class="flex items-center space-x-3">
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

        <!-- Loading -->
        <div v-else-if="loading" class="flex items-center justify-center py-12">
          <svg class="h-6 w-6 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        </div>

        <!-- Error -->
        <div v-else-if="error" class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-900/50 dark:bg-red-950/20">
          <p class="text-sm text-red-700 dark:text-red-400">{{ error }}</p>
          <button @click="fetchJobs" class="mt-2 text-sm text-red-600 underline hover:text-red-500 dark:text-red-400">
            Try again
          </button>
        </div>

        <!-- Jobs list -->
        <div v-else-if="jobs.length > 0" class="space-y-4">
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-medium text-gray-900 dark:text-white">Scripts</h2>
            <Tooltip text="Refresh">
              <button
                @click="fetchJobs"
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
                    <span :class="['inline-flex rounded-md px-2 py-0.5 text-xs font-medium', getStatusBadge(job).classes]">
                      {{ getStatusBadge(job).label }}
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

                <div class="flex items-center space-x-2">
                  <!-- Run button -->
                  <button
                    @click="runJob(job.name)"
                    :disabled="runningJob === job.name || job.isRunning"
                    class="rounded-md px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    <span v-if="runningJob === job.name" class="flex items-center space-x-1">
                      <svg class="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      <span>Running...</span>
                    </span>
                    <span v-else class="flex items-center space-x-1">
                      <svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>Run now</span>
                    </span>
                  </button>

                  <!-- Pause/Resume button (only for scheduled jobs) -->
                  <template v-if="job.scheduleType !== 'manual'">
                    <button
                      v-if="job.paused"
                      @click="resumeJob(job.name)"
                      :disabled="pausingJob === job.name"
                      class="rounded-md px-2.5 py-1.5 text-xs font-medium text-green-700 hover:bg-green-50 disabled:opacity-50 dark:text-green-400 dark:hover:bg-green-900/20"
                    >
                      <span class="flex items-center space-x-1">
                        <svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                        </svg>
                        <span>Resume</span>
                      </span>
                    </button>
                    <button
                      v-else
                      @click="pauseJob(job.name)"
                      :disabled="pausingJob === job.name"
                      class="rounded-md px-2.5 py-1.5 text-xs font-medium text-yellow-700 hover:bg-yellow-50 disabled:opacity-50 dark:text-yellow-400 dark:hover:bg-yellow-900/20"
                    >
                      <span class="flex items-center space-x-1">
                        <svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span>Pause</span>
                      </span>
                    </button>
                  </template>
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

        <!-- Job Output Panel -->
        <div v-if="showOutput" class="mt-6">
          <div class="rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
            <div class="flex items-center justify-between bg-gray-50 px-4 py-2 dark:bg-gray-900">
              <div class="flex items-center space-x-2">
                <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {{ runningJob ? `Running: ${runningJob}` : jobOutput?.job ? `Output: ${jobOutput.job}` : 'Output' }}
                </span>
                <span v-if="runningJob" class="flex items-center space-x-1 text-xs text-blue-600 dark:text-blue-400">
                  <svg class="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span>Running...</span>
                </span>
                <span v-else-if="jobOutput?.success" class="text-xs text-green-600 dark:text-green-400">Completed</span>
                <span v-else-if="jobOutput" class="text-xs text-red-600 dark:text-red-400">Failed (exit {{ jobOutput.exitCode }})</span>
              </div>
              <button
                @click="showOutput = false; jobOutput = null"
                class="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
              >
                <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div class="bg-gray-950 p-4 font-mono text-sm text-gray-300 max-h-80 overflow-y-auto">
              <template v-if="runningJob && !jobOutput">
                <div class="flex items-center space-x-2 text-gray-500">
                  <svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span>Executing script...</span>
                </div>
              </template>
              <template v-else-if="jobOutput">
                <pre v-if="jobOutput.output" class="whitespace-pre-wrap text-gray-300">{{ jobOutput.output }}</pre>
                <pre v-if="jobOutput.error" class="whitespace-pre-wrap text-red-400 mt-2">{{ jobOutput.error }}</pre>
                <div v-if="!jobOutput.output && !jobOutput.error" class="text-gray-500">No output</div>
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
