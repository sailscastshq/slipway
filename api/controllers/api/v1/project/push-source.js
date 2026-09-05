const path = require('path')
const { publishArchive } = require('../../../../lib/source-workspace')
const fs = require('fs')

module.exports = {
  friendlyName: 'Push source',

  description: 'Upload project source code as a tarball for deployment.',

  files: ['source'],

  inputs: {
    projectSlug: {
      type: 'string',
      required: true,
      description: 'Project slug'
    },
    source: {
      type: 'ref',
      description: 'Source tarball file upload'
    }
  },

  exits: {
    success: {
      statusCode: 200
    },
    notFound: {
      statusCode: 404
    },
    busy: { statusCode: 503 },
    forbidden: {
      statusCode: 403
    },
    badRequest: {
      responseType: 'badRequest'
    }
  },

  fn: async function ({ projectSlug }) {
    const user = await User.findOne({
      id: this.req.auth?.userId || this.req.session.userId
    })

    const project = await Project.findOne({ slug: projectSlug }).populate(
      'team'
    )

    if (!project) {
      throw 'notFound'
    }

    if (project.team.id !== user.team) {
      throw 'forbidden'
    }

    // Receive the uploaded tarball via Skipper
    const uploadedFiles = await new Promise((resolve, reject) => {
      this.req.file('source').upload(
        {
          maxBytes: 500 * 1024 * 1024 // 500MB max
        },
        (err, files) => {
          if (err) return reject(err)
          resolve(files)
        }
      )
    })

    if (!uploadedFiles || uploadedFiles.length === 0) {
      throw 'badRequest'
    }

    const tarballPath = uploadedFiles[0].fd
    const targetDir = path.join(sails.config.custom.slipwayAppsDir, projectSlug)

    let publication
    try {
      publication = await publishArchive({
        root: sails.config.custom.slipwayAppsDir,
        project,
        archive: tarballPath,
        limits: sails.config.custom.sourceArchiveLimits
      })
    } catch (error) {
      sails.log.warn(`Source upload rejected: ${error.message}`)
      if (error.code === 'SOURCE_BUSY')
        throw { busy: { message: error.message } }
      throw {
        badRequest: {
          message:
            'Source archive was rejected. Previous source is preserved. Check archive paths, file types, size, and available disk space.'
        }
      }
    } finally {
      await Promise.all(
        uploadedFiles.map((file) => fs.promises.rm(file.fd, { force: true }))
      )
    }

    // Detect features from the pushed source and store on all environments
    try {
      const detectedFeatures = await sails.helpers.sails.detectFeatures(
        targetDir
      )
      await Environment.update({ project: project.id }).set({
        features: detectedFeatures
      })
      if (Object.keys(detectedFeatures).length > 0) {
        sails.log.info(
          `Features detected for ${projectSlug}: ${Object.keys(
            detectedFeatures
          ).join(', ')}`
        )
      }
    } catch (err) {
      sails.log.warn(
        `Feature detection after push failed (non-fatal): ${err.message}`
      )
    }

    sails.log.info(`Source pushed for ${projectSlug} → ${targetDir}`)

    return {
      message: 'Source uploaded successfully',
      project: projectSlug,
      sourceRevision: publication.revision
    }
  }
}
