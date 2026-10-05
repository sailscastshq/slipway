const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { Sails } = require('sails')
const defineQuest = require('sails-hook-quest')

for (const reduced of [false, true]) {
  test(
    `registry Quest initializes with ORM ${
      reduced ? 'excluded by loadHooks' : 'disabled'
    }`,
    { timeout: 10000 },
    async (t) => {
      assert.equal(require('sails-hook-quest/package.json').version, '0.0.7')
      const appPath = fs.mkdtempSync(path.join(os.tmpdir(), 'quest-registry-'))
      fs.mkdirSync(path.join(appPath, 'scripts'))
      fs.writeFileSync(
        path.join(appPath, 'package.json'),
        JSON.stringify({ name: 'quest-registry-fixture' })
      )
      fs.writeFileSync(
        path.join(appPath, 'scripts', 'fixture.js'),
        'module.exports={quest:{interval:100000},fn:async()=>true}'
      )
      const app = new Sails()
      t.after(async () => {
        app.quest?.stop()
        await new Promise((resolve) => app.lower(resolve))
        fs.rmSync(appPath, { recursive: true, force: true })
      })
      let loaded = 0
      app.on('hook:quest:loaded', () => {
        loaded++
        assert.ok(app.quest.getRuntime().runtimeId)
      })
      const config = {
        appPath,
        environment: 'test',
        globals: false,
        log: { level: 'silent' },
        hooks: {
          quest: defineQuest,
          orm: false,
          grunt: false,
          session: false,
          sockets: false
        },
        quest: { autoStart: false },
        hookTimeout: 2000,
        ...(reduced
          ? { loadHooks: ['moduleloader', 'userconfig', 'userhooks', 'quest'] }
          : {})
      }
      await new Promise((resolve, reject) =>
        app.load(config, (error) => (error ? reject(error) : resolve()))
      )
      assert.equal(loaded, 1)
      assert.equal(app.hooks.orm, undefined)
      assert.equal(app.config.quest.autoStart, false)
      assert.equal(app.quest.metadata('fixture').scheduled, false)
      assert.equal(app.quest.isRunning('fixture'), false)
    }
  )
}
