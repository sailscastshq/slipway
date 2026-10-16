<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { Link } from '@inertiajs/vue3'
import { useEventSource } from '@/composables/sse'
import Spinner from '@/components/SlipwaySpinner.vue'
import CheckCircle from '@/components/ui/icons/CheckCircle.vue'
import Clock from '@/components/ui/icons/Clock.vue'
import X from '@/components/ui/icons/X.vue'

const props = defineProps({ backup: { type: Object, required: true } })
const emit = defineEmits(['dismiss', 'status-change'])
const streamUrl = computed(() =>
  props.backup.backupId
    ? `/api/v1/backups/${props.backup.backupId}/stream`
    : null
)
const { close: closeStream, connect } = useEventSource(streamUrl, {
  immediate: false,
  autoReconnect: false,
  onMessage(data) {
    if (!['pending', 'running', 'completed', 'failed'].includes(data.status))
      return
    if (['completed', 'failed'].includes(data.status)) closeStream()
    emit('status-change', {
      status: data.status,
      message:
        data.status === 'failed'
          ? 'Check the service backup logs before retrying.'
          : ''
    })
  },
  onError() {
    closeStream()
    emit('status-change', {
      status: 'interrupted',
      message:
        'Backup status connection interrupted. Refresh to check whether the backup completed before retrying.'
    })
  }
})
watch(
  () => props.backup.backupId,
  (id) => {
    if (id) connect()
  },
  { immediate: true }
)
const elapsed = ref(0)
let timer
const active = computed(() =>
  ['pending', 'running'].includes(props.backup.status)
)
const completed = computed(() => props.backup.status === 'completed')
const label = computed(
  () =>
    ({
      pending: 'Backup queued',
      running: 'Backing up',
      completed: 'Backup completed',
      failed: 'Backup failed',
      interrupted: 'Backup status interrupted'
    }[props.backup.status])
)
const color = computed(() =>
  active.value
    ? 'bg-blue-500'
    : completed.value
    ? 'bg-emerald-500'
    : 'bg-red-500'
)
onMounted(() => {
  const update = () => {
    elapsed.value = Math.floor(
      ((props.backup.completedAt || Date.now()) - props.backup.startedAt) / 1000
    )
  }
  update()
  timer = setInterval(update, 1000)
})
onUnmounted(() => {
  clearInterval(timer)
  closeStream()
})
</script>

<template>
  <div
    data-backup-notification
    :data-backup-status="backup.status"
    aria-live="off"
    class="pointer-events-auto w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-none dark:border-gray-700/50 dark:bg-gray-900"
  >
    <div class="h-0.5 w-full bg-gray-200 dark:bg-gray-800" aria-hidden="true">
      <div
        :class="[
          'h-full w-full transition-colors',
          color,
          active && 'animate-pulse motion-reduce:animate-none'
        ]"
      />
    </div>
    <div class="p-4">
      <p class="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {{ label }} for {{ backup.serviceName }}
      </p>
      <div class="flex items-start gap-3">
        <div
          :class="[
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
            active
              ? 'bg-gray-100 dark:bg-gray-800'
              : completed
              ? 'bg-emerald-500/20'
              : 'bg-red-500/20'
          ]"
        >
          <Spinner v-if="active" class="text-brand h-5 w-5 dark:text-white" />
          <CheckCircle
            v-else-if="completed"
            class="h-5 w-5 text-emerald-400"
            stroke-width="2"
          />
          <X v-else class="h-5 w-5 text-red-400" stroke-width="2" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center justify-between gap-2">
            <p
              :class="[
                'text-sm font-medium',
                active
                  ? 'text-blue-600 dark:text-blue-400'
                  : completed
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-red-600 dark:text-red-400'
              ]"
            >
              {{ label }}
            </p>
            <button
              v-if="!active"
              type="button"
              @click="$emit('dismiss')"
              :aria-label="`Dismiss backup notification for ${backup.serviceName}`"
              class="cursor-pointer rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-950 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-300 dark:focus-visible:ring-white"
            >
              <X class="h-4 w-4" stroke-width="2" />
            </button>
          </div>
          <Link
            :href="backup.href"
            class="mt-0.5 block truncate text-sm font-medium text-gray-900 hover:underline dark:text-white"
            >{{ backup.serviceName }}</Link
          >
          <p class="mt-1 truncate text-xs text-gray-400 dark:text-gray-500">
            {{ backup.projectName }} / {{ backup.environmentName }}
          </p>
          <p
            v-if="backup.message"
            class="mt-1 text-xs text-gray-500 dark:text-gray-400"
          >
            {{ backup.message }}
          </p>
          <p
            class="mt-2 flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400"
          >
            <Clock class="h-3 w-3" stroke-width="2" />{{ elapsed }}s
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
