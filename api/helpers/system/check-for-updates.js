module.exports = {
  friendlyName: 'Check for updates',

  description: 'Check GitHub releases for new versions of Slipway.',

  inputs: {
    skipCache: {
      type: 'boolean',
      defaultsTo: false,
      description: 'Bypass the cache and fetch fresh results from GitHub.'
    }
  },

  exits: {
    success: {
      description: 'Successfully checked for updates.'
    }
  },

  fn: async function ({ skipCache }) {
    const currentVersion = sails.config.slipway?.version || '0.1.0'
    const githubRepo =
      sails.config.slipway?.githubRepo || 'sailscastshq/slipway'

    // Cache key for rate limiting - only check once per hour
    const cacheKey = 'slipway_update_check'
    if (!skipCache) {
      const cached = await sails.cache.get(cacheKey)
      if (cached) {
        return cached
      }
    }

    try {
      // Fetch latest release from GitHub
      const response = await fetch(
        `https://api.github.com/repos/${githubRepo}/releases/latest`,
        {
          headers: {
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': `Slipway/${currentVersion}`
          }
        }
      )

      if (!response.ok) {
        // 404 means no releases yet - this is normal during development
        if (response.status === 404) {
          return {
            currentVersion,
            latestVersion: currentVersion,
            updateAvailable: false,
            error: 'no_releases'
          }
        }

        // Log other errors (rate limiting, server errors, etc.)
        sails.log.warn(
          `[slipway] Update check failed: ${response.status} ${response.statusText}`
        )
        return {
          currentVersion,
          latestVersion: currentVersion,
          updateAvailable: false,
          error: response.status === 403 ? 'rate_limited' : 'fetch_failed'
        }
      }

      const release = await response.json()
      const latestVersion =
        release.tag_name?.replace(/^v/, '') || currentVersion

      // Simple semver comparison (major.minor.patch)
      const isNewer = compareVersions(latestVersion, currentVersion) > 0

      // Verify the Docker image actually exists on GHCR before showing update
      let imageReady = false
      if (isNewer) {
        imageReady = await checkGhcrImage(githubRepo, latestVersion)
        if (!imageReady) {
          sails.log.verbose(
            `[slipway] v${latestVersion} released but Docker image not yet available on GHCR`
          )
        }
      }

      const result = {
        currentVersion,
        latestVersion,
        updateAvailable: isNewer && imageReady,
        releaseUrl: release.html_url,
        releaseNotes: release.body?.substring(0, 500) || '',
        publishedAt: release.published_at,
        error: isNewer && !imageReady ? 'image_not_ready' : null
      }

      // Cache for 1 hour (3600000ms)
      await sails.cache.set(cacheKey, result, 3600000)

      return result
    } catch (err) {
      sails.log.warn(`[slipway] Update check error: ${err.message}`)
      return {
        currentVersion,
        latestVersion: currentVersion,
        updateAvailable: false,
        error: 'network_error'
      }
    }
  }
}

/**
 * Compare two semver version strings.
 * @param {string} a - First version (e.g., "1.2.3")
 * @param {string} b - Second version (e.g., "1.2.0")
 * @returns {number} - 1 if a > b, -1 if a < b, 0 if equal
 */
function compareVersions(a, b) {
  const partsA = a.split('.').map(Number)
  const partsB = b.split('.').map(Number)

  for (let i = 0; i < 3; i++) {
    const numA = partsA[i] || 0
    const numB = partsB[i] || 0
    if (numA > numB) return 1
    if (numA < numB) return -1
  }
  return 0
}

/**
 * Check if a Docker image tag exists on GHCR (anonymous, no credentials needed for public repos).
 * Uses the OCI distribution spec: get a token, then HEAD the manifest.
 */
async function checkGhcrImage(repo, version) {
  try {
    const tokenRes = await fetch(
      `https://ghcr.io/token?service=ghcr.io&scope=repository:${repo}:pull`,
      { headers: { 'User-Agent': 'Slipway' } }
    )
    if (!tokenRes.ok) return false
    const { token } = await tokenRes.json()

    const tag = version
    const manifestRes = await fetch(
      `https://ghcr.io/v2/${repo}/manifests/${tag}`,
      {
        method: 'HEAD',
        headers: {
          'User-Agent': 'Slipway',
          Authorization: `Bearer ${token}`,
          Accept:
            'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.v2+json'
        }
      }
    )
    return manifestRes.ok
  } catch {
    // Network error — don't show banner, next hourly check will retry
    return false
  }
}
