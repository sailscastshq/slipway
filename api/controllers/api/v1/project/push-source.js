const fs = require('fs')
let receivingUploads = 0

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
    accepted: { statusCode: 202 },
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
    const user = await User.forRequest(this.req)

    const project = await Project.findOne({ slug: projectSlug }).populate(
      'team'
    )

    if (!project) {
      throw 'notFound'
    }

    if (project.team.id !== user.team) {
      throw 'forbidden'
    }

    if (receivingUploads >= 2)
      throw {
        busy: {
          message:
            'Two source uploads are already being received. Retry shortly.'
        }
      }
    receivingUploads++
    try {
      await fs.promises.mkdir(sails.config.custom.slipwayAppsDir, {
        recursive: true
      })
      const disk = await fs.promises.statfs(sails.config.custom.slipwayAppsDir)
      const uploadBudget = Math.min(
        500 * 1024 * 1024,
        Math.floor((disk.bavail * disk.bsize - 256 * 1024 * 1024) / 4)
      )
      if (uploadBudget <= 0)
        throw {
          busy: { message: 'Insufficient disk space to receive source safely.' }
        }
      // Receive the uploaded tarball via Skipper
      const uploadedFiles = await new Promise((resolve, reject) => {
        this.req.file('source').upload(
          {
            maxBytes: uploadBudget
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

      let operation
      try {
        operation = await require('../../../../lib/source-operations').enqueue({
          project,
          userId: user.id,
          archive: uploadedFiles[0].fd
        })
      } catch (error) {
        if (error.code === 'SOURCE_BUSY')
          throw { busy: { message: error.message } }
        throw error
      } finally {
        await Promise.all(
          uploadedFiles.map((file) => fs.promises.rm(file.fd, { force: true }))
        )
      }
      if (this.req.get('x-slipway-source-protocol') === '2') {
        throw {
          accepted: {
            message: 'Source upload queued',
            operation:
              require('../../../../lib/source-operations').publicOperation(
                operation
              )
          }
        }
      }
      // Older CLIs expect source to be ready before they trigger a deployment.
      // Keep compatibility without blocking the event loop.
      while (['queued', 'running'].includes(operation.status)) {
        await new Promise((resolve) => setTimeout(resolve, 250))
        operation = await SourceOperation.findOne({ id: operation.id })
      }
      if (operation.status !== 'completed')
        throw {
          badRequest: {
            message: operation.error || 'Source upload did not complete'
          }
        }
      return {
        message: 'Source uploaded successfully',
        project: projectSlug,
        sourceRevision: operation.sourceRevision
      }
    } finally {
      receivingUploads--
    }
  }
}
