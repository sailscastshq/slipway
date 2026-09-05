const fs = require('node:fs')
const fsp = fs.promises
const path = require('node:path')
const os = require('node:os')
const { randomUUID } = require('node:crypto')
const { Transform } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const { createGunzip } = require('node:zlib')
const tar = require('tar-stream')

const MiB = 1024 * 1024
function segment(value) {
  if (!/^[a-zA-Z0-9_-]+$/.test(String(value)))
    throw new Error('Invalid source identifier')
  return String(value)
}
function revisionPath(root, project, revision) {
  if (!/^[a-f0-9-]{36}$/.test(revision))
    throw new Error('Invalid source revision')
  return path.join(root, '.sources', segment(project.slug), revision)
}

// Fail closed across processes, rather than allowing concurrent publishers.
// A crash leaves a lock for operator recovery; never steal a lock from a slow writer.
async function withSourceLock(root, project, callback) {
  const dir = path.join(root, '.source-locks')
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 })
  const lock = path.join(dir, segment(project.slug))
  try {
    await fsp.mkdir(lock, { mode: 0o700 })
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    const busy = new Error(
      'Source is busy. Retry after the current operation finishes; inspect a stale source lock after an interrupted process.'
    )
    busy.code = 'SOURCE_BUSY'
    throw busy
  }
  try {
    return await callback()
  } finally {
    await fsp.rm(lock, { recursive: true, force: true })
  }
}

async function extractArchive(
  archive,
  destination,
  { maxBytes = 1024 * MiB, maxEntries = 20000, timeoutMs = 60000, signal } = {}
) {
  const stat = await fsp.statfs(path.dirname(destination))
  const available = stat.bavail * stat.bsize - 256 * MiB
  // Publication temporarily needs a second copy for the mutable content workspace.
  const budget = Math.min(maxBytes, Math.floor(available / 2))
  if (budget <= 0) throw new Error('Insufficient free disk space for source')
  await fsp.mkdir(destination, { recursive: true, mode: 0o700 })
  const deadline = AbortSignal.timeout(timeoutMs)
  const abort = signal ? AbortSignal.any([signal, deadline]) : deadline
  let bytes = 0,
    entries = 0,
    files = 0
  const expanded = new Transform({
    transform(chunk, encoding, next) {
      bytes += chunk.length
      next(
        bytes > budget
          ? new Error('Expanded source exceeds disk budget')
          : null,
        chunk
      )
    }
  })
  const extractor = tar.extract()
  extractor.on('entry', (header, stream, next) => {
    ;(async () => {
      if (++entries > maxEntries)
        throw new Error('Source contains too many entries')
      const name = header.name.replace(/^\.\//, '')
      if (
        name.includes('\\') ||
        path.posix.isAbsolute(name) ||
        name.split('/').includes('..') ||
        name.includes('\0')
      )
        throw new Error('Unsafe archive path')
      if (!['file', 'directory'].includes(header.type))
        throw new Error(
          'Source archives may contain only regular files and directories'
        )
      const target = path.resolve(destination, name)
      if (
        target !== path.resolve(destination) &&
        !target.startsWith(path.resolve(destination) + path.sep)
      )
        throw new Error('Unsafe archive path')
      if (header.type === 'directory') {
        await fsp.mkdir(target, { recursive: true, mode: 0o755 })
        stream.resume()
      } else {
        if (header.size > budget)
          throw new Error('Source file exceeds disk budget')
        await fsp.mkdir(path.dirname(target), { recursive: true, mode: 0o755 })
        await pipeline(
          stream,
          fs.createWriteStream(target, {
            flags: 'wx',
            mode: header.mode & 0o111 ? 0o755 : 0o644
          }),
          { signal: abort }
        )
        files++
      }
    })().then(
      () => next(),
      (error) => extractor.destroy(error)
    )
  })
  await pipeline(
    fs.createReadStream(archive),
    createGunzip(),
    expanded,
    extractor,
    { signal: abort }
  )
  if (!files) throw new Error('Source archive is empty')
  return { bytes, entries }
}

async function publishArchive({ root, project, archive, limits, signal }) {
  await fsp.mkdir(root, { recursive: true })
  return withSourceLock(root, project, async () => {
    const retained = path.join(root, '.sources', segment(project.slug))
    await fsp.mkdir(retained, { recursive: true, mode: 0o700 })
    const active =
      typeof Deployment !== 'undefined'
        ? await Deployment.find({
            sourceRevision: { '!=': null },
            status: { in: ['pending', 'building', 'pushing', 'deploying'] }
          })
        : []
    const protectedIds = new Set(active.map((item) => item.sourceRevision))
    for (const name of await fsp.readdir(retained)) {
      const item = path.join(retained, name)
      const info = await fsp.stat(item)
      if (
        Date.now() - info.mtimeMs > 24 * 60 * 60 * 1000 &&
        !protectedIds.has(name)
      )
        await fsp.rm(item, { recursive: true, force: true })
    }
    if ((await fsp.readdir(retained)).length >= 20)
      throw new Error(
        'Project source retention limit reached; retry after unused revisions expire'
      )
    const revision = randomUUID()
    const source = revisionPath(root, project, revision)
    await fsp.mkdir(path.dirname(source), { recursive: true, mode: 0o700 })
    const staging = path.join(root, `.source-stage-${revision}`)
    const previous = path.join(root, `.source-previous-${revision}`)
    const target = path.join(root, segment(project.slug))
    let moved = false,
      published = false
    try {
      const stats = await extractArchive(archive, source, { ...limits, signal })
      await fsp.cp(source, staging, {
        recursive: true,
        errorOnExist: true,
        force: false
      })
      try {
        await fsp.rename(target, previous)
        moved = true
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
      try {
        await fsp.rename(staging, target)
        published = true
      } catch (error) {
        if (moved) await fsp.rename(previous, target)
        throw error
      }
      return { revision, target, ...stats }
    } finally {
      await fsp.rm(staging, { recursive: true, force: true })
      if (published) await fsp.rm(previous, { recursive: true, force: true })
      else await fsp.rm(source, { recursive: true, force: true })
    }
  })
}

async function snapshot({
  root,
  project,
  deploymentId,
  sourceRevision,
  signal
}) {
  return withSourceLock(root, project, async () => {
    signal?.throwIfAborted()
    const source = sourceRevision
      ? revisionPath(root, project, sourceRevision)
      : path.join(root, segment(project.slug))
    const parent = path.join(
      os.tmpdir(),
      'slipway',
      'deployments',
      segment(deploymentId)
    )
    await fsp.mkdir(parent, { recursive: true, mode: 0o700 })
    const target = await fsp.mkdtemp(path.join(parent, 'source-'))
    try {
      await fsp.cp(source, target, { recursive: true, verbatimSymlinks: true })
      signal?.throwIfAborted()
      return target
    } catch (error) {
      await fsp.rm(target, { recursive: true, force: true })
      throw error
    }
  })
}
module.exports = {
  extractArchive,
  publishArchive,
  snapshot,
  revisionPath,
  withSourceLock
}
