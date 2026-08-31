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
      responseType: 'inertiaRedirect',
      description: 'Logo uploaded successfully.'
    },
    badRequest: {
      responseType: 'badRequest'
    }
  },

  fn: async function () {
    const req = this.req

    let storage
    try {
      storage = await sails.helpers.uploads.getStorageConfig.with({
        requirePublicUrl: true
      })
    } catch (error) {
      throw {
        badRequest: {
          problems: [{ logo: error.message }]
        }
      }
    }

    const user = await User.findOne({ id: req.session.userId }).populate('team')

    // Generate unique filename
    const fileId = uuidv4()
    const dirname = `teams/${user.team.id}/logos`

    // Upload the file
    const uploadedFiles = await new Promise((resolve, reject) => {
      req.file('logo').upload(
        {
          adapter: require('skipper-s3'),
          key: storage.key,
          secret: storage.secret,
          bucket: storage.bucket,
          endpoint: storage.endpoint,
          region: storage.region || 'auto',
          dirname,
          saveAs: (file, cb) => {
            const ext = file.filename.split('.').pop() || 'png'
            cb(null, `${fileId}.${ext}`)
          },
          maxBytes: 5 * 1024 * 1024 // 5MB limit
        },
        (err, files) => {
          if (err) reject(err)
          else resolve(files)
        }
      )
    }).catch((error) => {
      throw {
        badRequest: {
          problems: [
            {
              logo:
                error.code === 'E_EXCEEDS_UPLOAD_LIMIT'
                  ? 'Image must be smaller than 5MB.'
                  : error.message || 'The image could not be uploaded.'
            }
          ]
        }
      }
    })

    if (!uploadedFiles || uploadedFiles.length === 0) {
      throw {
        badRequest: {
          problems: [{ logo: 'Choose an image to upload.' }]
        }
      }
    }

    const uploadedFile = uploadedFiles[0]

    // Construct the public URL using the configured public URL base
    const fileName = uploadedFile.fd.split('/').pop()
    const baseUrl = storage.publicUrl.replace(/\/$/, '')
    const logoUrl = `${baseUrl}/${dirname}/${fileName}`

    // Update team with new logo URL
    await Team.updateOne({ id: user.team.id }).set({
      logoUrl
    })

    sails.inertia.refreshOnce('loggedInUser')
    sails.inertia.flash('success', 'Team logo updated.')
    return '/settings/team-profile'
  }
}
