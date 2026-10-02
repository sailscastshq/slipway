// Source-inspection fixtures only. No installation, deployment, or database access.
const fs = require('node:fs/promises')
const path = require('node:path')

module.exports = async function writeSource(root, fixture) {
  const directory = path.join(root, fixture.project)
  await fs.mkdir(path.join(directory, 'config/env'), { recursive: true })
  const dependencies = {
    sails: '^1.5.14',
    'sails-hook-orm': '^4.0.3',
    'sails-postgresql': '^5.0.0',
    'sails-hook-slipway': '^0.0.11'
  }
  const config = [
    "datastores: {default: {adapter: 'sails-postgresql', url: process.env.DATABASE_URL}}"
  ]
  if (fixture.redis.role === 'sessions') {
    dependencies['@sailshq/connect-redis'] = '^6.1.3'
    config.push(
      `session: {adapter: '@sailshq/connect-redis', url: process.env.REDIS_URL, secret: process.env.SESSION_SECRET, prefix: ${JSON.stringify(
        fixture.redis.namespace
      )}}`
    )
  } else {
    config.push('hooks: {session: false}')
  }
  await fs.writeFile(
    path.join(directory, 'package.json'),
    JSON.stringify({
      name: fixture.project,
      private: true,
      scripts: { start: fixture.startup },
      dependencies,
      slipway: { readiness: { requiredEnv: fixture.requiredEnv } }
    })
  )
  await fs.writeFile(
    path.join(directory, 'Dockerfile'),
    `FROM ${fixture.runtime}\nWORKDIR /app\nCOPY . .\nCMD ["node", "app.js"]\n`
  )
  await fs.writeFile(
    path.join(directory, 'app.js'),
    "throw new Error('Source-inspection fixture: not a deployable app')\n"
  )
  await fs.writeFile(
    path.join(directory, 'config/env/production.js'),
    `module.exports = {${config.join(',')}}\n`
  )
  return directory
}
