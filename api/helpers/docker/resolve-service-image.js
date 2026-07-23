const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

const { inspectVersion } = require('../../lib/service-image-policy')

const execFileAsync = promisify(execFile)

module.exports = {
  friendlyName: 'Resolve service image',

  description:
    'Resolve a pinned service tag to an immutable Docker digest, with an offline local-image fallback.',

  inputs: {
    type: {
      type: 'string',
      required: true
    },
    version: {
      type: 'string',
      required: true
    }
  },

  fn: async function ({ type, version }) {
    const selection = inspectVersion(type, version, { useDefault: false })
    const dockerPath = sails.config.docker?.binaryPath || 'docker'
    const localImage = await inspectImage(dockerPath, selection.imageTag)
    let usedLocalFallback = false

    try {
      await execFileAsync(dockerPath, ['pull', selection.imageTag], {
        timeout: 300000,
        maxBuffer: 1024 * 1024
      })
    } catch (error) {
      if (!localImage) {
        const unavailable = new Error(
          `${
            selection.imageTag
          } is not available locally and Docker could not pull it: ${cleanDockerError(
            error
          )}`
        )
        unavailable.code = 'SERVICE_IMAGE_UNAVAILABLE'
        throw unavailable
      }

      usedLocalFallback = true
      sails.log.warn(
        `Could not refresh ${selection.imageTag}; using the existing local image.`
      )
    }

    const image =
      (usedLocalFallback ? localImage : null) ||
      (await inspectImage(dockerPath, selection.imageTag))

    if (!image) {
      const unavailable = new Error(
        `Docker resolved ${selection.imageTag}, but the image could not be inspected.`
      )
      unavailable.code = 'SERVICE_IMAGE_UNAVAILABLE'
      throw unavailable
    }

    const imageReference = selectImmutableReference(selection.repository, image)

    if (!imageReference) {
      const unresolved = new Error(
        `Docker did not return an immutable digest or image ID for ${selection.imageTag}.`
      )
      unresolved.code = 'SERVICE_IMAGE_UNRESOLVED'
      throw unresolved
    }

    return {
      ...selection,
      imageReference,
      imageId: image.Id || null,
      repoDigest:
        image.RepoDigests?.find((digest) =>
          digest.startsWith(`${selection.repository}@`)
        ) ||
        image.RepoDigests?.[0] ||
        null,
      usedLocalFallback,
      resolvedAt: Date.now()
    }
  }
}

async function inspectImage(dockerPath, reference) {
  try {
    const { stdout } = await execFileAsync(
      dockerPath,
      ['image', 'inspect', reference],
      {
        timeout: 30000,
        maxBuffer: 2 * 1024 * 1024
      }
    )
    return JSON.parse(stdout)[0] || null
  } catch {
    return null
  }
}

function selectImmutableReference(repository, image) {
  return (
    image.RepoDigests?.find((digest) => digest.startsWith(`${repository}@`)) ||
    image.RepoDigests?.[0] ||
    image.Id ||
    null
  )
}

function cleanDockerError(error) {
  return (
    String(error.stderr || error.message || error)
      .trim()
      .split('\n')
      .at(-1) || 'unknown Docker error'
  )
}
