import { effectScope } from '../node_modules/vue/index.mjs'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
// Deterministic lifecycle work counter; this does not measure CPU or RAM.
// Usage: node scripts/measure-hidden-lookout.mjs [baseline-git-ref]
const gitRef = process.argv[2]
const source = gitRef
  ? execFileSync('git', ['show', `${gitRef}:assets/js/composables/sse.js`], {
      encoding: 'utf8',
      cwd: new URL('..', import.meta.url)
    })
  : readFileSync(
      new URL('../assets/js/composables/sse.js', import.meta.url),
      'utf8'
    )
const vueUrl = new URL('../node_modules/vue/index.mjs', import.meta.url).href
const moduleSource = source.replace("from 'vue'", `from '${vueUrl}'`)
const { useEventSource } = await import(
  `data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`
)
const documentEvents = new EventTarget()
documentEvents.hidden = false
globalThis.document = documentEvents
globalThis.window = new EventTarget()
const sources = []
globalThis.EventSource = class {
  constructor(url) {
    this.url = url
    sources.push(this)
  }
  close() {
    this.closed = true
  }
}
const scope = effectScope()
let messages = 0
scope.run(() =>
  useEventSource('/lookout/stream', {
    pauseWhenHidden: true,
    onMessage() {
      messages++
    }
  })
)
const active = () => sources.filter((source) => !source.closed)
const visibleConnections = active().length
documentEvents.hidden = true
documentEvents.dispatchEvent(new Event('visibilitychange'))
const hiddenConnections = active().length
// Four normal metric publication cycles during two hidden minutes.
for (let tick = 0; tick < 4; tick++) {
  for (const source of active())
    source.onmessage({
      data: JSON.stringify({ metrics: [{ cpuPercent: tick }] })
    })
}
documentEvents.hidden = false
documentEvents.dispatchEvent(new Event('visibilitychange'))
const resumedConnections = active().length
scope.stop()
console.log(
  JSON.stringify(
    {
      visibleConnections,
      hiddenConnections,
      hiddenMetricCallbacks: messages,
      resumedConnections,
      connectionsAfterUnmount: active().length
    },
    null,
    2
  )
)
