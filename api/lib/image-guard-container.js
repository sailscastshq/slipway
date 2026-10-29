const fs = require('node:fs/promises')
const { execFile } = require('node:child_process')
const command = require('node:util').promisify(execFile)

// Only immutable IDs on the verified local daemon are ownership evidence.
// No listing, cleanup, host mounts or diagnostic containers are needed.
function create({ read = fs.readFile, run = command } = {}) {
  const format =
    '{"id":{{json .Id}},"startedAt":{{json .State.StartedAt}},"running":{{json .State.Running}},"restarting":{{json .State.Restarting}},"paused":{{json .State.Paused}},"pid":{{json .State.Pid}},"status":{{json .State.Status}},"pidMode":{{json .HostConfig.PidMode}}}'
  async function docker(args) {
    return (
      await run(global.sails?.config?.docker?.binaryPath || 'docker', args, {
        timeout: 2000,
        maxBuffer: 16384
      })
    ).stdout.trim()
  }
  async function inspect(id) {
    return JSON.parse(
      await docker(['inspect', '--type', 'container', '--format', format, id])
    )
  }
  const valid = (owner) =>
    /^[a-f0-9]{64}$/.test(owner?.id || '') &&
    /^[a-zA-Z0-9:-]{12,128}$/.test(owner?.daemonId || '') &&
    typeof owner?.startedAt === 'string' &&
    Number.isFinite(Date.parse(owner.startedAt))
  const validReceipt = (receipt) =>
    /^[a-f0-9]{64}$/.test(receipt?.id || '') &&
    typeof receipt.running === 'boolean' &&
    typeof receipt.paused === 'boolean' &&
    typeof receipt.restarting === 'boolean' &&
    Number.isSafeInteger(receipt.pid) &&
    receipt.pid >= 0 &&
    typeof receipt.status === 'string' &&
    receipt.pidMode === ''
  async function processIdentity(id, pid) {
    if (!Number.isSafeInteger(pid) || pid < 1)
      throw new Error('Invalid owner PID')
    // The PID is validated before interpolation; no shell is involved.
    const source = `const f=require('node:fs');let ticks=null;try{const s=f.readFileSync('/proc/${pid}/stat','utf8');ticks=s.slice(s.lastIndexOf(')')+2).trim().split(/\\s+/)[19]}catch(e){if(e.code!=='ENOENT')throw e}console.log(JSON.stringify({bootId:f.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim(),namespace:f.readlinkSync('/proc/self/ns/pid'),startTicks:ticks}))`
    return JSON.parse(await docker(['exec', id, 'node', '-e', source]))
  }
  async function identify(identity, pid) {
    try {
      if (!identity || !Number.isSafeInteger(pid) || pid < 1) return null
      const hostname = (await read('/etc/hostname', 'utf8')).trim()
      if (!/^[a-f0-9]{12,64}$/.test(hostname)) return null
      const receipt = await inspect(hostname)
      const daemonId = await docker(['info', '--format', '{{.ID}}'])
      const owner = { id: receipt.id, startedAt: receipt.startedAt, daemonId }
      if (
        !valid(owner) ||
        !validReceipt(receipt) ||
        !receipt.id.startsWith(hostname) ||
        !receipt.running ||
        receipt.restarting ||
        receipt.paused ||
        receipt.pidMode !== ''
      )
        return null
      const proof = await processIdentity(receipt.id, pid)
      if (
        proof.bootId !== identity.bootId ||
        proof.namespace !== identity.namespace ||
        proof.startTicks !== identity.startTicks
      )
        return null
      return owner
    } catch {
      return null
    }
  }
  async function state(record, current) {
    const owner = record.owner?.container
    if (
      !valid(owner) ||
      !valid(current?.container) ||
      owner.daemonId !== current.container.daemonId
    )
      return 'unknown'
    const verified = async (value) =>
      (await docker(['info', '--format', '{{.ID}}'])) === owner.daemonId
        ? value
        : 'unknown'
    try {
      // Recheck daemon identity even if the current process identity was cached.
      if ((await docker(['info', '--format', '{{.ID}}'])) !== owner.daemonId)
        return 'unknown'
      let receipt
      try {
        receipt = await inspect(owner.id)
      } catch (error) {
        return error.code === 1 &&
          String(error.stdout || '').trim() === '' &&
          [
            `Error: No such container: ${owner.id}`,
            `Error response from daemon: No such container: ${owner.id}`
          ].includes(String(error.stderr || '').trim())
          ? await verified('dead')
          : 'unknown'
      }
      if (!validReceipt(receipt) || receipt.id !== owner.id) return 'unknown'
      if (receipt.restarting) return 'unknown'
      if (
        !receipt.running &&
        receipt.pid === 0 &&
        ['exited', 'dead'].includes(receipt.status)
      )
        return await verified('dead')
      if (!receipt.running || receipt.paused) return 'unknown'
      if (!Number.isSafeInteger(receipt.pid) || receipt.pid < 1)
        return 'unknown'
      if (!Number.isFinite(Date.parse(receipt.startedAt))) return 'unknown'
      if (receipt.startedAt !== owner.startedAt) return await verified('dead')
      const proof = await processIdentity(owner.id, record.pid)
      const after = await inspect(owner.id)
      if (JSON.stringify(after) !== JSON.stringify(receipt)) return 'unknown'
      if (
        proof.bootId !== record.owner.bootId ||
        proof.namespace !== record.owner.namespace
      )
        return 'unknown'
      if (proof.startTicks === null) return await verified('dead')
      if (!/^[0-9]+$/.test(proof.startTicks || '')) return 'unknown'
      return await verified(
        proof.startTicks === record.owner.startTicks ? 'live' : 'dead'
      )
    } catch {
      return 'unknown'
    }
  }
  return { identify, state, valid }
}

module.exports = { ...create(), _private: { create } }
