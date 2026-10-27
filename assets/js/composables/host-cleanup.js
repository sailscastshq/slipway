import { inject, provide, ref, onBeforeUnmount, onMounted } from 'vue'
import { router } from '@inertiajs/vue3'
const KEY = Symbol('host-cleanup')
const STORAGE = 'slipway-host-cleanup-run'
const active = (run) =>
  ['requested', 'running', 'cancelling'].includes(run?.state)
export function createHostCleanup(toast, isAdmin) {
  const run = ref(null),
    progress = ref(null),
    error = ref(''),
    refreshing = ref(false)
  const dismissed = new Set()
  let timer,
    polling = false,
    stopped = false,
    controller
  const id = (value) => `host-cleanup-${value.runId}`
  function show() {
    if (!run.value || dismissed.has(run.value.runId)) return
    const requestId = run.value.runId
    toast({
      id: id(run.value),
      kind: 'host-cleanup',
      cleanup: {
        run: run.value,
        progress: progress.value,
        error: error.value,
        refreshing: refreshing.value,
        onDismiss: () => dismissed.add(requestId)
      },
      class:
        'block overflow-visible bg-transparent p-0 shadow-none ring-0 dark:bg-transparent',
      duration: false
    })
  }
  function remember(value) {
    try {
      if (active(value)) sessionStorage.setItem(STORAGE, value.runId)
      else sessionStorage.removeItem(STORAGE)
    } catch {
      /* Server state remains authoritative. */
    }
  }
  function connect(value, currentProgress = null, notify = false) {
    if (!value) return
    if (
      run.value?.runId === value.runId &&
      value.updatedAt < run.value.updatedAt
    )
      return
    if (run.value?.runId !== value.runId && run.value)
      toast.dismiss(id(run.value))
    const sameRun = run.value?.runId === value.runId
    run.value = value
    progress.value =
      currentProgress &&
      (!sameRun ||
        !progress.value ||
        currentProgress.updatedAt >= progress.value.updatedAt)
        ? currentProgress
        : active(value) && sameRun
        ? progress.value
        : null
    remember(value)
    if (notify || active(value)) show()
    clearInterval(timer)
    if (active(value))
      timer = setInterval(() => {
        if (!document.hidden) poll()
      }, 2000)
  }
  async function poll(requestId = run.value?.runId, notify = true) {
    if (polling || stopped || !requestId || !isAdmin.value) return
    polling = true
    controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    try {
      const response = await fetch(`/api/v1/bosun/quest/runs/${requestId}`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' }
      })
      if (!response.ok)
        throw new Error(
          'Progress could not be refreshed. The cleanup may still be running; reopen Infrastructure to reconnect.'
        )
      const value = await response.json()
      if (value.run?.jobName !== 'retain-build-cache')
        throw new Error('This run is not a disk cleanup request.')
      if (stopped) return
      error.value = ''
      const wasActive = active(run.value)
      connect(value.run, value.cleanupProgress, notify)
      if (wasActive && !active(value.run)) {
        refreshing.value = true
        show()
        router.reload({
          only: ['hostDisk'],
          onFinish: () => {
            refreshing.value = false
            show()
          }
        })
      }
    } catch (failure) {
      if (!stopped) {
        error.value = failure.message
        show()
      }
    } finally {
      clearTimeout(timeout)
      polling = false
    }
  }
  onMounted(() => {
    if (!isAdmin.value) return
    let stored
    try {
      stored = sessionStorage.getItem(STORAGE)
    } catch {}
    if (/^[a-f0-9-]{36}$/.test(stored || '')) poll(stored)
  })
  onBeforeUnmount(() => {
    stopped = true
    clearInterval(timer)
    controller?.abort()
  })
  const value = { run, progress, error, connect, poll }
  provide(KEY, value)
  return value
}
export function useHostCleanup() {
  return inject(KEY)
}
