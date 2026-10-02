import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { effectScope } from 'vue'
import { useHelmScratchpads } from '../assets/js/composables/useHelmScratchpads.js'
import {
  createHelmScratchpad,
  serializeHelmScratchpadState
} from '../assets/js/lib/helmScratchpads.mjs'

// CPU-only input-path benchmark. Storage is an in-memory stand-in, so this does
// not measure browser localStorage I/O, CodeMirror/layout, network, or execution.
// Pass --baseline-ref=<git ref> to compare the real pre-change composable.
const baselineRef = process.argv
  .find((argument) => argument.startsWith('--baseline-ref='))
  ?.slice('--baseline-ref='.length)
const root = fileURLToPath(new URL('../', import.meta.url))
const implementations = [['current', useHelmScratchpads]]
if (baselineRef) {
  let source = execFileSync(
    'git',
    ['show', `${baselineRef}:assets/js/composables/useHelmScratchpads.js`],
    { cwd: root, encoding: 'utf8' }
  )
  source = source
    .replaceAll("from 'vue'", `from '${import.meta.resolve('vue')}'`)
    .replaceAll(
      "from '@/lib/localStorageKeys'",
      `from '${new URL(
        '../assets/js/lib/localStorageKeys.js',
        import.meta.url
      )}'`
    )
    .replaceAll(
      "from '@/lib/helmScratchpads.mjs'",
      `from '${new URL(
        '../assets/js/lib/helmScratchpads.mjs',
        import.meta.url
      )}'`
    )
    .replace(/from '(\.\.\/lib\/[^']+)'/g, (_, path) => {
      const url = pathToFileURL(`${root}assets/js/composables/${path}`)
      return `from '${url}'`
    })
  const baseline = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
  )
  implementations.unshift([baselineRef, baseline.useHelmScratchpads])
}

const target = {
  project: { id: 'fixture', name: 'Fixture', slug: 'fixture' },
  environment: { id: 'staging', name: 'Staging', slug: 'staging' },
  app: { id: 'web', name: 'Web', slug: 'web' }
}
const edits = 100
const samples = 7
const results = []
for (const { tabs, sourceBytes } of [
  { tabs: 4, sourceBytes: 4 * 1024 },
  { tabs: 20, sourceBytes: 64 * 1024 }
]) {
  const fixtureSource = '// Local safe performance fixture\n'
    .repeat(Math.ceil(sourceBytes / 34))
    .slice(0, sourceBytes - 8)
  const fixtureTabs = Array.from({ length: tabs }, (_, index) =>
    createHelmScratchpad({
      id: `tab-${index}`,
      source: fixtureSource,
      target,
      now: 1
    })
  )
  const initialState = serializeHelmScratchpadState({
    tabs: fixtureTabs,
    activeByTarget: { [fixtureTabs[0].target.key]: 'tab-0' }
  })
  for (const [label, useWorkspace] of implementations) {
    const inputTimes = []
    const burstTimes = []
    const flushTimes = []
    let writesDuringInput = 0
    let writesAfterFlush = 0
    for (let sample = -1; sample < samples; sample++) {
      let stored = initialState
      let writes = 0
      globalThis.window = new EventTarget()
      globalThis.document = new EventTarget()
      document.visibilityState = 'visible'
      window.localStorage = {
        getItem: () => stored,
        setItem: (_, value) => {
          writes++
          stored = value
        }
      }
      const scope = effectScope()
      const workspace = scope.run(() => useWorkspace(target))
      writes = 0
      const burstStart = performance.now()
      for (let edit = 0; edit < edits; edit++) {
        const start = performance.now()
        workspace.code.value = `${fixtureSource}\n// ${edit}`
        if (sample >= 0) inputTimes.push(performance.now() - start)
      }
      const burstDuration = performance.now() - burstStart
      writesDuringInput = writes
      const flushStart = performance.now()
      window.dispatchEvent(new Event('pagehide'))
      scope.stop()
      const flushDuration = performance.now() - flushStart
      writesAfterFlush = writes
      assert.equal(
        JSON.parse(stored).tabs[0].source,
        `${fixtureSource}\n// ${edits - 1}`
      )
      if (sample >= 0) {
        burstTimes.push(burstDuration)
        flushTimes.push(flushDuration)
      }
    }
    const percentile = (values, fraction) => {
      const sorted = [...values].sort((left, right) => left - right)
      return Number(
        sorted[Math.floor((sorted.length - 1) * fraction)].toFixed(3)
      )
    }
    results.push({
      implementation: label,
      tabs,
      sourceBytes,
      serializedBytes: Buffer.byteLength(initialState),
      inputP50Ms: percentile(inputTimes, 0.5),
      inputP95Ms: percentile(inputTimes, 0.95),
      burstP50Ms: percentile(burstTimes, 0.5),
      flushP50Ms: percentile(flushTimes, 0.5),
      writesDuringInput,
      writesAfterFlush
    })
  }
}
delete globalThis.window
delete globalThis.document
console.log(
  JSON.stringify({ node: process.version, samples, edits, results }, null, 2)
)
