// Synthetic matched log counting; no Docker, network, private data or app lift.
const { spawnSync } = require('node:child_process')
const { performance } = require('node:perf_hooks')
const os = require('node:os')
if (process.argv[2] === '--sample') {
  const count =
    process.argv[3] === 'before'
      ? (value) => value.split('\n').filter((line) => line.trim()).length
      : require('../api/lib/count-log-lines')
  const lines = Number(process.argv[4])
  const width = Number(process.argv[5])
  const input = ('synthetic log '.padEnd(width - 1, 'x') + '\n').repeat(lines)
  count('warmup\n')
  Buffer.byteLength(input)
  global.gc()
  const startHeap = process.memoryUsage().heapUsed
  const startCpu = process.cpuUsage()
  const start = performance.now()
  let observed
  for (let i = 0; i < 10; i++) observed = count(input)
  const elapsedMs = performance.now() - start
  const cpu = process.cpuUsage(startCpu)
  const heapAfter = process.memoryUsage().heapUsed
  const maxRSSKiB = process.resourceUsage().maxRSS
  global.gc()
  console.log(
    JSON.stringify({
      lines,
      width,
      inputBytes: Buffer.byteLength(input),
      observed,
      iterations: 10,
      elapsedMs,
      cpuMs: (cpu.user + cpu.system) / 1000,
      heapAfterBytes: heapAfter - startHeap,
      maxRSSKiB,
      retainedHeapDeltaBytes: process.memoryUsage().heapUsed - startHeap
    })
  )
} else {
  const samples = []
  for (const [lines, width] of [
    [100, 120],
    [89146, 60],
    [89146, 116]
  ]) {
    for (let pair = 0; pair < 7; pair++) {
      for (const variant of pair % 2
        ? ['after', 'before']
        : ['before', 'after']) {
        const p = spawnSync(
          process.execPath,
          [
            '--expose-gc',
            __filename,
            '--sample',
            variant,
            String(lines),
            String(width)
          ],
          { encoding: 'utf8' }
        )
        if (p.status !== 0) throw Error(p.stderr)
        samples.push({ pair, variant, ...JSON.parse(p.stdout) })
      }
    }
  }
  console.log(
    JSON.stringify(
      {
        runtime: process.version,
        platform: process.platform,
        arch: process.arch,
        cpus: os.cpus().length,
        methodology:
          '7 alternating paired isolated child processes per fixture; 10 count operations per process; exact same synthetic input and expected count; observed production burst line count 89146, widths synthetic; heapAfter is allocation pressure at return, not peak/live heap; maxRSS is process lifetime peak incl Node/fixture; excludes Docker/redaction/SQLite/HTTP; not evidence of SIGBUS or OOM resolution',
        samples
      },
      null,
      2
    )
  )
}
