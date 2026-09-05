const { test } = require('sounding')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const operations = require('../../../api/lib/source-operations')
const workspace = require('../../../api/lib/source-workspace')

test(
  'slow source work leaves HTTP health responsive, records completion and cancellation',
  {
    transport: 'http',
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'async-source' } }
    }
  },
  async ({ sails, world, request, expect }) => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), 'source-operation-test-')
    )
    const oldRoot = sails.config.custom.slipwayAppsDir,
      original = workspace.publishArchive
    const file = path.join(root, 'upload.tgz')
    const project = world.current.projects.deploymentTarget
    let release
    const held = new Promise((resolve) => {
      release = resolve
    })
    let entered = false
    sails.config.custom.slipwayAppsDir = root
    workspace.publishArchive = async ({ signal }) => {
      entered = true
      await held
      signal.throwIfAborted()
      return { revision: '11111111-1111-1111-1111-111111111111', target: root }
    }
    try {
      await fs.writeFile(file, 'test upload')
      const first = await operations.enqueue({
        project,
        userId: world.current.users.genesisUser.id,
        archive: file
      })
      for (let i = 0; i < 100 && !entered; i++)
        await new Promise((resolve) => setTimeout(resolve, 10))
      expect(entered).toBe(true)
      const start = Date.now()
      expect(await request.get('/health')).toHaveStatus(200)
      expect(Date.now() - start < 1000).toBe(true)
      expect(
        (await sails.models.sourceoperation.findOne({ id: first.id })).status
      ).toBe('running')
      const second = await operations.enqueue({
        project,
        userId: world.current.users.genesisUser.id,
        archive: file
      })
      let code
      try {
        await operations.enqueue({
          project,
          userId: world.current.users.genesisUser.id,
          archive: file
        })
      } catch (error) {
        code = error.code
      }
      expect(code).toBe('SOURCE_BUSY')
      expect((await operations.cancel(second.id)).status).toBe('cancelled')
      release()
      let finished
      for (let i = 0; i < 100; i++) {
        finished = await sails.models.sourceoperation.findOne({ id: first.id })
        if (finished.status === 'completed') break
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      expect(finished.status).toBe('completed')
      expect(finished.sourceRevision).toBe(
        '11111111-1111-1111-1111-111111111111'
      )
    } finally {
      release()
      await new Promise((resolve) => setTimeout(resolve, 100))
      workspace.publishArchive = original
      sails.config.custom.slipwayAppsDir = oldRoot
      await fs.rm(root, { recursive: true, force: true })
    }
  }
)

test(
  'protocol 2 HTTP upload returns a trackable revision and rejects corrupt replacement safely',
  {
    transport: 'http',
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'source-http-upload' } }
    }
  },
  async ({ sails, world, request, expect }) => {
    const crypto = require('node:crypto'),
      tar = require('tar-stream'),
      zlib = require('node:zlib')
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'source-http-'))
    const oldRoot = sails.config.custom.slipwayAppsDir
    sails.config.custom.slipwayAppsDir = root
    const raw = crypto.randomBytes(32).toString('hex')
    await sails.models.clitoken.create({
      user: world.current.users.genesisUser.id,
      token: crypto.createHash('sha256').update(raw).digest('hex')
    })
    const sender = request.withHeaders({
      authorization: `Bearer sl_${raw}`,
      'x-slipway-source-protocol': '2'
    })
    const project = world.current.projects.deploymentTarget
    try {
      const pack = tar.pack(),
        chunks = []
      const collecting = (async () => {
        for await (const chunk of pack) chunks.push(chunk)
      })()
      pack.entry({ name: 'app.js' }, 'original source')
      pack.finalize()
      await collecting
      async function submit(bytes) {
        const form = new FormData()
        form.append('source', new Blob([bytes]), 'source.tar.gz')
        const result = await sender.post(
          `/api/v1/projects/${project.slug}/push`,
          form
        )
        expect(result).toHaveStatus(202)
        let op
        for (let i = 0; i < 200; i++) {
          op = (
            await sender.get(
              `/api/v1/source-operations/${result.data.operation.id}`
            )
          ).data.operation
          if (!['queued', 'running'].includes(op.status)) return op
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
        throw new Error('Source operation did not finish')
      }
      const completed = await submit(zlib.gzipSync(Buffer.concat(chunks)))
      expect(completed.status).toBe('completed')
      expect(completed.sourceRevision.length).toBe(36)
      expect((await submit(Buffer.from('invalid archive'))).status).toBe(
        'failed'
      )
      expect(
        await fs.readFile(path.join(root, project.slug, 'app.js'), 'utf8')
      ).toBe('original source')
    } finally {
      await new Promise((resolve) => setTimeout(resolve, 100))
      sails.config.custom.slipwayAppsDir = oldRoot
      await fs.rm(root, { recursive: true, force: true })
    }
  }
)
