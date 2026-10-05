// Disposable CI controller. Calls production host/driver/engine modules from
// the exact built image; no Sails lift or alternative SQL engine in this helper.
const fs = require('node:fs')
const host = require('/app/api/lib/upgrade-host-controller')
const createDriver = require('/app/api/lib/upgrade-host-driver')
const docker = require('/app/api/lib/upgrade-docker-api')()
async function main() {
  const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
  if (require('/app/package.json').version !== '0.0.88')
    throw new Error('Wrong fixture image')
  const current = await docker('GET', `/containers/${input.containerId}/json`)
  const image = await docker(
    'GET',
    `/images/${encodeURIComponent(input.image)}/json`
  )
  if (!image.RepoDigests.includes(input.image))
    throw new Error('Unpinned fixture image')
  const driver = createDriver({
    docker,
    controllerContainer: input.controller,
    hostFileSystem: '/slipway-host',
    directory: input.directory,
    current,
    imageConfig: image.Config,
    imageId: image.Id
  })
  if (input.failHealth) driver.health = async () => ({ ready: false })
  let result
  try {
    result = input.filename
      ? await host.resume({
          filename: input.filename,
          expectedReviewHash: input.approval,
          driver,
          timeoutMs: 180000
        })
      : await host.apply({
          reviewed: input.reviewed,
          approval: input.reviewed.reviewHash,
          directory: input.directory,
          driver,
          timeoutMs: 180000,
          maxBytes: 256 * 1024 * 1024,
          reserveBytes: 128 * 1024 * 1024
        })
    result = { success: true, ...result }
  } catch (error) {
    const probes = {}
    const saved = error.filename ? host.read(error.filename) : null
    for (const [name, filename] of [
      ['hostNamespace', '/slipway-host/proc/1/ns/pid'],
      ['nativeNamespace', '/proc/self/ns/pid'],
      ['nativeInitNamespace', '/proc/1/ns/pid'],
      ['nativeInitMaps', '/proc/1/maps'],
      ['hostData', '/slipway-host' + saved?.reviewed.sourceDirectory]
    ]) {
      try {
        fs.statSync(filename)
        probes[name] = 'readable'
      } catch (nativeError) {
        probes[name] = ['EACCES', 'EPERM', 'ENOENT'].includes(nativeError.code)
          ? nativeError.code
          : 'unconfirmed'
      }
    }
    if (saved && !saved.stage) {
      const observer = require('/app/api/lib/upgrade-writer-observer')
      const self = await docker('GET', `/containers/${input.controller}/json`)
      try {
        await observer.observeWriters({
          databases: host.services(
            saved.reviewed.sourceDirectory,
            saved.reviewed.instanceId
          ),
          controller: observer.processIdentity(process.pid),
          controllerContainer: self.Id,
          hostPidNamespace: fs.readlinkSync('/proc/self/ns/pid'),
          hostFileSystem: '/slipway-host'
        })
        probes.observer = 'readable'
      } catch (nativeError) {
        probes.observer = [
          'EACCES',
          'EPERM',
          'ENOENT',
          'ENOTDIR',
          'upgradeFenceUnproved'
        ].includes(nativeError.code)
          ? nativeError.code
          : nativeError.name === 'TypeError'
          ? 'TypeError'
          : 'unconfirmed'
        if (
          require('/app/api/lib/upgrade-fence-reasons').has(nativeError.reason)
        )
          probes.observerReason = nativeError.reason
      }
    }
    result = {
      success: false,
      code: error.code,
      filename: error.filename,
      probes,
      storageStaged: Boolean(saved?.stage),
      backupsVerified: Boolean(saved?.backupSet),
      receiptsPrepared: Boolean(saved?.handle)
    }
  }
  fs.writeFileSync(input.output, JSON.stringify(result), {
    mode: 0o600,
    flag: 'wx'
  })
}
main().catch(() => {
  process.stderr.write('Disposable full-image controller failed.\n')
  process.exitCode = 1
})
