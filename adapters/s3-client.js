const { S3 } = require('@aws-sdk/client-s3')
module.exports = function createS3Client(storage) {
  const region = storage.region || 'us-east-1'
  if (!/^[a-z0-9-]{1,63}$/.test(region))
    throw new Error('Invalid object storage region')
  if (!storage.key || !storage.secret)
    throw new Error('Object storage credentials are required')
  return new S3({
    region,
    credentials: { accessKeyId: storage.key, secretAccessKey: storage.secret },
    ...(storage.endpoint
      ? { endpoint: storage.endpoint, forcePathStyle: true }
      : {}),
    maxAttempts: 4,
    requestHandler: { connectionTimeout: 5000, requestTimeout: 30000 },
    // R2/Spaces and older S3-compatible servers may not support automatic CRC trailers.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED'
  })
}
