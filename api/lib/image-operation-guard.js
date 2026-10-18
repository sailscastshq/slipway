const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

// All participants share the instance db volume, including console children.
// Admission is serialized briefly; deployment readers may then run concurrently.
// Crashes leave conservative holds. Never expire a potentially live owner's hold.
async function acquire(appPath, mode = 'use') {
  const root = path.join(appPath, 'db', 'image-operation-guard')
  await fs.mkdir(root, { recursive: true, mode: 0o700 })
  const admission = path.join(root, 'admission')
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.mkdir(admission)
      break
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      if (attempt >= 100) throw busy()
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
  let marker
  try {
    const entries = await fs.readdir(root)
    if (
      entries.includes('cleanup') ||
      (mode === 'cleanup' && entries.some((name) => name.startsWith('use-')))
    )
      throw busy()
    marker = path.join(
      root,
      mode === 'cleanup' ? 'cleanup' : `use-${randomUUID()}`
    )
    await fs.writeFile(
      marker,
      JSON.stringify({ pid: process.pid, startedAt: Date.now() }),
      { flag: 'wx', mode: 0o600 }
    )
  } finally {
    await fs.rmdir(admission)
  }
  return async () => {
    await fs.unlink(marker)
  }
}
function busy() {
  return Object.assign(
    new Error(
      'Image operations are busy; retry after deployment or maintenance completes.'
    ),
    { code: 'E_IMAGE_OPERATIONS_BUSY' }
  )
}
function guard(fn) {
  return async function (...args) {
    const release = await acquire(sails.config.appPath)
    try {
      return await fn.apply(this, args)
    } finally {
      await release()
    }
  }
}
module.exports = { acquire, guard }
