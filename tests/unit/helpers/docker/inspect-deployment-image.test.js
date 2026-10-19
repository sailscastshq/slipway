const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const helper = require('../../../../api/helpers/docker/inspect-deployment-image')
const imageId = 'sha256:' + '1'.repeat(64)
async function fixture(t) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'slipway-recovery-image-')
  )
  const file = path.join(root, 'state.json')
  const binary = path.join(root, 'fake-docker')
  const previous = global.sails
  const state = {
    image: {
      id: imageId,
      os: 'linux',
      architecture: 'amd64',
      labels: { 'io.slipway.rollback.compatibility': 'schema-1' }
    },
    host: { os: 'linux', architecture: 'x86_64' },
    commands: []
  }
  await fs.writeFile(file, JSON.stringify(state))
  await fs.writeFile(
    binary,
    `#!${
      process.execPath
    }\nconst fs=require('node:fs'); const file=${JSON.stringify(
      file
    )}; const state=JSON.parse(fs.readFileSync(file)); const args=process.argv.slice(2);state.commands.push(args);fs.writeFileSync(file,JSON.stringify(state));if(state.missing){console.error('No such image');process.exit(1)};if(args[0]==='image'&&args[1]==='inspect')console.log(JSON.stringify(state.image));else if(args[0]==='info')console.log(JSON.stringify(state.host));else process.exit(2);`
  )
  await fs.chmod(binary, 0o755)
  global.sails = { config: { docker: { binaryPath: binary } } }
  t.after(async () => {
    if (previous === undefined) delete global.sails
    else global.sails = previous
    await fs.rm(root, { recursive: true, force: true })
  })
  return {
    state,
    write: () => fs.writeFile(file, JSON.stringify(state)),
    read: async () => JSON.parse(await fs.readFile(file, 'utf8'))
  }
}
test('local image inspection verifies full immutable identity, declared compatibility and daemon platform without pull', async (t) => {
  const { read } = await fixture(t)
  const artifact = await helper.fn({ imageReference: imageId })
  assert.equal(artifact.imageId, imageId)
  assert.equal(artifact.compatibility, 'schema-1')
  assert.deepEqual(
    (await read()).commands.map((args) => args[0]),
    ['image', 'info']
  )
  assert.equal((await read()).commands[0].at(-1), imageId)
})
for (const failure of ['identity', 'platform', 'missing', 'declaration'])
  test(`invalid local artifact fails before traffic: ${failure}`, async (t) => {
    const { state, write } = await fixture(t)
    if (failure === 'identity') state.image.id = 'sha256:' + '2'.repeat(64)
    if (failure === 'platform') state.image.architecture = 'arm64'
    if (failure === 'missing') state.missing = true
    if (failure === 'declaration')
      state.image.labels['io.slipway.rollback.compatibility'] =
        'bad declaration'
    await write()
    await assert.rejects(helper.fn({ imageReference: imageId }))
  })
