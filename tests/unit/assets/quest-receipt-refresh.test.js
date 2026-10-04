const assert = require('node:assert/strict')
const fs = require('node:fs')
const Vue = require('vue')
const { test } = require('sounding')

const summary = (runId = 'older-receipt', updatedAt = 100) => ({
  runId,
  state: 'completed',
  finishedAt: 90,
  resultStatus: 'available',
  updatedAt
})
const flush = async () => {
  await Vue.nextTick()
  await new Promise((resolve) => setImmediate(resolve))
  await Vue.nextTick()
}

function fixture(fetch) {
  const source = fs.readFileSync(
    require.resolve('../../../assets/js/pages/projects/quest.vue'),
    'utf8'
  )
  const start = source.indexOf('const selectedReceiptSummary = ref(null)')
  const end = source.indexOf('const selectedRunJob = computed(', start)
  assert.ok(start > 0 && end > start)
  const context = {
    computed: Vue.computed,
    ref: Vue.ref,
    watch: Vue.watch,
    fetch,
    live: Vue.ref({
      observedAt: 1000,
      target: { appId: 'app-1', runtimeId: 'runtime-1' },
      runs: Array.from({ length: 25 }, (_, i) => summary(`recent-${i}`))
    }),
    fresh: Vue.ref(true),
    apiUrl: Vue.ref('/fixture/quest'),
    selectedRunId: Vue.ref('older-receipt'),
    observedRunIds: Vue.ref(new Set()),
    selectedHistoryKey: Vue.ref('history-1'),
    scopedJobHistory: Vue.ref({ key: 'history-1', runs: [summary()] })
  }
  context.observedRunIds.value = new Set(
    context.live.value.runs.map((run) => run.runId)
  )
  const cleanup = []
  context.onBeforeUnmount = (callback) => cleanup.push(callback)
  const scope = Vue.effectScope()
  const view = scope.run(() =>
    new Function(
      'context',
      `const { ${Object.keys(context).join(', ')} } = context;\n` +
        source.slice(start, end) +
        '\nreturn { selectedSummary, detailRevision };'
    )(context)
  )
  return {
    ...context,
    ...view,
    stop() {
      cleanup.forEach((callback) => callback())
      scope.stop()
    }
  }
}

test('Quest historical receipt summary refresh changes detail revision only when retained evidence changes', async () => {
  const requests = []
  let updatedAt = 100
  let fail = false
  const view = fixture(async (url) => {
    requests.push(url)
    if (fail) throw new Error('Synthetic transient summary failure')
    return {
      ok: true,
      json: async () => ({ run: summary('older-receipt', updatedAt) })
    }
  })
  try {
    await flush()
    const before = view.detailRevision.value
    assert.equal(view.selectedSummary.value.runId, 'older-receipt')
    assert.equal(requests.length, 1)
    updatedAt = 101
    view.live.value.observedAt = 2000
    await flush()
    assert.notEqual(view.detailRevision.value, before)
    const enriched = view.detailRevision.value
    view.live.value.observedAt = 3000
    await flush()
    assert.equal(view.detailRevision.value, enriched)
    assert.equal(requests.length, 3)
    view.observedRunIds.value = new Set(view.observedRunIds.value)
    await flush()
    assert.equal(requests.length, 3, 'Same shared observation is not re-read')
    fail = true
    view.live.value.observedAt = 4000
    await flush()
    assert.equal(view.detailRevision.value, enriched)
    assert.equal(view.selectedSummary.value.updatedAt, 101)
    view.fresh.value = false
    view.live.value.observedAt = 5000
    await flush()
    assert.equal(requests.length, 4, 'Stale snapshots cannot trigger reads')
    assert.ok(
      requests.every(
        (url) => url === '/fixture/quest/runs/older-receipt?summaryOnly=true'
      )
    )
  } finally {
    view.stop()
  }
})

