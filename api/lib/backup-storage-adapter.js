module.exports = function createBackupStorageAdapter(config) {
  const options = {
    key: config.key,
    secret: config.secret,
    bucket: config.bucket,
    s3ForcePathStyle: true
  }
  if (config.endpoint) options.endpoint = config.endpoint
  if (config.region) options.region = config.region

  return require('skipper-s3')(options)
}
