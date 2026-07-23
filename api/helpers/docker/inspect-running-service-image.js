const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

const {
  findSupportedLine,
  getPolicy
} = require('../../lib/service-image-policy')

const execFileAsync = promisify(execFile)

module.exports = {
  friendlyName: 'Inspect running service image',

  description:
    'Inspect an existing service container and recover its version and immutable image reference without recreating it.',

  inputs: {
    type: {
      type: 'string',
      required: true
    },
    containerName: {
      type: 'string',
      required: true
    }
  },

  fn: async function ({ type, containerName }) {
    const dockerPath = sails.config.docker?.binaryPath || 'docker'
    const container = await inspect(dockerPath, ['inspect', containerName])
    const containerDetails = container[0]

    if (!containerDetails?.Image) {
      const error = new Error(
        `Container ${containerName} does not expose an image ID.`
      )
      error.code = 'SERVICE_CONTAINER_IMAGE_NOT_FOUND'
      throw error
    }

    const images = await inspect(dockerPath, [
      'image',
      'inspect',
      containerDetails.Image
    ])
    const image = images[0]
    const policy = getPolicy(type)
    const detectedVersion = detectVersion(type, containerDetails, image)
    const version = findSupportedLine(type, detectedVersion)
    const imageReference =
      image?.RepoDigests?.find((digest) =>
        digest.startsWith(`${policy.repository}@`)
      ) ||
      image?.RepoDigests?.[0] ||
      image?.Id ||
      containerDetails.Image

    return {
      version,
      detectedVersion,
      imageReference,
      imageId: image?.Id || containerDetails.Image,
      repoDigest: image?.RepoDigests?.[0] || null,
      configuredImage: containerDetails.Config?.Image || null,
      inspectedAt: Date.now()
    }
  }
}

async function inspect(dockerPath, args) {
  try {
    const { stdout } = await execFileAsync(dockerPath, args, {
      timeout: 30000,
      maxBuffer: 2 * 1024 * 1024
    })
    return JSON.parse(stdout)
  } catch (cause) {
    const error = new Error(
      `Could not inspect Docker resource ${args.at(-1)}: ${String(
        cause.stderr || cause.message || cause
      )
        .trim()
        .split('\n')
        .at(-1)}`
    )
    error.code = 'SERVICE_CONTAINER_IMAGE_NOT_FOUND'
    throw error
  }
}

function detectVersion(type, container, image) {
  const env = Object.fromEntries(
    (image?.Config?.Env || [])
      .map((entry) => entry.split(/=(.*)/s))
      .filter(([key, value]) => key && value !== undefined)
  )

  const envKeys = {
    postgresql: ['PG_MAJOR', 'PG_VERSION'],
    mysql: ['MYSQL_VERSION', 'MYSQL_MAJOR'],
    redis: ['REDIS_VERSION'],
    mongodb: ['MONGO_VERSION', 'MONGO_MAJOR']
  }

  for (const key of envKeys[type] || []) {
    const numeric = env[key]?.match(/\d+(?:\.\d+){0,2}/)?.[0]
    if (numeric) return numeric
  }

  const configuredTag = container.Config?.Image?.match(/:([^:@]+)$/)?.[1]
  if (configuredTag && configuredTag !== 'latest') {
    return configuredTag
  }

  for (const repoTag of image?.RepoTags || []) {
    const tag = repoTag.match(/:([^:@]+)$/)?.[1]
    if (tag && tag !== 'latest') return tag
  }

  return null
}
