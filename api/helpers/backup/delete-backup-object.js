module.exports = {
  friendlyName: 'Delete S3 object',

  description: 'Delete a single object from S3-compatible storage by key.',

  inputs: {
    s3Key: {
      type: 'string',
      required: true
    }
  },

  fn: async function ({ s3Key }) {
    let globalEnvVars = {}
    try {
      const globalJson = await sails.helpers.setting.get('globalEnvVars', '{}')
      globalEnvVars = JSON.parse(globalJson)
    } catch {
      /* ignore */
    }

    const uploadsConfig = {
      key:
        globalEnvVars.R2_ACCESS_KEY ||
        globalEnvVars.S3_ACCESS_KEY ||
        globalEnvVars.SPACES_ACCESS_KEY ||
        (sails.config.uploads || {}).key,
      secret:
        globalEnvVars.R2_SECRET_KEY ||
        globalEnvVars.S3_SECRET_KEY ||
        globalEnvVars.SPACES_SECRET_KEY ||
        (sails.config.uploads || {}).secret,
      bucket:
        globalEnvVars.R2_BUCKET ||
        globalEnvVars.S3_BUCKET ||
        globalEnvVars.SPACES_BUCKET ||
        (sails.config.uploads || {}).bucket,
      endpoint:
        globalEnvVars.R2_ENDPOINT ||
        globalEnvVars.S3_ENDPOINT ||
        globalEnvVars.SPACES_ENDPOINT ||
        (sails.config.uploads || {}).endpoint,
      region:
        globalEnvVars.S3_REGION ||
        globalEnvVars.SPACES_REGION ||
        (sails.config.uploads || {}).region
    }

    const skipperS3 = require('skipper-s3')
    const adapterOpts = {
      key: uploadsConfig.key,
      secret: uploadsConfig.secret,
      bucket: uploadsConfig.bucket,
      s3ForcePathStyle: true
    }
    if (uploadsConfig.endpoint) adapterOpts.endpoint = uploadsConfig.endpoint
    if (uploadsConfig.region) adapterOpts.region = uploadsConfig.region
    const adapter = skipperS3(adapterOpts)

    await new Promise((resolve, reject) => {
      adapter.rm(s3Key, (err) => {
        if (err) return reject(err)
        resolve()
      })
    })
  }
}
