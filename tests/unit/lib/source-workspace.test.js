const { test } = require('sounding')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const tar = require('tar-stream')
const { gzipSync } = require('node:zlib')
const {
  publishArchive,
  snapshot,
  withSourceLock
} = require('../../../api/lib/source-workspace')
async function archive(file, entries) {
  const pack = tar.pack(),
    chunks = []
  const done = (async () => {
    for await (const chunk of pack) chunks.push(chunk)
  })()
  for (const [name, text, type = 'file'] of entries)
    pack.entry(
      { name, type, linkname: type === 'symlink' ? '/tmp' : undefined },
      type === 'file' ? text : undefined
    )
  pack.finalize()
  await done
  await fs.writeFile(file, gzipSync(Buffer.concat(chunks)))
}
test('invalid, unsafe, and oversized uploads preserve source; builds pin immutable revisions', async ({
  expect
}) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'source-test-'))
  const project = { slug: 'example' },
    file = path.join(root, 'upload.tgz')
  let build
  try {
    await fs.mkdir(path.join(root, 'example'))
    await fs.writeFile(path.join(root, 'example', 'app.js'), 'original')
    for (const input of [
      null,
      [['../escape', 'bad']],
      [['link', '', 'symlink']],
      [['app.js', 'x'.repeat(5000)]]
    ]) {
      if (input) await archive(file, input)
      else await fs.writeFile(file, 'not gzip')
      let failed = false
      try {
        await publishArchive({
          root,
          project,
          archive: file,
          limits: { maxBytes: 4096 }
        })
      } catch {
        failed = true
      }
      expect(failed).toBe(true)
      expect(
        await fs.readFile(path.join(root, 'example', 'app.js'), 'utf8')
      ).toBe('original')
    }
    await archive(file, [['app.js', 'revision one']])
    const first = await publishArchive({ root, project, archive: file })
    await archive(file, [['app.js', 'revision two']])
    await publishArchive({ root, project, archive: file })
    build = await snapshot({
      root,
      project,
      deploymentId: 'source-test',
      sourceRevision: first.revision
    })
    expect(await fs.readFile(path.join(build, 'app.js'), 'utf8')).toBe(
      'revision one'
    )
    expect(
      await fs.readFile(path.join(root, 'example', 'app.js'), 'utf8')
    ).toBe('revision two')
    await withSourceLock(root, project, async () => {
      let code
      try {
        await publishArchive({ root, project, archive: file })
      } catch (error) {
        code = error.code
      }
      expect(code).toBe('SOURCE_BUSY')
    })
  } finally {
    await fs.rm(root, { recursive: true, force: true })
    if (build) await fs.rm(build, { recursive: true, force: true })
  }
})
