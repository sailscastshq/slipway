const fs = require('fs')
const path = require('path')

module.exports = {
  friendlyName: 'Detect Sails features',

  description:
    'Analyze package.json to detect installed Sails features like sails-content, sails-quest, etc.',

  inputs: {
    appPath: {
      type: 'string',
      required: true,
      description: 'Path to the Sails application directory'
    }
  },

  exits: {
    success: {
      description: 'Features detected successfully.'
    }
  },

  fn: async function ({ appPath }) {
    const features = {}
    const packageJsonPath = path.join(appPath, 'package.json')

    // Read package.json
    let packageJson
    try {
      const content = fs.readFileSync(packageJsonPath, 'utf8')
      packageJson = JSON.parse(content)
    } catch (err) {
      sails.log.warn(
        `[sails/detect-features] Could not read package.json: ${err.message}`
      )
      return features
    }

    const deps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies
    }

    // Detect sails-content
    if (deps['sails-content'] || deps['sails-hook-content']) {
      const contentDir = detectContentDir(appPath)
      features['sails-content'] = {
        version: deps['sails-content'] || deps['sails-hook-content'],
        contentDir: contentDir || 'content',
        collections: contentDir
          ? listCollections(path.join(appPath, contentDir))
          : []
      }
      sails.log.info(
        `[sails/detect-features] Detected sails-content (contentDir: ${
          contentDir || 'content'
        })`
      )
    }

    // Detect sails-quest (job queues)
    if (deps['sails-quest'] || deps['sails-hook-quest']) {
      const scripts = listScripts(appPath)
      features['sails-quest'] = {
        version: deps['sails-quest'] || deps['sails-hook-quest'],
        scripts
      }
      sails.log.info(
        `[sails/detect-features] Detected sails-quest (${scripts.length} scripts)`
      )
    }

    // Detect sails-hook-uploads
    if (deps['sails-hook-uploads']) {
      features['sails-hook-uploads'] = {
        version: deps['sails-hook-uploads']
      }
      sails.log.info(`[sails/detect-features] Detected sails-hook-uploads`)
    }

    // Detect sails-stash (caching)
    if (deps['sails-stash']) {
      features['sails-stash'] = {
        version: deps['sails-stash']
      }
      sails.log.info(`[sails/detect-features] Detected sails-stash`)
    }

    // Detect database adapter requirements
    const dbAdapters = {
      'sails-postgresql': 'postgresql',
      'sails-mysql': 'mysql',
      'sails-mongo': 'mongodb',
      pg: 'postgresql',
      mysql2: 'mysql',
      mongoose: 'mongodb',
      mongodb: 'mongodb'
    }
    for (const [pkg, type] of Object.entries(dbAdapters)) {
      if (deps[pkg]) {
        features['requires-database'] = { adapter: pkg, type }
        sails.log.info(
          `[sails/detect-features] Detected database requirement: ${pkg} (${type})`
        )
        break
      }
    }

    // Detect Redis requirements (connect-redis first — most common in Sails apps for sessions)
    const redisAdapters = [
      '@sailshq/connect-redis',
      'ioredis',
      'redis',
      '@redis/client',
      'sails-redis'
    ]
    for (const pkg of redisAdapters) {
      if (deps[pkg]) {
        features['requires-redis'] = { adapter: pkg }
        sails.log.info(
          `[sails/detect-features] Detected Redis requirement: ${pkg}`
        )
        break
      }
    }

    return features
  }
}

/**
 * Detect the content directory from config or default
 */
function detectContentDir(appPath) {
  // Check for custom config in config/content.js
  const configPath = path.join(appPath, 'config', 'content.js')
  if (fs.existsSync(configPath)) {
    try {
      // Simple regex to extract inputDir from config
      const configContent = fs.readFileSync(configPath, 'utf8')
      const match = configContent.match(/inputDir:\s*['"]([^'"]+)['"]/i)
      if (match) {
        return match[1]
      }
    } catch (err) {
      // Ignore config parse errors
    }
  }

  // Check if default 'content' directory exists
  if (fs.existsSync(path.join(appPath, 'content'))) {
    return 'content'
  }

  return null
}

/**
 * List scripts in the scripts directory
 */
function listScripts(appPath) {
  const scriptsPath = path.join(appPath, 'scripts')
  const scripts = []

  if (!fs.existsSync(scriptsPath)) {
    return scripts
  }

  try {
    const entries = fs.readdirSync(scriptsPath, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.js')) {
        scripts.push({
          name: entry.name.replace('.js', ''),
          filename: entry.name
        })
      }
    }
  } catch (err) {
    sails.log.warn(
      `[sails/detect-features] Could not list scripts: ${err.message}`
    )
  }

  return scripts
}

/**
 * List collections (top-level directories) in the content directory
 */
function listCollections(contentPath) {
  const collections = []

  if (!fs.existsSync(contentPath)) {
    return collections
  }

  try {
    const entries = fs.readdirSync(contentPath, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        // Count markdown files in collection
        const collectionPath = path.join(contentPath, entry.name)
        const files = fs
          .readdirSync(collectionPath)
          .filter((f) => f.endsWith('.md'))
        collections.push({
          name: entry.name,
          count: files.length
        })
      }
    }
  } catch (err) {
    sails.log.warn(
      `[sails/detect-features] Could not list collections: ${err.message}`
    )
  }

  return collections
}
