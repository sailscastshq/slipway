const { Writable } = require('node:stream')
const { randomUUID, createHash } = require('node:crypto')
const createClient = require('../../adapters/s3-client')

const MAX_BYTES = 5 * 1024 * 1024
const MAX_PIXELS = 16 * 1024 * 1024
const formats = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' }
const extensions = {
  png: ['png'],
  jpeg: ['jpg', 'jpeg', 'jfif'],
  webp: ['webp']
}
const settingKey = (id) => `userProfilePhoto:${id}`

async function receive(upstream) {
  const files = []
  await new Promise((resolve, reject) => {
    const adapter = () => ({
      receive: () =>
        new Writable({
          objectMode: true,
          write(file, _encoding, done) {
            if (files.length) return done(new Error('Choose only one photo.'))
            const captured = {
              filename: file.filename,
              type: file.headers?.['content-type'],
              buffer: null
            }
            files.push(captured)
            ;(async () => {
              const chunks = []
              let bytes = 0
              for await (const chunk of file) {
                bytes += chunk.length
                if (bytes > MAX_BYTES)
                  throw new Error('Photo must be smaller than 5 MB.')
                chunks.push(chunk)
              }
              captured.buffer = Buffer.concat(chunks)
            })().then(() => done(), done)
          }
        })
    })
    upstream.upload({ adapter, maxBytes: MAX_BYTES }, (error) =>
      error ? reject(error) : resolve()
    )
  })
  if (files.length !== 1) throw new Error('Choose one photo to upload.')
  return files[0]
}

async function normalize({ buffer, type, filename }) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_BYTES)
    throw new Error('Photo must be smaller than 5 MB.')
  // Reject non-raster formats before invoking a native decoder.
  const format = buffer
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ? 'png'
    : buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255
    ? 'jpeg'
    : buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP'
    ? 'webp'
    : null
  const extension = String(filename || '')
    .split('.')
    .pop()
    .toLowerCase()
  if (
    !format ||
    formats[format] !== type ||
    !extensions[format].includes(extension)
  )
    throw new Error(
      'Choose a still PNG, JPEG or WebP photo with matching file type.'
    )
  const decoder = require('sharp')(buffer, {
    failOn: 'warning',
    limitInputPixels: MAX_PIXELS
  })
  let metadata
  try {
    metadata = await decoder.metadata()
  } catch {
    throw new Error('Choose a valid PNG, JPEG or WebP photo.')
  }
  if (
    !formats[metadata.format] ||
    formats[metadata.format] !== type ||
    !extensions[metadata.format].includes(extension) ||
    !metadata.width ||
    !metadata.height ||
    metadata.width * metadata.height > MAX_PIXELS ||
    (metadata.pages || 1) !== 1
  )
    throw new Error(
      'Choose a still PNG, JPEG or WebP photo with matching file type.'
    )
  try {
    // Decode the whole image and emit new pixels. No uploaded metadata or active
    // content is copied into the public object, even for an appended payload.
    return await decoder
      .rotate()
      .resize(512, 512, { fit: 'cover', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer()
  } catch {
    throw new Error('The photo is damaged or could not be decoded.')
  }
}

async function get(id) {
  const row = await Setting.findOne({ key: settingKey(id) })
  try {
    return row?.value ? JSON.parse(row.value) : null
  } catch {
    return null
  }
}

async function upload({ user, upstream, storage }) {
  const image = await normalize(await receive(upstream))
  const key = `users/${user.id}/photos/${randomUUID()}.webp`
  const base = new URL(storage.publicUrl)
  if (
    !['https:', 'http:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new Error('The configured public photo URL is invalid.')
  const scope = createHash('sha256')
    .update(
      JSON.stringify([
        storage.bucket,
        storage.endpoint || '',
        storage.region || ''
      ])
    )
    .digest('hex')
  const photo = {
    key,
    url: `${base.href.replace(/\/$/, '')}/${key}`,
    storageScope: scope
  }
  const previous = await Setting.findOne({ key: settingKey(user.id) })
  const client = createClient(storage)
  try {
    await client.putObject({
      Bucket: storage.bucket,
      Key: key,
      Body: image,
      ContentType: 'image/webp',
      CacheControl: 'public, max-age=31536000, immutable'
    })
    const value = JSON.stringify(photo)
    if (previous) {
      const changed = await Setting.update({
        id: previous.id,
        value: previous.value
      })
        .set({ value })
        .fetch()
      if (changed.length !== 1)
        throw new Error('Profile photo changed during upload.')
    } else await Setting.create({ key: settingKey(user.id), value })
    // Only remove a replaced object after compare-and-set succeeds. A concurrent
    // upload cannot delete another upload's current photo.
    let old
    try {
      old = JSON.parse(previous?.value || 'null')
    } catch {}
    if (
      old?.storageScope === scope &&
      typeof old.key === 'string' &&
      old.key.startsWith(`users/${user.id}/photos/`) &&
      /^[a-f0-9-]+\.webp$/.test(old.key.split('/').pop())
    )
      await client
        .deleteObject({ Bucket: storage.bucket, Key: old.key })
        .catch(() => {})
    return photo
  } catch (error) {
    // Keys are generated under this session user's prefix, never supplied by
    // the request. Failed persistence cannot leave a new public orphan.
    await client
      .deleteObject({ Bucket: storage.bucket, Key: key })
      .catch(() => {})
    throw error
  } finally {
    client.destroy()
  }
}

module.exports = {
  receive,
  normalize,
  get,
  upload,
  settingKey,
  MAX_BYTES,
  MAX_PIXELS
}
