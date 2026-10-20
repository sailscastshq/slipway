const { test } = require('sounding')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { Sails } = require('sails')

for (const environment of ['console', 'production']) {
  test(`${environment} loads the intended collector ownership through Sails`, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'slipway-console-'))
    const app = new Sails()
    let collectorStarts = 0
    try {
      await fs.mkdir(path.join(root, 'config', 'env'), { recursive: true })
      await fs.mkdir(path.join(root, 'api', 'hooks', 'lookout'), {
        recursive: true
      })
      const config = require(`../../../config/env/${environment}`)
      await fs.writeFile(
        path.join(root, 'config', 'env', `${environment}.js`),
        `module.exports = ${JSON.stringify({ hooks: config.hooks || {} })}`
      )
      // The real loader must skip the installed hook in console workers,
      // while preserving it for the resident production process.
      await fs.writeFile(
        path.join(root, 'api', 'hooks', 'lookout', 'index.js'),
        `module.exports = function(sails) { return { initialize: function(done) {
          sails.emit('fixture:collector-started'); done();
        } } }`
      )
      app.on('fixture:collector-started', () => collectorStarts++)
      await new Promise((resolve, reject) =>
        app.load(
          {
            appPath: root,
            environment,
            hooks: {
              orm: false,
              grunt: false,
              sockets: false,
              pubsub: false,
              session: false
            },
            globals: false,
            log: { level: 'error' }
          },
          (error) => (error ? reject(error) : resolve())
        )
      )
      assert.equal(collectorStarts, environment === 'console' ? 0 : 1)
    } finally {
      await new Promise((resolve) => app.lower(resolve))
      await fs.rm(root, { recursive: true, force: true })
    }
  })
}
