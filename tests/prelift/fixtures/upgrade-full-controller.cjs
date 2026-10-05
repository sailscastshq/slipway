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
    result = { success: false, code: error.code, filename: error.filename }
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
