const { test } = require('node:test')
const assert = require('node:assert/strict')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { randomUUID } = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const command = promisify(execFile)
const helper = require('../../api/helpers/docker/inspect-deployment-image')

test('real Docker native inspection accepts an unlabelled image and preserves a declared compatibility label', async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'slipway-image-inspect-')
  )
  const previous = global.sails
  const owned = []
  const scope = randomUUID()
  const docker = (args) =>
    command('docker', args, { timeout: 30000, maxBuffer: 1024 * 1024 })
  try {
    const rootfs = path.join(root, 'rootfs')
    await fs.mkdir(rootfs)
    await fs.writeFile(path.join(rootfs, 'fixture'), scope)
    const archive = path.join(root, 'rootfs.tar')
    await command('tar', ['-cf', archive, '-C', rootfs, '.'])
    global.sails = { config: { docker: { binaryPath: 'docker' } } }
    for (const declared of [false, true]) {
      const reference = `slipway/image-inspection-${scope}:${declared ? 2 : 1}`
      const args = ['image', 'import', '--change', 'CMD ["/fixture"]']
      if (declared)
        args.push(
          '--change',
          'LABEL io.slipway.rollback.compatibility=schema-1'
        )
      args.push(archive, reference)
      const { stdout } = await docker(args)
      const id = stdout.trim()
      assert.match(id, /^sha256:[a-f0-9]{64}$/)
      owned.push({ reference, id })
      const { stdout: native } = await docker(['image', 'inspect', reference])
      const [image] = JSON.parse(native)
      assert.equal(image.Id, id)
      assert.ok(image.Config && typeof image.Config === 'object')
      if (!declared) assert.equal(image.Config.Labels == null, true)
      const artifact = await helper.fn({ imageReference: reference })
      assert.equal(artifact.imageId, id)
      assert.equal(artifact.compatibility, declared ? 'schema-1' : null)
      assert.equal((await helper.fn({ imageReference: id })).imageId, id)
    }
  } finally {
    global.sails = previous
    for (const { reference, id } of owned.reverse()) {
      const { stdout } = await docker([
        'image',
        'inspect',
        '--format',
        '{{.Id}}',
        reference
      ])
      assert.equal(stdout.trim(), id, 'Fixture image ownership changed')
      // Exact fixture tag, no force and no prune; preserve unrelated images.
      await docker(['image', 'rm', reference])
    }
    await fs.rm(root, { recursive: true, force: true })
  }
})
