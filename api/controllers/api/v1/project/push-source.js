const path = require('path')
const { execFileSync } = require('child_process')
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
    forbidden: {
      statusCode: 403
    },
    badRequest: {
      responseType: 'badRequest'
    }
  },

  fn: async function ({ projectSlug }) {
    const user = await User.findOne({ id: this.req.session.userId })

    const project = await Project.findOne({ slug: projectSlug }).populate('team')

    if (!project) {
      throw 'notFound'
    }

    if (project.team.id !== user.team) {
      throw 'forbidden'
    }

    // Receive the uploaded tarball via Skipper
    const uploadedFiles = await new Promise((resolve, reject) => {
      this.req.file('source').upload({
        maxBytes: 500 * 1024 * 1024 // 500MB max
      }, (err, files) => {
        if (err) return reject(err)
        resolve(files)
      })
    })

    if (!uploadedFiles || uploadedFiles.length === 0) {
      throw 'badRequest'
    }

    const tarballPath = uploadedFiles[0].fd
    const targetDir = path.join(sails.config.custom.slipwayAppsDir, projectSlug)

    // Ensure the apps directory exists
    fs.mkdirSync(sails.config.custom.slipwayAppsDir, { recursive: true })

    // Clear existing source and recreate directory
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true })
    }
    fs.mkdirSync(targetDir, { recursive: true })

    // Extract the tarball (using execFileSync to avoid shell injection)
    try {
      execFileSync('tar', ['xzf', tarballPath, '-C', targetDir], {
        timeout: 60000
      })
    } catch (err) {
      // Clean up uploaded file
      try { fs.unlinkSync(tarballPath) } catch { /* ignore */ }
      sails.log.error(`Failed to extract source tarball: ${err.message}`)
      throw 'badRequest'
    }

    // Clean up the uploaded temp file
    try { fs.unlinkSync(tarballPath) } catch { /* ignore */ }

    // Detect features from the pushed source and store on all environments
    try {
      const detectedFeatures = await sails.helpers.sails.detectFeatures(targetDir)
      if (Object.keys(detectedFeatures).length > 0) {
        await Environment.update({ project: project.id }).set({ features: detectedFeatures })
        sails.log.info(`Features detected for ${projectSlug}: ${Object.keys(detectedFeatures).join(', ')}`)
      }
    } catch (err) {
      sails.log.warn(`Feature detection after push failed (non-fatal): ${err.message}`)
    }

    sails.log.info(`Source pushed for ${projectSlug} → ${targetDir}`)

    return {
      message: 'Source uploaded successfully',
      project: projectSlug
    }
  }
}
