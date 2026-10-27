<script setup>
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { usePage } from '@inertiajs/vue3'
import Button from '@/components/ui/button/Button.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import Spinner from '@/components/SlipwaySpinner.vue'
import { useHostCleanup } from '@/composables/host-cleanup'

const page = usePage()
const admin = computed(() => page.props.loggedInUser?.isGenesisUser === true)
const review = ref(null)
const show = ref(false)
const loading = ref(false)
const submitting = ref(false)
const error = ref('')
const cleanup = useHostCleanup()
const { run, progress } = cleanup
const requestId = ref('')
let controller
let stopped = false
const active = computed(() =>
  ['requested', 'running', 'cancelling'].includes(run.value?.state)
)
const outcome = computed(() =>
  run.value?.result?.status === 'available' ? run.value.result.value : null
)
const canPrune = computed(
  () =>
    review.value?.available &&
    !loading.value &&
    !submitting.value &&
    !active.value &&
    !error.value
)
const bytes = (value) => {
  if (!Number.isFinite(value)) return 'Not measured'
  const absolute = Math.abs(value)
  if (absolute < 1024) return `${value} B`
  const unit = Math.min(Math.floor(Math.log(absolute) / Math.log(1024)), 4)
  return `${(value / 1024 ** unit).toFixed(1)} ${
    ['B', 'KiB', 'MiB', 'GiB', 'TiB'][unit]
  }`
}
const status = computed(() => {
  if (active.value)
    return run.value.state === 'requested'
      ? 'Cleanup requested…'
      : {
          checking: 'Checking maintenance and cache policy…',
          pruning: 'Pruning unused cache…',
          refreshing: 'Refreshing disk measurements…'
        }[progress.value?.phase] || 'Checking cleanup progress…'
  if (outcome.value?.status === 'complete') {
    const delta = outcome.value.filesystemAvailableDeltaBytes
    return `Cleanup complete · ${delta >= 0 ? '+' : ''}${bytes(
      delta
    )} available on disk`
  }
  if (outcome.value?.status === 'held')
    return 'Cleanup held · another operation needs to finish'
  if (outcome.value?.status === 'dry-run')
    return 'Preview complete · no cache removed'
  if (
    ['unconfirmed', 'interrupted'].includes(run.value?.state) ||
    progress.value?.phase === 'unconfirmed' ||
    outcome.value?.status === 'unconfirmed'
  )
    return 'Cleanup outcome unknown · inspect the daemon before retrying'
  if (run.value?.state === 'failed')
    return 'Cleanup failed · review the result before retrying'
  return 'Remove unused cache while keeping deployment images and volumes.'
})
async function readReview() {
  controller?.abort()
  controller = new AbortController()
  const response = await fetch('/api/v1/bosun/disk-cleanup', {
    signal: controller.signal,
    headers: { Accept: 'application/json' }
  })
  if (!response.ok) throw new Error('Could not review disk cleanup. Try again.')
  const value = await response.json()
  if (stopped) return
  review.value = value
  if (value.run) cleanup.connect(value.run, value.cleanupProgress)
}
async function ask() {
  show.value = true
  error.value = ''
  loading.value = true
  try {
    await readReview()
    if (
      !requestId.value ||
      (run.value && !active.value && run.value.runId === requestId.value)
    )
      requestId.value = crypto.randomUUID()
  } catch (failure) {
    if (!stopped) error.value = failure.message
  } finally {
    loading.value = false
  }
}
async function prune() {
  if (!canPrune.value) return
  submitting.value = true
  error.value = ''
  try {
    const response = await fetch('/api/v1/bosun/quest/run', {
      method: 'POST',
      signal: AbortSignal.timeout(30000),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-CSRF-Token': page.props._csrf || ''
      },
      body: JSON.stringify({
        name: 'retain-build-cache',
        requestId: requestId.value,
        jobInputs: {}
      })
    })
    const value = await response.json()
    if (!response.ok)
      throw new Error(value.error || 'Cleanup could not be started.')
    cleanup.connect({ ...value.run, runId: value.run.id }, null, true)
    show.value = false
    await cleanup.poll()
  } catch (failure) {
    error.value = `${failure.message} Refresh the review before retrying; the same request will not run twice.`
  } finally {
    submitting.value = false
  }
}
onMounted(async () => {
  if (!admin.value) return
  try {
    await readReview()
  } catch {
    /* The review button offers a retry. */
  }
  const selected = new URLSearchParams(window.location.search).get('cleanup')
  if (/^[a-f0-9-]{36}$/.test(selected || '')) {
    await cleanup.poll(selected)
    show.value = true
    requestId.value = crypto.randomUUID()
  }
})
onBeforeUnmount(() => {
  stopped = true
  controller?.abort()
})
</script>

