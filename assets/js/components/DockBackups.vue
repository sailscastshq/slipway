<script setup>
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { useToast } from '@/composables/toast'
import {
  assertMutationResponse,
  mutationFailureMessage
} from '@/lib/mutation-feedback'
import Button from '@/components/ui/button/Button.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import Spinner from '@/components/SlipwaySpinner.vue'
import CheckCircle from '@/components/ui/icons/CheckCircle.vue'
import Refresh from '@/components/ui/icons/Refresh.vue'
import Database from '@/components/ui/icons/Database.vue'
const props = defineProps({ service: Object, canManage: Boolean })
const toast = useToast()
const backups = ref([])
const selectedId = ref(
  Number(new URLSearchParams(location.search).get('backup')) || null
)
const selected = computed(() =>
  backups.value.find((b) => b.id === selectedId.value)
)
const test = computed(() => selected.value?.restoreTest)
const busy = computed(() => ['queued', 'running'].includes(test.value?.status))
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const hasMore = ref(false)
const cursor = ref(null)
const supported = ref(false)
const limits = ref({})
const confirm = ref(false)
const testingAllowed = computed(
  () =>
    props.canManage &&
    supported.value &&
    selected.value?.status === 'completed' &&
    selected.value.sizeBytes > 0 &&
    selected.value.sizeBytes <= limits.value.maxBytes &&
    !busy.value &&
    !test.value?.cleanupPending
)
let timer,
  disposed = false,
  fetching = false
const abort = new AbortController()
const labels = {
  queued: 'Queued',
  backup: 'Creating backup',
  preparing: 'Preparing database',
  download: 'Checking backup',
  import: 'Restoring database',
  verifying: 'Verifying data',
  cleanup: 'Cleaning up',
  completed: 'Restore verified',
  failed: 'Test failed',
  cancelled: 'Cancelled',
  interrupted: 'Interrupted',
  cleanup_pending: 'Cleanup needs attention'
}
const steps = ['preparing', 'download', 'import', 'verifying', 'cleanup']
const date = (value) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
      })
    : 'Not recorded'
const bytes = (value) =>
  value
    ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(
        value / (1024 * 1024)
      ) + ' MB'
    : '—'
