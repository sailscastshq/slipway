#!/usr/bin/env node
// Run only after upgrade-host-native.sh verifies the complete archive.
const fs = require('node:fs')
const path = require('node:path')
const { createSupervisor } = require('../api/lib/upgrade-process')
const {
  processIdentity,
  sameProcess
} = require('../api/lib/upgrade-writer-observer')
async function supervise(
  input,
  {
    worker = path.join(__dirname, '../api/lib/upgrade-native-worker.js'),
    timeoutMs = 21 * 60 * 1000,
    ndjson = false
  } = {}
) {
  const children = new Map()
  let checkpoint
  const abort = new AbortController()
  const interrupt = () => abort.abort()
  process.once('SIGTERM', interrupt)
  process.once('SIGINT', interrupt)
  let result
  try {
    // Resume already owns a durable checkpoint. Preserve its identity even
    // if the outer deadline interrupts the worker before another IPC event.
    if (input.operation === 'resume') {
      if (
        !fs
          .realpathSync(input.filename)
          .startsWith(fs.realpathSync(input.directory) + path.sep)
      )
        throw Object.assign(new Error('Unbound resume'), {
          code: 'upgradeHostTarget'
        })
      const saved = require('../api/lib/upgrade-host-controller').read(
        input.filename
      )
      if (
        saved.reviewed.instanceId !== input.instanceId ||
        saved.reviewed.reviewHash !== input.approval ||
        saved.reviewed.identity.manifest.image !== input.image
      )
        throw Object.assign(new Error('Unbound resume'), {
          code: 'upgradeHostTarget'
        })
      checkpoint = {
        filename: input.filename,
        id: saved.id,
        instanceId: saved.reviewed.instanceId
      }
    }
    result = await createSupervisor(worker)({
      operation: 'host',
      input,
      timeoutMs,
      signal: abort.signal,
      audit: async (event, owner) => {
        if (event?.event === 'worker') {
          const identity = processIdentity(event.identity.pid)
          const stat = fs
            .readFileSync(`/proc/${identity.pid}/stat`, 'utf8')
            .split(') ')
            .pop()
            .split(' ')
          if (
            identity.start !== event.identity.start ||
            Number(stat[1]) !== owner.workerPid ||
            children.size >= 1000
          )
            throw new Error('Unconfirmed native worker')
          children.set(identity.pid, identity)
        } else if (event?.event === 'checkpoint') {
          const value = event.checkpoint
          if (
            !fs
              .realpathSync(value.filename)
              .startsWith(fs.realpathSync(input.directory) + path.sep)
          )
            throw new Error('Unbound checkpoint')
          require('../api/lib/upgrade-host-controller').read(value.filename)
          checkpoint = value
          if (ndjson)
            process.stdout.write(
              JSON.stringify({ event: 'accepted', ...value }) + '\n'
            )
        } else throw new Error('Unconfirmed native event')
        return true
      }
    })
  } catch (error) {
    result = {
      success: false,
      code: /^upgrade[A-Za-z]+$/.test(error.code || '')
        ? error.code
        : 'upgradeHostRecoveryRequired',
      recoveryRequired: true,
      ...checkpoint
    }
  } finally {
    process.removeListener('SIGTERM', interrupt)
    process.removeListener('SIGINT', interrupt)
    // Register every native worker before it receives work. Wait for native
    // stop after interruption; reused PIDs never authorize a kill.
    for (const identity of children.values()) {
      try {
        if (sameProcess(identity, processIdentity(identity.pid)))
          process.kill(-identity.pid, 'SIGKILL')
      } catch (error) {
        if (!['ENOENT', 'ESRCH'].includes(error.code))
          result = {
            ...result,
            success: false,
            code: 'upgradeWorkerKill',
            recoveryRequired: true
          }
      }
    }
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      let running = false
      for (const identity of children.values()) {
        try {
          if (
            sameProcess(identity, processIdentity(identity.pid)) &&
            fs
              .readFileSync(`/proc/${identity.pid}/stat`, 'utf8')
              .split(') ')
              .pop()[0] !== 'Z'
          )
            running = true
        } catch (error) {
          if (!['ENOENT', 'ESRCH'].includes(error.code)) running = true
        }
      }
      if (!running) return result
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    result = {
      ...result,
      success: false,
      code: 'upgradeWorkerKill',
      recoveryRequired: true
    }
  }
  return result
}
async function main() {
  if (process.platform !== 'linux' || process.getuid() !== 0)
    throw new Error('Host required')
  let bytes = 0,
    chunks = []
  for await (const chunk of process.stdin) {
    bytes += chunk.length
    if (bytes > 1024 * 1024) throw new Error('Input limit')
    chunks.push(chunk)
  }
  const input = JSON.parse(Buffer.concat(chunks).toString())
  const result = await supervise(input, {
    ndjson: process.argv[2] === '--ndjson'
  })
  process.stdout.write(JSON.stringify(result) + '\n')
  if (!result.success || result.recoveryRequired) process.exitCode = 1
}
if (require.main === module)
  main().catch(() => {
    process.stdout.write(
      JSON.stringify({
        success: false,
        code: 'upgradeHostEnvironment',
        recoveryRequired: true
      }) + '\n'
    )
    process.exitCode = 1
  })
module.exports = { supervise }
