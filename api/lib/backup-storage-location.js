module.exports = function location(config) {
  if (!config?.bucket) return null
  if (config.provider === 'azure')
    return JSON.stringify([
      'azure',
      config.bucket,
      config.account,
      (
        config.endpoint || `https://${config.account}.blob.core.windows.net`
      ).replace(/\/$/, '')
    ])
  return JSON.stringify([
    's3',
    config.bucket,
    (
      config.endpoint ||
      `https://s3.${config.region || 'us-east-1'}.amazonaws.com`
    ).replace(/\/$/, '')
  ])
}
