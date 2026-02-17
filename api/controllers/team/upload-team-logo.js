/**
 * upload-team-logo.js
 *
 * Handles team logo uploads to S3-compatible storage.
 */

const { v4: uuidv4 } = require('uuid')

module.exports = {
  friendlyName: 'Upload team logo',

  description: 'Upload a new logo for the team.',

  files: ['logo'],

  inputs: {
    logo: {
      type: 'ref',
      required: true,
      description: 'The uploaded logo file'
    }
  },

  exits: {
    success: {
      description: 'Logo uploaded successfully.'
    },
    badRequest: {
      responseType: 'badRequest'
    },
    notConfigured: {
      statusCode: 400,
      description: 'File uploads not configured.'
    }
  },

  fn: async function (inputs) {
    const req = this.req

    // Get S3 config from global env vars
    let globalEnvVars = {}
    try {
      const globalJson = await sails.helpers.setting.get('globalEnvVars', '{}')
      globalEnvVars = JSON.parse(globalJson)
    } catch { /* ignore */ }

    // Determine S3 config
    const s3Config = {
      key: globalEnvVars.R2_ACCESS_KEY || globalEnvVars.S3_ACCESS_KEY || globalEnvVars.SPACES_ACCESS_KEY || sails.config.uploads?.key,
      secret: globalEnvVars.R2_SECRET_KEY || globalEnvVars.S3_SECRET_KEY || globalEnvVars.SPACES_SECRET_KEY || sails.config.uploads?.secret,
      bucket: globalEnvVars.R2_BUCKET || globalEnvVars.S3_BUCKET || globalEnvVars.SPACES_BUCKET || sails.config.uploads?.bucket,
      endpoint: globalEnvVars.R2_ENDPOINT || globalEnvVars.S3_ENDPOINT || globalEnvVars.SPACES_ENDPOINT || sails.config.uploads?.endpoint,
      region: globalEnvVars.S3_REGION || globalEnvVars.SPACES_REGION || sails.config.uploads?.region || 'auto'
    }

    if (!s3Config.key || !s3Config.secret || !s3Config.bucket) {
      throw 'notConfigured'
    }

    const user = await User.findOne({ id: req.session.userId }).populate('team')

    // Generate unique filename
    const fileId = uuidv4()
    const dirname = `teams/${user.team.id}/logos`

    // Upload the file
    const uploadedFiles = await new Promise((resolve, reject) => {
      req.file('logo').upload({
        adapter: require('skipper-s3'),
        key: s3Config.key,
        secret: s3Config.secret,
        bucket: s3Config.bucket,
        endpoint: s3Config.endpoint,
        region: s3Config.region,
        dirname,
        saveAs: (file, cb) => {
          const ext = file.filename.split('.').pop() || 'png'
          cb(null, `${fileId}.${ext}`)
        },
        maxBytes: 5 * 1024 * 1024 // 5MB limit
      }, (err, files) => {
        if (err) reject(err)
        else resolve(files)
      })
    })

    if (!uploadedFiles || uploadedFiles.length === 0) {
      throw 'badRequest'
    }

    const uploadedFile = uploadedFiles[0]

    // Construct the public URL using the configured public URL base
    const publicUrl = globalEnvVars.R2_PUBLIC_URL || globalEnvVars.S3_PUBLIC_URL || globalEnvVars.SPACES_PUBLIC_URL
    const fileName = uploadedFile.fd.split('/').pop()
    let logoUrl
    if (publicUrl) {
      const baseUrl = publicUrl.replace(/\/$/, '')
      logoUrl = `${baseUrl}/${dirname}/${fileName}`
    } else if (s3Config.endpoint) {
      const endpointClean = s3Config.endpoint.replace(/\/$/, '')
      logoUrl = `${endpointClean}/${dirname}/${fileName}`
    } else {
      logoUrl = `https://${s3Config.bucket}.s3.${s3Config.region}.amazonaws.com/${dirname}/${fileName}`
    }

    // Update team with new logo URL
    await Team.updateOne({ id: user.team.id }).set({
      logoUrl
    })

    return { logoUrl }
  }
}