<template>
  <div
    v-if="admin"
    data-test="host-disk-prune"
    class="mt-4 flex items-center justify-between gap-4 border-t border-gray-100 pt-4 dark:border-gray-800"
  >
    <div class="min-w-0">
      <p class="text-sm font-medium text-gray-900 dark:text-white">
        Build cache
      </p>
      <p role="status" class="mt-1 text-xs text-gray-500 dark:text-gray-400">
        {{ status }}
      </p>
      <p
        v-if="error && !show"
        role="alert"
        class="mt-1 text-xs text-red-600 dark:text-red-400"
      >
        {{ error }}
      </p>
    </div>
    <Button
      :disabled="submitting || loading"
      class="shrink-0 rounded-lg border border-gray-200 bg-transparent px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-transparent dark:text-gray-200 dark:hover:bg-gray-800"
      @click="ask"
    >
      <span v-if="active" class="flex items-center gap-2"
        ><Spinner class="size-4" />View progress</span
      >
      <span v-else>Prune</span>
    </Button>
    <ConfirmModal
      :show="show"
      title="Prune unused build cache?"
      message="Deployment images, rollback images, containers and volumes stay intact. Future builds may need to rebuild discarded cache."
      confirm-label="Prune cache"
      :confirm-disabled="!canPrune"
      :loading="submitting"
      @confirm="prune"
      @cancel="show = false"
    >
      <template #form>
        <p v-if="loading" role="status" class="mt-5 text-sm text-gray-500">
          Checking cache and current work…
        </p>
        <div v-else-if="review" class="mt-5 space-y-4">
          <dl
            class="grid grid-cols-2 gap-4 border-y border-gray-100 py-4 dark:border-gray-800"
          >
            <div>
              <dt class="text-xs text-gray-500 dark:text-gray-400">
                Docker reclaimable
              </dt>
              <dd
                class="mt-1 text-base font-semibold text-gray-900 dark:text-white"
              >
                {{ review.cache?.reclaimable || 'Unavailable' }}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-gray-500 dark:text-gray-400">
                Retained target
              </dt>
              <dd
                class="mt-1 text-base font-semibold text-gray-900 dark:text-white"
              >
                {{ bytes(review.policy.keepStorageBytes) }}
              </dd>
            </div>
          </dl>
          <p class="text-sm text-gray-500 dark:text-gray-400">
            Unused for at least
            {{ review.policy.minimumUnusedHours / 24 }} days. Docker’s estimate
            includes cache outside this policy; actual disk savings can differ.
          </p>
          <p
            v-for="hold in review.holds"
            :key="hold"
            class="text-sm text-amber-700 dark:text-amber-400"
          >
            {{ hold }}
          </p>
          <div
            v-if="run"
            class="space-y-2 text-sm text-gray-600 dark:text-gray-300"
          >
            <p>{{ status }}</p>
            <p v-if="outcome?.dockerReportedReclaimed">
              Docker reported {{ outcome.dockerReportedReclaimed }} reclaimed.
            </p>
            <p
              v-if="outcome?.status === 'complete'"
              class="text-xs text-gray-500"
            >
              Disk change is the measured net availability, including concurrent
              activity.
            </p>
            <p v-if="run.error" class="text-red-600 dark:text-red-400">
              {{ run.error }}
            </p>
          </div>
        </div>
        <p
          v-if="error"
          role="alert"
          class="mt-4 text-sm text-red-600 dark:text-red-400"
        >
          {{ error }}
        </p>
      </template>
    </ConfirmModal>
  </div>
</template>
