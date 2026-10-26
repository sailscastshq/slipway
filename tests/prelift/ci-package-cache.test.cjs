const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const tar = require('tar-stream')
const { validateCacheArchive } =
  require('../../bin/ci-server-executor.cjs')._private

test('package download archives accept only bounded regular cache entries, never links or source paths', async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'ci-cache-entries-')
  )
  const file = path.join(directory, 'cache.tar')
  async function archive(header, body = '') {
    const pack = tar.pack()
    const chunks = []
    pack.on('data', (chunk) => chunks.push(chunk))
    const done = new Promise((resolve) => pack.on('end', resolve))
    pack.entry(header, body)
    pack.finalize()
    await done
    await fs.writeFile(file, Buffer.concat(chunks))
  }
  try {
    await archive({ name: '_cacache/content-v2/sha512/ab/cd/1234' }, 'package')
    await validateCacheArchive(file)
    for (const header of [
      { name: '../../source.js' },
      { name: '/workspace/source.js' },
      { name: '_cacache/content-v2/../source.js' },
      {
        name: '_cacache/content-v2/link',
        type: 'symlink',
        linkname: '/workspace'
      },
      {
        name: '_cacache/content-v2/link',
        type: 'link',
        linkname: '/workspace/source.js'
      },
      { name: '_cacache/content-v2/device', type: 'character-device' },
      { name: '_cacache/content-v2/' + 'a'.repeat(513) },
      { name: '.npmrc' }
    ]) {
      await archive(header)
      await assert.rejects(validateCacheArchive(file), /unsafe archive entry/)
    }
    await fs.writeFile(file, 'broken archive')
    await assert.rejects(validateCacheArchive(file))
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})