const confirmationMessage = computed(
  () =>
    `${
      selected.value
        ? 'Restore backup #' + selected.value.id
        : 'Create a backup and restore it'
    } into a temporary PostgreSQL database. Your running database stays unchanged. The test uses up to ${bytes(
      limits.value.memoryBytes
    )} memory and ${bytes(
      limits.value.dataBytes
    )} temporary database space; it will be removed afterward.`
)
function select(id) {
  selectedId.value = id
  const url = new URL(location.href)
  url.searchParams.set('backup', id)
  history.replaceState(null, '', url)
}
async function load(more = false) {
  if (fetching || disposed) return
  fetching = true
  clearTimeout(timer)
  try {
    const query = new URLSearchParams()
    if (more && cursor.value) query.set('before', cursor.value)
    if (selectedId.value) query.set('selectedBackupId', selectedId.value)
    const response = await fetch(
      `/api/v1/services/${props.service.id}/backups?${query}`,
      { signal: abort.signal }
    )
    await assertMutationResponse(response)
    const data = await response.json()
    if (disposed) return
    const previous = new Map(backups.value.map((b) => [b.id, b]))
    for (const b of data.backups) {
      const prior = previous.get(b.id)?.restoreTest
      if (
        prior &&
        ['queued', 'running'].includes(prior.status) &&
        b.restoreTest &&
        !['queued', 'running'].includes(b.restoreTest.status)
      ) {
        toast.dismiss(`restore-test-${b.restoreTest.id}-queued`)
        toast({
          id: `restore-test-${b.restoreTest.id}-result`,
          type:
            b.restoreTest.status === 'completed' &&
            !b.restoreTest.cleanupPending
              ? 'success'
              : 'error',
          message: b.restoreTest.cleanupPending
            ? 'Restore test finished; temporary database cleanup needs attention.'
            : b.restoreTest.status === 'completed'
            ? 'Backup restoration verified'
            : b.restoreTest.error || 'Restore test cancelled'
        })
      }
      previous.set(b.id, b)
    }
    backups.value = [...previous.values()].sort((a, b) => b.id - a.id)
    if (more || !cursor.value) {
      hasMore.value = data.hasMore
      cursor.value = data.nextCursor
    }
    supported.value = data.testSupported
    limits.value = data.testLimits
    error.value = ''
    if (!selected.value && backups.value.length) select(backups.value[0].id)
  } catch (cause) {
    if (!disposed) error.value = mutationFailureMessage(cause)
  } finally {
    fetching = false
    loading.value = false
    if (
      !disposed &&
      backups.value.some(
        (b) =>
          ['pending', 'running'].includes(b.status) ||
          ['queued', 'running'].includes(b.restoreTest?.status)
      )
    )
      timer = setTimeout(() => load(), 3000)
  }
}
async function start() {
  if (saving.value) return
  if (!selected.value) return createBackup()
  if (!testingAllowed.value) return
  saving.value = true
  try {
    const response = await fetch(
      `/api/v1/backups/${selected.value.id}/test-restore`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      }
    )
    await assertMutationResponse(response)
    const data = await response.json()
    selected.value.restoreTest = data.test
    confirm.value = false
    toast({
      id: `restore-test-${data.test.id}-queued`,
      message: 'Restore test queued. Your running database stays unchanged.',
      type: 'info'
    })
    await load()
  } catch (cause) {
    toast({ message: mutationFailureMessage(cause), type: 'error' })
  } finally {
    saving.value = false
  }
}
async function action(name) {
  if (saving.value || !test.value) return
  saving.value = true
  try {
    const response = await fetch(
      `/api/v1/restore-tests/${test.value.id}/action`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: name })
      }
    )
    await assertMutationResponse(response)
    toast({
      message:
        name === 'cancel'
          ? 'Cancellation requested. Checking cleanup…'
          : 'Temporary database removed.',
      type: 'info'
    })
    await load()
  } catch (cause) {
    toast({ message: mutationFailureMessage(cause), type: 'error' })
  } finally {
    saving.value = false
  }
}
async function createBackup() {
  if (saving.value || !props.canManage || !supported.value) return
  saving.value = true
  try {
    const response = await fetch(
      `/api/v1/services/${props.service.id}/backups/test-restore`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      }
    )
    await assertMutationResponse(response)
    const data = await response.json()
    select(data.test.backup)
    confirm.value = false
    toast({
      id: `restore-test-${data.test.id}-queued`,
      message:
        'Backup and restore test queued. You can leave this page while it runs.',
      type: 'info'
    })
    await load()
  } catch (cause) {
    toast({ message: mutationFailureMessage(cause), type: 'error' })
  } finally {
    saving.value = false
  }
}

function syncSelection() {
  selectedId.value =
    Number(new URLSearchParams(location.search).get('backup')) || null
  load()
}
onMounted(() => {
  load()
  window.addEventListener('popstate', syncSelection)
})
onBeforeUnmount(() => {
  disposed = true
  abort.abort()
  clearTimeout(timer)
  window.removeEventListener('popstate', syncSelection)
})
</script>

