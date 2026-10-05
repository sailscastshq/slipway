const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Readable } = require('node:stream')
const sharp = require('sharp')
const photos = require('../../api/lib/profile-photo')
const image = async (format) =>
  sharp({
    create: { width: 32, height: 24, channels: 3, background: '#159bd7' }
  })
    [format]()
    .toBuffer()

test('PNG/JPEG/WebP are fully decoded and re-encoded without metadata', async () => {
  for (const [format, type, extension] of [
    ['png', 'image/png', 'png'],
    ['jpeg', 'image/jpeg', 'jpg'],
    ['webp', 'image/webp', 'webp']
  ]) {
    const buffer = await image(format)
    const result = await photos.normalize({
      buffer,
      type,
      filename: `photo.${extension}`
    })
    const metadata = await sharp(result).metadata()
    assert.equal(metadata.format, 'webp')
    assert.equal(metadata.width, 32)
    assert.equal(metadata.exif, undefined)
  }
})

test('SVG, spoofed types/extensions, corrupt data, animations and oversized uploads fail closed', async () => {
  const buffer = await image('png')
  for (const file of [
    {
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      type: 'image/svg+xml',
      filename: 'image.svg'
    },
    { buffer, type: 'image/jpeg', filename: 'image.jpg' },
    { buffer, type: 'image/png', filename: 'image.html' },
    {
      buffer: buffer.subarray(0, 50),
      type: 'image/png',
      filename: 'image.png'
    },
    {
      buffer: Buffer.alloc(photos.MAX_BYTES + 1),
      type: 'image/png',
      filename: 'image.png'
    }
  ])
    await assert.rejects(() => photos.normalize(file))
  const red = await sharp({
    create: { width: 2, height: 2, channels: 3, background: 'red' }
  })
    .png()
    .toBuffer()
  const blue = await sharp({
    create: { width: 2, height: 2, channels: 3, background: 'blue' }
  })
    .png()
    .toBuffer()
  const animated = await sharp([red, blue], { join: { animated: true } })
    .webp({ loop: 0, delay: [100, 100] })
    .toBuffer()
  assert.equal((await sharp(animated).metadata()).pages, 2)
  await assert.rejects(() =>
    photos.normalize({
      buffer: animated,
      type: 'image/webp',
      filename: 'animated.webp'
    })
  )
  const huge = await sharp({
    create: { width: 5000, height: 5000, channels: 3, background: '#ffffff' }
  })
    .png()
    .toBuffer()
  await assert.rejects(() =>
    photos.normalize({ buffer: huge, type: 'image/png', filename: 'big.png' })
  )
})

function upstream(files) {
  return {
    upload(options, done) {
      const receiver = options.adapter().receive()
      receiver.once('error', done)
      receiver.once('finish', () => done(null, []))
      for (const input of files) {
        const stream = Readable.from([input.buffer])
        stream.filename = input.filename
        stream.headers = { 'content-type': input.type }
        receiver.write(stream)
      }
      receiver.end()
    }
  }
}

test('upload receiver accepts exactly one bounded image', async () => {
  const file = {
    buffer: await image('png'),
    type: 'image/png',
    filename: 'photo.png'
  }
  assert.deepEqual(await photos.receive(upstream([file])), file)
  await assert.rejects(() => photos.receive(upstream([])))
  await assert.rejects(() => photos.receive(upstream([file, file])), /only one/)
  await assert.rejects(() =>
    photos.receive(
      upstream([{ ...file, buffer: Buffer.alloc(photos.MAX_BYTES + 1) }])
    )
  )
})

test('storage uses generated owner paths, replaces only owned objects and cleans failed writes', async (t) => {
  const { S3 } = require('@aws-sdk/client-s3')
  const calls = []
  t.mock.method(S3.prototype, 'putObject', async (input) => {
    calls.push(['put', input])
  })
  t.mock.method(S3.prototype, 'deleteObject', async (input) => {
    calls.push(['delete', input])
  })
  const original = global.Setting
  let row = null
  let persistFails = false
  global.Setting = {
    findOne: async () => (row ? { ...row } : null),
    create: async (input) => {
      if (persistFails) throw new Error('persist failed')
      row = { ...input, id: 1 }
    },
    update: (criteria) => ({
      set: (data) => ({
        fetch: async () => {
          if (persistFails) throw new Error('persist failed')
          if (row?.id !== criteria.id || row?.value !== criteria.value)
            return []
          row = { ...row, ...data }
          return [row]
        }
      })
    })
  }
  const storage = {
    key: 'test-only',
    secret: 'test-only',
    bucket: 'fixture',
    region: 'us-east-1',
    publicUrl: 'https://files.example.test'
  }
  const file = {
    buffer: await image('png'),
    type: 'image/png',
    filename: '../../other-user.png'
  }
  try {
    const first = await photos.upload({
      user: { id: 7 },
      upstream: upstream([file]),
      storage
    })
    assert.match(first.key, /^users\/7\/photos\/[a-f0-9-]+\.webp$/)
    assert.equal(JSON.parse(row.value).key, first.key)
    const second = await photos.upload({
      user: { id: 7 },
      upstream: upstream([file]),
      storage
    })
    assert.notEqual(first.key, second.key)
    assert.equal(calls.at(-1)[0], 'delete')
    assert.equal(calls.at(-1)[1].Key, first.key)
    const previous = row.value
    persistFails = true
    await assert.rejects(
      () =>
        photos.upload({ user: { id: 7 }, upstream: upstream([file]), storage }),
      /persist failed/
    )
    assert.equal(row.value, previous)
    assert.equal(calls.at(-1)[0], 'delete')
    assert.notEqual(calls.at(-1)[1].Key, second.key)
    assert.equal(
      calls.filter(
        ([method, input]) =>
          method === 'put' && input.ContentType === 'image/webp'
      ).length,
      3
    )
  } finally {
    if (original === undefined) delete global.Setting
    else global.Setting = original
  }
})