test('Quest selected summary reads remain single-flight and discard selection/environment/unmount races', async () => {
  const requests = []
  const view = fixture(
    (url, options) =>
      new Promise((resolve) =>
        requests.push({ url, signal: options.signal, resolve })
      )
  )
  try {
    assert.equal(requests.length, 1)
    view.live.value.observedAt = 2000
    await flush()
    assert.equal(requests.length, 1, 'A slow summary read is single-flight')
    view.selectedRunId.value = 'different-receipt'
    await flush()
    assert.equal(requests[0].signal.aborted, true)
    assert.equal(requests.length, 2)
    requests[0].resolve({ ok: true, json: async () => ({ run: summary() }) })
    await flush()
    assert.equal(view.selectedSummary.value ?? null, null)
    view.apiUrl.value = '/different-environment/quest'
    await flush()
    assert.equal(requests[1].signal.aborted, true)
    assert.equal(requests.length, 3)
    requests[1].resolve({
      ok: true,
      json: async () => ({ run: summary('different-receipt', 999) })
    })
    await flush()
    assert.equal(view.selectedSummary.value ?? null, null)
    requests[2].resolve({
      ok: true,
      json: async () => ({ run: summary('different-receipt', 102) })
    })
    await flush()
    assert.equal(view.selectedSummary.value.updatedAt, 102)
    view.live.value.observedAt = 3000
    await flush()
    assert.equal(requests.length, 4)
    view.stop()
    assert.equal(requests[3].signal.aborted, true)
  } finally {
    view.stop()
  }
})

test('Quest shared-page selection uses its revision without a per-viewer summary request', async () => {
  const requests = []
  const view = fixture(async (url) => {
    requests.push(url)
    return { ok: true, json: async () => ({ run: summary() }) }
  })
  try {
    await flush()
    view.selectedRunId.value = 'recent-0'
    await flush()
    assert.equal(requests.length, 1)
    const before = view.detailRevision.value
    view.live.value.runs[0].updatedAt = 101
    view.live.value.observedAt = 2000
    await flush()
    assert.notEqual(view.detailRevision.value, before)
    assert.equal(requests.length, 1)
  } finally {
    view.stop()
  }
})

test('Quest successful evidence refresh invalidates inactive cached logs and fetches active logs once while failures preserve evidence', async () => {
  const helpers = await import('../../../assets/js/lib/questWorkspace.mjs')
  const source = fs.readFileSync(
    require.resolve('../../../assets/js/components/quest/QuestRunDetail.vue'),
    'utf8'
  )
  const script = source
    .slice(source.indexOf('<script setup>') + 14, source.indexOf('</script>'))
    .replace(/import[\s\S]*?from\s+['"][^'"]+['"]\s*/g, '')
  const props = Vue.reactive({
    apiUrl: '/fixture/quest',
    runId: 'older-receipt',
    revision: '100'
  })
  let updatedAt = 100
  let failed = false
  let logReads = 0
  const cleanup = []
  const context = {
    ...helpers,
    computed: Vue.computed,
    ref: Vue.ref,
    watch: Vue.watch,
    defineProps: () => props,
    defineEmits: () => () => {},
    onBeforeUnmount: (callback) => cleanup.push(callback),
    async fetch(url) {
      if (url.endsWith('/logs')) {
        logReads++
        return {
          ok: true,
          json: async () => ({
            available: true,
            stdout: `logs-${updatedAt}`,
            stderr: ''
          })
        }
      }
      return {
        ok: !failed,
        status: failed ? 503 : 200,
        json: async () => ({ run: summary('older-receipt', updatedAt) })
      }
    }
  }
  const scope = Vue.effectScope()
  const view = scope.run(() =>
    new Function(
      'context',
      `const { ${Object.keys(context).join(', ')} } = context;\n` +
        script +
        '\nreturn { run, logs, tab, error };'
    )(context)
  )
  try {
    await flush()
    view.tab.value = 'logs'
    await flush()
    assert.equal(view.logs.value.stdout, 'logs-100')
    assert.equal(logReads, 1)
    view.tab.value = 'inputs'
    updatedAt = 101
    props.revision = '101'
    await flush()
    assert.equal(view.run.value.updatedAt, 101)
    assert.equal(view.logs.value, null)
    assert.equal(
      logReads,
      1,
      'Inactive logs remain lazy after cache invalidation'
    )
    view.tab.value = 'logs'
    await flush()
    assert.equal(view.logs.value.stdout, 'logs-101')
    assert.equal(logReads, 2)
    updatedAt = 102
    props.revision = '102'
    await flush()
    assert.equal(view.logs.value.stdout, 'logs-102')
    assert.equal(
      logReads,
      3,
      'An active Logs tab reloads once per successful revision'
    )
    failed = true
    props.revision = '103'
    await flush()
    assert.equal(view.run.value.updatedAt, 102)
    assert.equal(view.logs.value.stdout, 'logs-102')
    assert.equal(logReads, 3)
    assert.match(view.error.value, /503/)
  } finally {
    cleanup.forEach((callback) => callback())
    scope.stop()
  }
})