<template>
  <section
    aria-label="Backup history"
    class="min-h-0 flex-1 overflow-y-auto px-4 py-8 text-gray-900 dark:text-gray-100 sm:px-8"
  >
    <div class="mx-auto max-w-5xl">
      <div class="mb-8 flex items-start justify-between gap-4">
        <div>
          <h2 class="text-lg font-semibold">Backups</h2>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Recovery starts with a backup you can trust.
          </p>
        </div>
        <Button
          aria-label="Refresh backups"
          :disabled="loading"
          class="min-h-0 min-w-0 bg-transparent p-1.5 text-gray-500 hover:bg-gray-100 dark:bg-transparent dark:text-gray-400 dark:hover:bg-gray-800"
          @click="load()"
          ><Refresh class="h-4 w-4"
        /></Button>
      </div>
      <p
        v-if="error"
        role="alert"
        class="mb-6 text-sm text-red-600 dark:text-red-400"
      >
        {{ error }}
        <button class="ml-2 underline" @click="load()">Refresh status</button>
      </p>
      <p
        v-if="loading"
        role="status"
        class="flex items-center gap-2 text-sm text-gray-500"
      >
        <Spinner class="h-4 w-4" />Loading backups…
      </p>
      <div v-else-if="!backups.length" class="py-12 text-center">
        <Database class="mx-auto h-8 w-8 text-gray-300 dark:text-gray-600" />
        <h3 class="mt-4 font-medium">No backups yet</h3>
        <p class="mx-auto mt-2 max-w-sm text-sm text-gray-500">
          {{
            service.status === 'running'
              ? 'Create a backup, then verify it restores into a temporary database.'
              : 'Start this database to create its first backup. Saved backups can be tested while the database is stopped.'
          }}
        </p>
        <Button
          v-if="canManage && supported"
          :disabled="saving || service.status !== 'running'"
          class="mt-5 min-h-0 px-3 py-2"
          @click="confirm = true"
          >{{ saving ? 'Queuing…' : 'Back up and test restore' }}</Button
        >
      </div>
      <div
        v-else
        class="grid gap-8 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-12"
      >
        <div>
          <p class="mb-3 text-xs font-medium text-gray-400">
            {{ service.name }} · {{ backups.length }} loaded
          </p>
          <ul class="space-y-1" aria-label="Saved backups">
            <li v-for="backup in backups" :key="backup.id">
              <button
                :aria-current="selectedId === backup.id ? 'true' : undefined"
                class="w-full rounded-lg px-3 py-3 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-900"
                :class="
                  selectedId === backup.id ? 'bg-gray-50 dark:bg-gray-900' : ''
                "
                @click="select(backup.id)"
              >
                <span class="block text-sm font-medium">{{
                  date(backup.createdAt)
                }}</span>
                <span class="mt-1 block text-xs text-gray-500"
                  >{{ bytes(backup.sizeBytes) }} ·
                  {{
                    backup.type === 'scheduled' ? 'Automatic' : 'Manual'
                  }}</span
                >
                <span
                  class="mt-2 flex items-center gap-1.5 text-xs"
                  :class="
                    backup.restoreTest?.status === 'completed' &&
                    !backup.restoreTest.cleanupPending
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-gray-500'
                  "
                >
                  <CheckCircle
                    v-if="
                      backup.restoreTest?.status === 'completed' &&
                      !backup.restoreTest.cleanupPending
                    "
                    class="h-3.5 w-3.5"
                  />{{
                    backup.status !== 'completed'
                      ? backup.status === 'failed'
                        ? 'Backup failed'
                        : 'Backing up…'
                      : backup.restoreTest
                      ? labels[backup.restoreTest.stage] ||
                        labels[backup.restoreTest.status]
                      : 'Not tested'
                  }}
                </span>
              </button>
            </li>
          </ul>
          <button
            v-if="hasMore"
            class="mt-3 px-3 py-2 text-xs font-medium text-gray-500 hover:text-gray-900 dark:hover:text-white"
            @click="load(true)"
          >
            Load older backups
          </button>
        </div>
        <div v-if="selected" class="min-w-0" aria-label="Selected backup">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p class="text-xs font-medium text-gray-400">
                Backup #{{ selected.id }}
              </p>
              <h3 class="mt-1 text-base font-semibold">
                {{ date(selected.createdAt) }}
              </h3>
            </div>
            <Button
              v-if="testingAllowed"
              class="min-h-0 min-w-0 bg-transparent px-1.5 py-1 text-xs text-gray-600 hover:bg-gray-100 dark:bg-transparent dark:text-gray-300 dark:hover:bg-gray-800"
              @click="confirm = true"
              >{{ test ? 'Test again' : 'Test restore' }}</Button
            >
          </div>
          <dl class="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
            <div>
              <dt class="text-xs text-gray-500">Size</dt>
              <dd class="mt-1">{{ bytes(selected.sizeBytes) }}</dd>
            </div>
            <div>
              <dt class="text-xs text-gray-500">Database</dt>
              <dd class="mt-1">
                {{
                  service.type === 'postgresql' ? 'PostgreSQL' : service.type
                }}
              </dd>
            </div>
            <div class="col-span-2">
              <dt class="text-xs text-gray-500">Storage</dt>
              <dd class="mt-1 truncate">
                {{ selected.storage?.container || 'Original backup storage' }}
              </dd>
            </div>
          </dl>
          <p v-if="!supported" class="mt-8 text-sm text-gray-500">
            Restore testing currently supports managed PostgreSQL. Test other
            backups in a separately provisioned recovery database.
          </p>
          <p
            v-else-if="selected.status !== 'completed' && !test"
            class="mt-8 text-sm text-gray-500"
          >
            {{
              selected.status === 'failed'
                ? 'This backup failed. Create a new backup before testing recovery.'
                : 'Wait for this backup to complete before testing restoration.'
            }}
          </p>
          <p
            v-else-if="
              !selected.sizeBytes || selected.sizeBytes > limits.maxBytes
            "
            class="mt-8 text-sm text-gray-500"
          >
            This backup cannot use the bounded test target ({{
              bytes(limits.maxBytes)
            }}
            download limit). Use a separately provisioned recovery database.
          </p>
          <p
            v-else-if="!test"
            class="mt-8 max-w-md text-sm leading-6 text-gray-500"
          >
            Not tested yet. Restore this backup into a temporary database and
            check its data. Your running database stays unchanged.
          </p>
          <div v-if="test" class="mt-8" aria-live="polite">
            <div class="flex items-center gap-2">
              <Spinner v-if="busy" class="h-4 w-4 text-gray-400" /><CheckCircle
                v-else-if="test.status === 'completed'"
                class="h-5 w-5 text-emerald-500"
              />
              <h4 class="font-medium">
                {{
                  test.status === 'completed' && test.cleanupPending
                    ? 'Restore passed; cleanup needs attention'
                    : labels[test.stage] || labels[test.status]
                }}
              </h4>
            </div>
            <p v-if="test.completedAt" class="mt-1 text-xs text-gray-400">
              {{ date(test.completedAt) }} · Test #{{ test.id }}
            </p>
            <ol v-if="busy" class="mt-5 space-y-3 text-sm text-gray-500">
              <li
                v-for="step in steps"
                :key="step"
                class="flex items-center gap-2"
                :class="
                  step === test.stage
                    ? 'font-medium text-gray-900 dark:text-white'
                    : ''
                "
              >
                <span
                  class="h-1.5 w-1.5 rounded-full"
                  :class="
                    step === test.stage
                      ? 'bg-gray-700 dark:bg-gray-300'
                      : 'bg-gray-200 dark:bg-gray-700'
                  "
                />{{ labels[step] }}
              </li>
            </ol>
            <p
              v-if="test.error"
              class="mt-4 text-sm leading-6 text-red-600 dark:text-red-400"
            >
              {{ test.error }}
            </p>
            <ul
              v-if="test.report?.checks?.length"
              class="mt-5 space-y-2 text-sm text-gray-600 dark:text-gray-300"
            >
              <li
                v-for="check in test.report.checks"
                :key="check"
                class="flex items-start gap-2"
              >
                <CheckCircle class="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />{{
                  check
                }}
              </li>
            </ul>
            <p
              v-if="test.report?.serverVersion"
              class="mt-4 text-xs text-gray-500"
            >
              Tested with PostgreSQL {{ test.report.serverVersion }}
            </p>
            <p
              v-if="test.report?.compatibility"
              class="mt-2 text-xs text-gray-500"
            >
              {{ test.report.compatibility }}
            </p>
            <p
              v-if="test.report?.cleanup === 'removed'"
              class="mt-2 text-xs text-gray-500"
            >
              Temporary database removed.
            </p>
            <div class="mt-4 flex gap-4">
              <button
                v-if="busy && canManage"
                :disabled="saving"
                class="text-xs font-medium text-gray-500 disabled:opacity-50"
                @click="action('cancel')"
              >
                Cancel test</button
              ><button
                v-if="test.cleanupPending && !busy && canManage"
                :disabled="saving"
                class="text-xs font-medium text-gray-700 disabled:opacity-50 dark:text-gray-300"
                @click="action('cleanup')"
              >
                {{ saving ? 'Cleaning up…' : 'Retry cleanup' }}
              </button>
            </div>
          </div>
          <p class="mt-8 max-w-md text-xs leading-5 text-gray-400">
            A restore test checks this backup’s database recovery. It does not
            run your app or prove complete disaster recovery.
          </p>
        </div>
      </div>
    </div>
    <ConfirmModal
      :show="confirm"
      title="Test backup restoration"
      :message="confirmationMessage"
      confirm-label="Start test"
      :loading="saving"
      @confirm="start"
      @cancel="confirm = false"
    />
  </section>
</template>
