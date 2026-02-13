const fs = require('fs')
const path = require('path')

module.exports = {
  friendlyName: 'Generate checklist',

  description: 'Generate an advisory deployment checklist for an environment.',

  inputs: {
    environmentId: {
      type: 'string',
      required: true
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ environmentId }) {
    const environment = await Environment.findOne({ id: environmentId })
      .populate('services')
      .populate('project')
      .decrypt()

    if (!environment) return []

    const envVars = environment.envVars || {}
    const services = environment.services || []
    const checks = []

    const hasServiceOfType = (type) => services.some(s => s.type === type && s.status === 'running')

    // Detect what the app requires from its package.json
    const requirements = detectRequirements(environment.project.slug)

    // SESSION_SECRET check
    if (!envVars.SESSION_SECRET) {
      checks.push({
        key: 'session-secret',
        label: 'Your app needs a SESSION_SECRET to secure user sessions',
        severity: 'warning',
        suggestion: 'Without it, sessions use an insecure default. Generate a random secret below.',
        action: { type: 'generate-session-secret', label: 'Generate' }
      })
    }

    // App requires a database but no service is running
    if (requirements.database && !hasServiceOfType('postgresql') && !hasServiceOfType('mysql') && !hasServiceOfType('mongodb')) {
      checks.push({
        key: 'app-needs-database',
        label: `Your app requires a database (${requirements.databaseAdapter}) but no database service is running`,
        severity: 'warning',
        suggestion: 'Create a database service to store your application data.',
        action: { type: 'add-service', label: 'Add database' }
      })
    }

    // App requires Redis but no service is running
    if (requirements.redis && !hasServiceOfType('redis')) {
      const isForSessions = requirements.redisAdapter === '@sailshq/connect-redis'
      checks.push({
        key: 'app-needs-redis',
        label: isForSessions
          ? `Your app uses Redis for session storage (${requirements.redisAdapter}) but no Redis service is running`
          : `Your app uses Redis (${requirements.redisAdapter}) but no Redis service is running`,
        severity: 'warning',
        suggestion: isForSessions
          ? 'Create a Redis service for production session management. Without it, sessions are stored in memory and lost on restart.'
          : 'Create a Redis service from the Services section below.',
        action: { type: 'add-service', label: 'Add Redis', serviceType: 'redis' }
      })
    }

    // DATABASE_URL set but no database service running (skip if already covered by app-needs-database)
    if (envVars.DATABASE_URL && !requirements.database && !hasServiceOfType('postgresql') && !hasServiceOfType('mysql') && !hasServiceOfType('mongodb')) {
      checks.push({
        key: 'db-url-no-service',
        label: 'DATABASE_URL is set but no database service is running',
        severity: 'warning',
        suggestion: 'Create a database service, or verify the external database is reachable.',
        action: { type: 'add-service', label: 'Add database' }
      })
    }

    // REDIS_URL set but no Redis service (skip if already covered by app-needs-redis)
    if (envVars.REDIS_URL && !requirements.redis && !hasServiceOfType('redis')) {
      checks.push({
        key: 'redis-url-no-service',
        label: 'REDIS_URL is set but no Redis service is running',
        severity: 'warning',
        suggestion: 'Create a Redis service, or verify the external Redis is reachable.',
        action: { type: 'add-service', label: 'Add Redis', serviceType: 'redis' }
      })
    }

    // Database service exists but DATABASE_URL missing (PostgreSQL/MySQL only — MongoDB handled separately)
    if ((hasServiceOfType('postgresql') || hasServiceOfType('mysql')) && !envVars.DATABASE_URL) {
      checks.push({
        key: 'db-service-no-url',
        label: 'Database service exists but DATABASE_URL is missing',
        severity: 'warning',
        suggestion: 'The connection URL should have been auto-injected. Check env vars or re-create the service.',
        action: { type: 'open-env-vars', label: 'View env vars' }
      })
    }

    // Redis service exists but REDIS_URL missing
    if (hasServiceOfType('redis') && !envVars.REDIS_URL) {
      checks.push({
        key: 'redis-service-no-url',
        label: 'Redis service is running but REDIS_URL is missing',
        severity: 'warning',
        suggestion: 'The connection URL should have been auto-injected. Check env vars or re-create the service.',
        action: { type: 'open-env-vars', label: 'View env vars' }
      })
    }

    // MongoDB service exists but DATABASE_URL missing
    if (hasServiceOfType('mongodb') && !envVars.DATABASE_URL) {
      checks.push({
        key: 'mongo-service-no-url',
        label: 'MongoDB service is running but DATABASE_URL is missing',
        severity: 'warning',
        suggestion: 'The connection URL should have been auto-injected. Check env vars or re-create the service.',
        action: { type: 'open-env-vars', label: 'View env vars' }
      })
    }

    // Production with no services at all (only if we couldn't detect specific requirements)
    if (environment.isProduction && services.length === 0 && !requirements.database && !requirements.redis) {
      checks.push({
        key: 'prod-no-services',
        label: 'Production environment has no services',
        severity: 'info',
        suggestion: 'Most production apps need a database and session store. Consider adding PostgreSQL and Redis.',
        action: { type: 'add-service', label: 'Add service' }
      })
    }

    // All good
    if (checks.length === 0) {
      checks.push({
        key: 'all-good',
        label: 'Environment is configured correctly',
        severity: 'success',
        suggestion: null
      })
    }

    return checks
  }
}

/**
 * Read the project's package.json to detect database and Redis requirements.
 * Returns { database: bool, databaseAdapter: string, redis: bool, redisAdapter: string }
 */
function detectRequirements(projectSlug) {
  const result = { database: false, databaseAdapter: null, redis: false, redisAdapter: null }

  try {
    const appPath = path.join(sails.config.custom.slipwayAppsDir, projectSlug)
    const pkgPath = path.join(appPath, 'package.json')
    if (!fs.existsSync(pkgPath)) return result

    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }

    // Database adapter detection
    const dbAdapters = [
      ['sails-postgresql', 'sails-postgresql'],
      ['sails-mysql', 'sails-mysql'],
      ['sails-mongo', 'sails-mongo'],
      ['pg', 'pg (PostgreSQL)'],
      ['mysql2', 'mysql2'],
      ['mongoose', 'mongoose (MongoDB)'],
      ['mongodb', 'mongodb']
    ]
    for (const [pkg, label] of dbAdapters) {
      if (deps[pkg]) {
        result.database = true
        result.databaseAdapter = label
        break
      }
    }

    // Redis detection (connect-redis first since it's the most common in Sails apps)
    const redisAdapters = [
      ['@sailshq/connect-redis', '@sailshq/connect-redis'],
      ['ioredis', 'ioredis'],
      ['redis', 'redis'],
      ['@redis/client', '@redis/client'],
      ['sails-redis', 'sails-redis']
    ]
    for (const [pkg, label] of redisAdapters) {
      if (deps[pkg]) {
        result.redis = true
        result.redisAdapter = label
        break
      }
    }
  } catch {
    // Source not available yet — that's fine, skip detection
  }

  return result
}
