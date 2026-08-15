const RUNTIME_VERSION_COMMANDS = Object.freeze({
  redis: Object.freeze(['redis-server', '--version'])
})

const ENV_VERSION_KEYS = Object.freeze({
  postgresql: Object.freeze(['PG_MAJOR', 'PG_VERSION']),
  mysql: Object.freeze(['MYSQL_VERSION', 'MYSQL_MAJOR']),
  redis: Object.freeze(['REDIS_VERSION']),
  mongodb: Object.freeze(['MONGO_VERSION', 'MONGO_MAJOR'])
})

function getRuntimeVersionCommand(type) {
  return RUNTIME_VERSION_COMMANDS[type] || null
}

function discoverServiceVersion({ type, runtimeOutput, container, image }) {
  const runtimeVersion = detectRuntimeVersion(type, runtimeOutput)
  if (runtimeVersion) {
    return {
      detectedVersion: runtimeVersion,
      source: 'runtime-command'
    }
  }

  const env = collectEnvironment(container, image)
  for (const key of ENV_VERSION_KEYS[type] || []) {
    const version = extractNumericVersion(env[key])
    if (version) {
      return {
        detectedVersion: version,
        source: `image-env:${key}`
      }
    }
  }

  if (type === 'redis') {
    const downloadVersion = extractRedisDownloadVersion(env.REDIS_DOWNLOAD_URL)
    if (downloadVersion) {
      return {
        detectedVersion: downloadVersion,
        source: 'image-env:REDIS_DOWNLOAD_URL'
      }
    }
  }

  const configuredTag = extractTag(container?.Config?.Image)
  if (configuredTag) {
    return {
      detectedVersion: configuredTag,
      source: 'configured-image-tag'
    }
  }

  for (const repoTag of image?.RepoTags || []) {
    const tag = extractTag(repoTag)
    if (tag) {
      return {
        detectedVersion: tag,
        source: 'repository-tag'
      }
    }
  }

  return {
    detectedVersion: null,
    source: null
  }
}

function detectRuntimeVersion(type, output) {
  if (type !== 'redis' || !output) return null

  const versionMatch = String(output).match(
    /(?:^|\s)(?:v(?:ersion)?=?)\s*(\d+(?:\.\d+){1,2})(?:\s|$)/i
  )
  return versionMatch?.[1] || null
}

function collectEnvironment(container, image) {
  return Object.fromEntries(
    [...(image?.Config?.Env || []), ...(container?.Config?.Env || [])]
      .map((entry) => String(entry).split(/=(.*)/s))
      .filter(([key, value]) => key && value !== undefined)
  )
}

function extractRedisDownloadVersion(value) {
  if (!value) return null

  return (
    String(value).match(
      /\/refs\/tags\/v?(\d+(?:\.\d+){1,2})\.tar\.gz(?:$|[?#])/i
    )?.[1] || null
  )
}

function extractNumericVersion(value) {
  return String(value || '').match(/\d+(?:\.\d+){0,2}/)?.[0] || null
}

function extractTag(reference) {
  const tag = String(reference || '').match(/:([^:@]+)$/)?.[1]
  if (!tag || tag.toLowerCase() === 'latest') return null

  return extractNumericVersion(tag)
}

module.exports = {
  discoverServiceVersion,
  getRuntimeVersionCommand
}
