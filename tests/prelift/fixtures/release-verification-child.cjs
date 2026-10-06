const fs = require('node:fs')
const path = require('node:path')
const { performance } = require('node:perf_hooks')

const [mode, root] = process.argv.slice(2)
if (mode === 'lock') {
  const db = new (require('better-sqlite3'))(root, { fileMustExist: true })
  db.exec('BEGIN IMMEDIATE')
  process.stdout.write('ready\n')
  process.stdin.once('data', () => {
    db.exec('ROLLBACK')
    db.close()
    process.exit(0)
  })
} else if (mode === 'sample') {
  const started = performance.now()
  const baseline = new Map()
  let previous = started
  let samples = 0
  let maxGapMs = 0
  const peak = { logical: 0, allocated: 0 }
  const liveJournalPeak = { logical: 0, allocated: 0 }
  const categories = {}
  function files(directory, output = []) {
    let entries
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true })
    } catch (error) {
      if (error.code === 'ENOENT') return output
      throw error
    }
    for (const entry of entries) {
      const name = path.join(directory, entry.name)
      if (entry.isDirectory()) files(name, output)
      else if (entry.isFile()) output.push(name)
      if (output.length > 1000) throw new Error('Fixture file bound exceeded')
    }
    return output
  }
  function read(name) {
    try {
      const stat = fs.statSync(name)
      return { logical: stat.size, allocated: stat.blocks * 512 }
    } catch (error) {
      if (error.code === 'ENOENT') return null
      throw error
    }
  }
  for (const name of files(root)) baseline.set(name, read(name))
  function sample() {
    const now = performance.now()
    maxGapMs = Math.max(maxGapMs, now - previous)
    previous = now
    samples++
    const totals = { logical: 0, allocated: 0 }
    const groups = {}
    const liveJournals = { logical: 0, allocated: 0 }
    for (const name of files(root)) {
      const current = read(name)
      if (!current) continue
      const before = baseline.get(name) || { logical: 0, allocated: 0 }
      const category = /-(journal|wal|shm)$/.test(name)
        ? 'journals'
        : name.includes(`${path.sep}migration-backups${path.sep}`)
        ? name.startsWith(path.join(root, 'live') + path.sep)
          ? 'backups'
          : 'validationBackups'
        : name.includes(`${path.sep}temporary${path.sep}`)
        ? 'clones'
        : 'liveGrowth'
      groups[category] ||= { logical: 0, allocated: 0 }
      for (const metric of ['logical', 'allocated']) {
        const additional = Math.max(0, current[metric] - before[metric])
        totals[metric] += additional
        groups[category][metric] += additional
        if (
          category === 'journals' &&
          name.startsWith(path.join(root, 'live') + path.sep)
        )
          liveJournals[metric] += additional
      }
    }
    for (const metric of ['logical', 'allocated']) {
      peak[metric] = Math.max(peak[metric], totals[metric])
      liveJournalPeak[metric] = Math.max(
        liveJournalPeak[metric],
        liveJournals[metric]
      )
    }
    for (const [category, values] of Object.entries(groups)) {
      categories[category] ||= { logical: 0, allocated: 0 }
      for (const metric of ['logical', 'allocated'])
        categories[category][metric] = Math.max(
          categories[category][metric],
          values[metric]
        )
    }
  }
  sample()
  const interval = setInterval(sample, 2)
  const deadline = setTimeout(() => {
    throw new Error('Disk sampler exceeded its 20-second fixture bound')
  }, 20000)
  process.stdout.write('ready\n')
  process.stdin.once('data', () => {
    sample()
    clearInterval(interval)
    clearTimeout(deadline)
    process.stdout.write(
      JSON.stringify({
        baseline: [...baseline.values()].reduce(
          (sum, value) => ({
            logical: sum.logical + value.logical,
            allocated: sum.allocated + value.allocated
          }),
          { logical: 0, allocated: 0 }
        ),
        samples,
        maxGapMs,
        elapsedMs: performance.now() - started,
        peak,
        liveJournalPeak,
        categories
      }) + '\n'
    )
    process.exit(0)
  })
} else throw new Error('Unknown fixture mode')
