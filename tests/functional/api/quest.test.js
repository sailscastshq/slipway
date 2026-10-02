const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const childProcess = require('node:child_process')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const { test } = require('sounding')
const { withCsrfFromPage } = require('../../support/csrf-request')

test(
  'Quest persists real legacy receipts and successful stderr, but not unconfirmed process outcomes',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'quest-legacy-receipts' } }
    }
  },
  async ({ sails, world, request, visit, expect }) => {
    const current = world.current
    const environment = current.environments.production
    await sails.models.environment.updateOne({ id: environment.id }).set({
      features: { 'sails-quest': { scripts: [{ name: 'synthetic-index' }] } }
    })
    await sails.models.app.updateOne({ id: current.apps.web.id }).set({
      status: 'running',
      containerName: 'synthetic-container-never-executed'
    })
    // A disposable shell fixture ignores every argument. No Docker or Sails job
    // is invoked; only stdout/stderr and the local client's exit are simulated.
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quest-receipt-'))
    const binaryPath = path.join(directory, 'synthetic-client')
    const originalDocker = sails.config.docker
    sails.config.docker = { ...originalDocker, binaryPath }
    const writeClient = (body) =>
      fs.writeFileSync(binaryPath, `#!/bin/sh\n${body}\n`, { mode: 0o755 })
    const pagePath = '/projects/quest-legacy-receipts/quest'
    const url =
      '/api/v1/projects/quest-legacy-receipts/quest/jobs/synthetic-index/run'

    try {
      const browser = await withCsrfFromPage(request, pagePath, 'genesisUser')
      writeClient(
        "printf '\\033[32msynthetic output\\033[0m\\n'\nprintf 'synthetic warning\\n' >&2\nexit 0"
      )
      const success = await browser.request.post(url, {})
      expect(success).toHaveStatus(200)
      expect(success).toHaveJsonPath('success', true)
      expect(success).toHaveJsonPath('exitCode', 0)
      expect(success).toHaveJsonPath('output', 'synthetic output')
      expect(success).toHaveJsonPath('stderr', 'synthetic warning')
      expect(success).toHaveJsonPath('error', null)
      let history = await sails.helpers.quest.getJobHistory(environment.id)
      expect(history.length).toBe(1)
      expect(history[0].event).toBe('completed')
      expect(history[0].stderr).toBe('synthetic warning')
      expect(history[0].error).toBe(null)

      writeClient("printf 'synthetic failure\\n' >&2\nexit 7")
      const failure = await browser.request.post(url, {})
      expect(failure).toHaveJsonPath('success', false)
      expect(failure).toHaveJsonPath('exitCode', 7)
      history = await sails.helpers.quest.getJobHistory(environment.id)
      expect(history.length).toBe(2)
      expect(history[0].event).toBe('failed')
      expect(history[0].error).toBe('synthetic failure')

      writeClient("printf 'partial output\\n'\nkill -TERM $$")
      const interrupted = await browser.request.post(url, {})
      expect(interrupted).toHaveStatus(200)
      expect(interrupted).toHaveJsonPath('exitCode', null)
      expect(interrupted).toHaveJsonPath('signal', 'SIGTERM')
      expect(interrupted).toHaveJsonPath('output', 'partial output')
      expect(
        (await sails.helpers.quest.getJobHistory(environment.id)).length
      ).toBe(2)

      // Node's built-in spawn timeout retains a five-minute timer for ENOENT.
      // Emit that failure synthetically rather than holding up the test process.
      const originalSpawn = childProcess.spawn
      try {
        childProcess.spawn = () => {
          const client = new EventEmitter()
          client.stdout = new PassThrough()
          client.stderr = new PassThrough()
          setImmediate(() => {
            client.emit('error', new Error('Synthetic client unavailable'))
            client.emit('close', -2, null)
          })
          return client
        }
        const spawnError = await browser.request.post(url, {})
        expect(spawnError).toHaveStatus(200)
        expect(spawnError).toHaveJsonPath('exitCode', null)
        expect(
          (await sails.helpers.quest.getJobHistory(environment.id)).length
        ).toBe(2)
      } finally {
        childProcess.spawn = originalSpawn
      }

      // A request rejected before execution also leaves the ledger untouched.
      await sails.models.app
        .updateOne({ id: current.apps.web.id })
        .set({ status: 'stopped' })
      const rejected = await browser.request.post(url, {})
      expect(rejected).toHaveStatus(400)
      expect(
        (await sails.helpers.quest.getJobHistory(environment.id)).length
      ).toBe(2)

      await sails.models.telemetrymetric.createEach([
        {
          name: 'quest.job.complete',
          value: 12,
          unit: 'ms',
          environment: environment.id,
          recordedAt: Date.now() + 1,
          attributes: { jobName: 'synthetic-index' }
        },
        {
          name: 'quest.job.error',
          value: 13,
          unit: 'ms',
          environment: environment.id,
          recordedAt: Date.now() + 2,
          attributes: {
            jobName: 'synthetic-index',
            error: 'scheduled diagnostic'
          }
        }
      ])
      const page = await visit.as('genesisUser')(pagePath)
      expect(page).toHaveStatus(200)
      expect(page).toHaveInertiaProp('jobHistory.0.event', 'failed')
      expect(page).toHaveInertiaProp(
        'jobHistory.0.error',
        'scheduled diagnostic'
      )
      expect(page).toHaveInertiaProp('jobHistory.1.event', 'completed')
      expect(page).toHaveInertiaProp('jobHistory.1.legacy', true)
      expect(page).toHaveInertiaProp('jobHistory.3.stderr', 'synthetic warning')
    } finally {
      sails.config.docker = originalDocker
      fs.rmSync(directory, { recursive: true, force: true })
    }
  }
)
