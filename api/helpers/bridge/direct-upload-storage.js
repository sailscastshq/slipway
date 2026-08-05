const AWS = require('aws-sdk')

const MAX_PARTS = 10_000

module.exports = {
  friendlyName: 'Bridge direct upload storage',

  description:
    'Perform one server-owned S3-compatible direct-upload control operation.',

  inputs: {
    operation: {
      type: 'string',
      required: true,
      isIn: [
        'signPut',
        'createMultipart',
        'signParts',
        'listParts',
        'completeMultipart',
        'abortMultipart',
        'head'
      ]
    },
    storage: {
      type: 'ref',
      required: true
    },
    objectPath: {
      type: 'string',
      required: true,
      maxLength: 1024
    },
    contentType: {
      type: 'string',
      maxLength: 255
    },
    uploadId: {
      type: 'string',
      maxLength: 2048
    },
    partNumbers: {
      type: 'json',
      defaultsTo: []
    },
    parts: {
      type: 'json',
      defaultsTo: []
    },
    expiresInSeconds: {
      type: 'number',
      defaultsTo: 60 * 60,
      min: 60,
      max: 60 * 60,
      isInteger: true
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({
    operation,
    storage,
    objectPath,
    contentType,
    uploadId,
    partNumbers,
    parts,
    expiresInSeconds
  }) {
    const client = createClient(storage)
    const base = { Bucket: storage.bucket, Key: objectPath }

    try {
      if (operation === 'signPut') {
        requireContentType(contentType)
        return {
          uploadUrl: await signedUrl(client, 'putObject', {
            ...base,
            ContentType: contentType,
            Expires: expiresInSeconds
          }),
          expiresInSeconds
        }
      }

      if (operation === 'createMultipart') {
        requireContentType(contentType)
        const created = await client
          .createMultipartUpload({ ...base, ContentType: contentType })
          .promise()
        if (!created.UploadId) {
          throw new Error(
            'Object storage did not return a multipart upload ID.'
          )
        }
        return { uploadId: created.UploadId }
      }

      requireUploadId(uploadId)

      if (operation === 'signParts') {
        const numbers = normalizePartNumbers(partNumbers)
        return {
          parts: await Promise.all(
            numbers.map(async (partNumber) => ({
              partNumber,
              uploadUrl: await signedUrl(client, 'uploadPart', {
                ...base,
                UploadId: uploadId,
                PartNumber: partNumber,
                Expires: expiresInSeconds
              })
            }))
          ),
          expiresInSeconds
        }
      }

      if (operation === 'listParts') {
        return {
          parts: await listParts(client, { ...base, UploadId: uploadId })
        }
      }

      if (operation === 'completeMultipart') {
        const normalizedParts = normalizeCompletedParts(parts)
        const completed = await client
          .completeMultipartUpload({
            ...base,
            UploadId: uploadId,
            MultipartUpload: { Parts: normalizedParts }
          })
          .promise()
        return {
          etag: normalizeEtag(completed.ETag),
          location: completed.Location || null
        }
      }

      if (operation === 'abortMultipart') {
        await client
          .abortMultipartUpload({ ...base, UploadId: uploadId })
          .promise()
        return { aborted: true }
      }

      const metadata = await client.headObject(base).promise()
      if (!Number.isSafeInteger(metadata.ContentLength)) {
        throw new Error('Object storage did not return a valid object size.')
      }
      return {
        size: metadata.ContentLength,
        type: normalizeType(metadata.ContentType),
        etag: normalizeEtag(metadata.ETag)
      }
    } catch (cause) {
      if (isMissingMultipart(cause)) {
        const error = new Error('This multipart upload is no longer available.')
        error.code = 'BRIDGE_MULTIPART_UPLOAD_MISSING'
        error.cause = cause
        throw error
      }
      throw cause
    }
  }
}

function createClient(storage) {
  return new AWS.S3({
    accessKeyId: storage.key,
    secretAccessKey: storage.secret,
    region: storage.region || 'us-east-1',
    ...(storage.endpoint
      ? { endpoint: storage.endpoint, s3ForcePathStyle: true }
      : {}),
    signatureVersion: 'v4',
    httpOptions: {
      connectTimeout: 5000,
      timeout: 30_000
    },
    maxRetries: 3
  })
}

function signedUrl(client, operation, options) {
  return new Promise((resolve, reject) => {
    client.getSignedUrl(operation, options, (error, url) => {
      if (error) reject(error)
      else resolve(url)
    })
  })
}

async function listParts(client, base) {
  const parts = []
  let partNumberMarker
  do {
    const page = await client
      .listParts({ ...base, PartNumberMarker: partNumberMarker })
      .promise()
    for (const part of page.Parts || []) {
      if (
        Number.isInteger(part.PartNumber) &&
        part.PartNumber >= 1 &&
        part.PartNumber <= MAX_PARTS &&
        Number.isSafeInteger(part.Size) &&
        part.ETag
      ) {
        parts.push({
          partNumber: part.PartNumber,
          size: part.Size,
          etag: normalizeEtag(part.ETag)
        })
      }
    }
    if (!page.IsTruncated) break
    partNumberMarker = page.NextPartNumberMarker
    if (!partNumberMarker) {
      throw new Error(
        'Object storage returned a truncated part list without a marker.'
      )
    }
  } while (partNumberMarker)
  return parts.sort((left, right) => left.partNumber - right.partNumber)
}

function normalizePartNumbers(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('At least one multipart part must be signed.')
  }
  const numbers = value.map(Number)
  if (
    numbers.some(
      (number) => !Number.isInteger(number) || number < 1 || number > MAX_PARTS
    ) ||
    new Set(numbers).size !== numbers.length
  ) {
    throw new Error('Multipart part numbers are invalid.')
  }
  return numbers
}

function normalizeCompletedParts(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('No multipart parts are ready to complete.')
  }
  const parts = value
    .map((part) => ({
      PartNumber: Number(part.partNumber),
      ETag: quoteEtag(part.etag)
    }))
    .sort((left, right) => left.PartNumber - right.PartNumber)
  normalizePartNumbers(parts.map((part) => part.PartNumber))
  if (parts.some((part) => part.ETag === '""')) {
    throw new Error('A multipart part is missing its ETag.')
  }
  return parts
}

function requireUploadId(value) {
  if (!value) throw new Error('A multipart upload ID is required.')
}

function requireContentType(value) {
  if (!value) throw new Error('A content type is required for this upload.')
}

function quoteEtag(value) {
  return `"${normalizeEtag(value) || ''}"`
}

function normalizeEtag(value) {
  return String(value || '').replace(/^"|"$/g, '') || null
}

function normalizeType(value) {
  return String(value || '')
    .split(';')[0]
    .trim()
    .toLowerCase()
}

function isMissingMultipart(error) {
  return (
    error?.code === 'NoSuchUpload' ||
    error?.name === 'NoSuchUpload' ||
    error?.statusCode === 404 ||
    error?.$metadata?.httpStatusCode === 404
  )
}
