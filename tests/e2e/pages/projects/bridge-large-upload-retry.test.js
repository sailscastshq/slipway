const { test } = require('sounding')
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os')
const { setup, models } = require('../../../support/bridge-conditional-actions')
const materialsAction = require('../../../fixtures/bridge-materials-action.cjs')

test(
  'Bridge 371 MiB upload keeps confirmed progress through blocked responses, recovery and verification retries',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'large-upload-review' } }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const state = await setup(sails, world)
    const contract = await sails.helpers.bridge.normalizeResourceContract.with({
      models,
      config: {
        resources: {
          proposal: { actions: { uploadMaterials: materialsAction } }
        }
      }
    })
    state.contract.resources.proposal.actionDefinitions.uploadMaterials =
      contract.resources.proposal.actionDefinitions.uploadMaterials
    state.contract.resources.proposal.actions.uploadMaterials = true
    const size = 371 * 1024 ** 2,
      partSize = 16 * 1024 ** 2,
      count = Math.ceil(size / partSize)
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-371mib-'))
    const file = path.join(temp, 'synthetic-recording.mp4')
    const fd = fs.openSync(file, 'w')
    fs.ftruncateSync(fd, size)
    fs.closeSync(fd)
    const output = path.resolve('.tmp/screenshots/bridge-large-upload-retry')
    fs.mkdirSync(output, { recursive: true })
    const controls = { prepare: 0, resume: 0, complete: 0, bodies: [] }
    await page.raw.addInitScript(() => {
      // The real File and slice logic are used. Only object-store transport is
      // synthetic; no recording bytes leave the local fixture browser.
      const Native = window.XMLHttpRequest
      const fixture = (window.__bridgeUploadFixture = {
        stored: {},
        attempts: [],
        hold: true,
        fail: true,
        pending: [],
        maxActive: 0,
        active: 0
      })
      fixture.releaseFailures = () => {
        fixture.hold = false
        for (const fail of fixture.pending.splice(0)) fail()
      }
      class StoreXHR extends Native {
        open(method, url, ...rest) {
          if (!String(url).startsWith('https://bridge-upload-fixture.invalid/'))
            return super.open(method, url, ...rest)
          this.fixture = true
          this.part = Number(new URL(url).pathname.split('/').pop())
          this.method = method
        }
        get status() {
          return this.fixture ? this.fixtureStatus || 0 : super.status
        }
        send(blob) {
          if (!this.fixture) return super.send(blob)
          const self = this
          this.blob = blob
          fixture.active++
          fixture.maxActive = Math.max(fixture.maxActive, fixture.active)
          const attempt =
            fixture.attempts.filter((x) => x.part === this.part).length + 1
          fixture.attempts.push({
            part: this.part,
            size: blob.size,
            attempt,
            method: this.method
          })
          const progress = new ProgressEvent('progress', {
            loaded: blob.size,
            total: blob.size,
            lengthComputable: true
          })
          this.upload.dispatchEvent(progress)
          const finish = (kind) => {
            if (self.finished) return
            self.finished = true
            fixture.active--
            self.dispatchEvent(new Event(kind))
          }
          this.fixtureAbort = () => finish('abort')
          if (fixture.fail && this.part !== 1) {
            if (fixture.hold && attempt === 2)
              fixture.pending.push(() => finish('error'))
            else setTimeout(() => finish('error'), 20)
          } else
            setTimeout(() => {
              fixture.stored[this.part] = blob.size
              this.fixtureStatus = 200
              finish('load')
            }, 20)
        }
        abort() {
          if (!this.fixture) return super.abort()
          this.fixtureAbort?.()
        }
      }
      window.XMLHttpRequest = StoreXHR
      // Exercise in-memory resume when browser storage is unavailable.
      const nativeSet = Storage.prototype.setItem
      Storage.prototype.setItem = function (key, value) {
        if (String(key).startsWith('bridge-upload:'))
          throw Error('Fixture storage unavailable')
        return nativeSet.call(this, key, value)
      }
    })
    await page.raw.route('**/fields/recording/upload/*', async (route) => {
      const req = route.request(),
        phase = new URL(req.url()).pathname.split('/').pop(),
        body = req.postDataJSON()
      controls.bodies.push({ phase, body })
      const parts = Array.from({ length: count }, (_, i) => ({
        partNumber: i + 1,
        uploadUrl: `https://bridge-upload-fixture.invalid/part/${i + 1}`
      }))
      if (phase === 'prepare') {
        controls.prepare++
        expect(body.fileSize).toBe(size)
        return route.fulfill({
          json: {
            strategy: 'multipart',
            url: 'https://assets.example.test/synthetic-recording.mp4',
            uploadIntent: 'synthetic-session-intent',
            partSize,
            partCount: count,
            parts
          }
        })
      }
      expect(body.uploadIntent).toBe('synthetic-session-intent')
      const stored = await page.raw.evaluate(
        () => window.__bridgeUploadFixture.stored
      )
      if (phase === 'resume') {
        controls.resume++
        if (controls.resume === 1)
          return route.fulfill({
            status: 400,
            json: {
              message:
                'invalid provider https://private.test?X-Amz-Signature=NEVER_SHOW_THIS'
            }
          })
        const uploadedParts = Object.entries(stored).map(([n, size]) => ({
          partNumber: Number(n),
          size,
          etag: 'synthetic-etag'
        }))
        return route.fulfill({
          json: {
            strategy: 'multipart',
            completed: false,
            uploadedParts,
            parts: parts.filter((p) => !stored[p.partNumber])
          }
        })
      }
      if (phase === 'complete') {
        controls.complete++
        expect(Object.keys(stored).length).toBe(24)
        if (controls.complete === 1)
          return route.fulfill({
            status: 503,
            json: { message: 'SECRET=NEVER_SHOW_THIS' }
          })
        return route.fulfill({
          json: {
            url: 'https://assets.example.test/synthetic-recording.mp4',
            receipt: 'synthetic-receipt'
          }
        })
      }
      throw Error(`Unexpected fixture phase ${phase}`)
    })
    try {
      await login.withPassword('genesisUser', page, {
        password: world.current.auth.genesisUserPassword
      })
      await page.raw.waitForURL((url) => !url.pathname.startsWith('/login'))
      await page.goto(
        '/projects/large-upload-review/environments/production/bridge/submission/1'
      )
      await page.raw
        .getByRole('button', {
          name: 'Actions for Building with Sails',
          exact: true
        })
        .click()
      await page.raw
        .getByRole('menuitem', { name: 'Upload materials', exact: true })
        .click()
      const dialog = page.raw.getByRole('dialog', { name: 'Upload materials' }),
        status = dialog.getByRole('status', {
          name: 'Recorded talk upload status'
        }),
        submit = dialog.getByRole('button', {
          name: 'Upload materials',
          exact: true
        })
      await dialog.locator('input[type="file"]').setInputFiles(file)
      await expect(status).toContainText(
        'Retrying parts 4% · 16 MB of 371 MB confirmed'
      )
      await expect(submit).toBeDisabled()
      const captures = async (phase) => {
        for (const width of [1440, 390])
          for (const colorScheme of ['light', 'dark']) {
            await page.raw.setViewportSize({ width, height: 1000 })
            await page.raw.emulateMedia({
              colorScheme,
              reducedMotion: 'reduce'
            })
            await page.raw.evaluate(() => document.fonts.ready)
            expect(
              await dialog.evaluate(
                (node) => node.scrollWidth <= node.clientWidth + 1
              )
            ).toBe(true)
            await dialog.screenshot({
              path: path.join(output, `${phase}-${width}-${colorScheme}.png`),
              animations: 'disabled'
            })
          }
      }
      await captures('retrying-confirmed-parts')
      await page.raw.evaluate(() =>
        window.__bridgeUploadFixture.releaseFailures()
      )
      await expect(dialog.getByRole('alert')).toContainText(
        'paused while sending parts'
      )
      await expect(dialog.getByRole('alert')).toContainText(
        '16 MB of 371 MB confirmed'
      )
      await expect(dialog.getByRole('alert')).toContainText(
        'Check storage CORS'
      )
      await captures('paused-network')
      expect(controls.prepare).toBe(1)
      await dialog
        .getByRole('button', { name: 'Retry upload', exact: true })
        .click()
      await expect(dialog.getByRole('alert')).toContainText(
        'recovering stored parts'
      )
      await expect(dialog.getByRole('alert')).toContainText('HTTP 400')
      await expect(dialog).not.toContainText('NEVER_SHOW_THIS')
      expect(controls.prepare).toBe(1)
      expect(controls.resume).toBe(1)
      await page.raw.evaluate(() => {
        window.__bridgeUploadFixture.fail = false
      })
      await dialog
        .getByRole('button', { name: 'Retry upload', exact: true })
        .click()
      await expect(dialog.getByRole('alert')).toContainText(
        'verifying the stored file'
      )
      await expect(dialog.getByRole('alert')).toContainText(
        '371 MB of 371 MB confirmed'
      )
      await expect(dialog.getByRole('alert')).toContainText('HTTP 503')
      await expect(dialog).not.toContainText('NEVER_SHOW_THIS')
      await captures('verification-paused')
      const before = await page.raw.evaluate(
        () => window.__bridgeUploadFixture.attempts.length
      )
      await dialog
        .getByRole('button', { name: 'Retry upload', exact: true })
        .click()
      await expect(
        dialog.getByRole('button', { name: 'Replace', exact: true })
      ).toBeVisible()
      await expect(submit).toBeEnabled()
      const result = await page.raw.evaluate(() => ({
        attempts: window.__bridgeUploadFixture.attempts,
        stored: window.__bridgeUploadFixture.stored,
        maxActive: window.__bridgeUploadFixture.maxActive
      }))
      expect(result.attempts.length).toBe(before)
      expect(result.attempts.filter((x) => x.part === 1).length).toBe(1)
      expect(
        result.attempts.every(
          (x) => x.method === 'PUT' && x.size <= partSize && x.size < size
        )
      ).toBe(true)
      expect(result.stored[24]).toBe(3 * 1024 ** 2)
      expect(result.maxActive <= 3).toBe(true)
      expect(controls.prepare).toBe(1)
      expect(controls.resume).toBe(3)
      expect(controls.complete).toBe(2)
      expect(state.calls).toEqual([])
      expect(page).toHaveNoJavascriptErrors()
    } finally {
      await page.raw.goto('about:blank')
      state.restore()
      fs.rmSync(temp, { recursive: true, force: true })
    }
  }
)
