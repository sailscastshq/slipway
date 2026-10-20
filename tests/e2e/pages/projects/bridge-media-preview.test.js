const { test } = require('sounding')
const assert = require('node:assert/strict')
const fs = require('node:fs'),
  path = require('node:path')
const { setup } = require('../../../support/bridge-conditional-actions')

test(
  'Native Bridge previews authenticated video ranges and PDF in a dismissible responsive dialog',
  {
    browser: { launchOptions: { channel: 'chromium' } },
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'media-preview' } }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const state = await setup(sails, world)
    const resolve = sails.helpers.bridge.resolveRequest
    sails.helpers.bridge.resolveRequest = {
      with: async (args) => ({
        ...(await resolve.with(args)),
        bridgeHostOrigin: true
      })
    }
    const action =
      state.contract.resources.proposal.actionDefinitions.sendDecision
    action.fields = {}
    action.label = 'Preview material'
    delete action.visibleWhen
    let type = 'video',
      denied = false
    state.target.helpers.bridge.decision = {
      with: async () => ({
        preview: {
          type,
          title: type === 'video' ? 'Recorded talk' : 'Speaker slides',
          url: '/api/talk-assets/asset-1/preview'
        }
      })
    }
    const root = path.resolve('.tmp/sounding/artifacts/bridge-media-preview')
    fs.mkdirSync(root, { recursive: true })
    const requests = []
    try {
      await login.withPassword('genesisUser', page, {
        password: world.current.auth.genesisUserPassword
      })
      await page.raw.waitForURL((url) => !url.pathname.startsWith('/login'))
      const bytes = Buffer.from(
        await page.raw.evaluate(async () => {
          const canvas = document.createElement('canvas')
          canvas.width = 640
          canvas.height = 360
          const context = canvas.getContext('2d')
          context.fillStyle = '#132a3a'
          context.fillRect(0, 0, 640, 360)
          context.fillStyle = '#ffffff'
          context.font = '32px sans-serif'
          context.fillText('Recorded talk · safe fixture', 80, 180)
          const stream = canvas.captureStream(5),
            recorder = new MediaRecorder(stream, { mimeType: 'video/webm' }),
            chunks = []
          const done = new Promise((resolve) => {
            recorder.ondataavailable = (e) => chunks.push(e.data)
            recorder.onstop = async () =>
              resolve(
                Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()))
              )
          })
          recorder.start()
          for (let frame = 0; frame < 10; frame++) {
            context.fillStyle = '#38bdf8'
            context.fillRect(80 + frame * 40, 240, 30, 6)
            await new Promise((resolve) => setTimeout(resolve, 100))
          }
          recorder.stop()
          stream.getTracks().forEach((t) => t.stop())
          return done
        })
      )
      const pdf = pdfFixture()
      await page.raw.route(
        '**/api/talk-assets/asset-1/preview',
        async (route) => {
          const request = route.request(),
            headers = await request.allHeaders()
          assert(
            headers.cookie,
            'Private preview requests must carry the existing session'
          )
          requests.push({
            method: request.method(),
            range: headers.range,
            type
          })
          if (denied)
            return route.fulfill({
              status: 403,
              contentType: 'text/plain',
              body: 'Forbidden'
            })
          const body = type === 'video' ? bytes : pdf
          const responseHeaders = {
            'Content-Type': type === 'video' ? 'video/webm' : 'application/pdf',
            'Content-Length': String(body.length),
            'Content-Disposition': 'inline',
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'private, no-store',
            'Accept-Ranges': 'bytes'
          }
          if (request.method() === 'HEAD')
            return route.fulfill({ status: 200, headers: responseHeaders })
          if (headers.range) {
            const start = Number(headers.range.match(/^bytes=(\d+)-/)?.[1] || 0)
            return route.fulfill({
              status: 206,
              headers: {
                ...responseHeaders,
                'Content-Range': `bytes ${start}-${body.length - 1}/${
                  body.length
                }`,
                'Content-Length': String(body.length - start)
              },
              body: body.subarray(start)
            })
          }
          return route.fulfill({ status: 200, headers: responseHeaders, body })
        }
      )
      await page.goto(
        '/projects/media-preview/environments/production/bridge/submission/1'
      )
      const trigger = page.raw.getByRole('button', {
        name: 'Actions for Building with Sails',
        exact: true
      })
      async function open() {
        await trigger.click()
        await page.raw
          .getByRole('menuitem', { name: 'Preview material', exact: true })
          .click()
      }
      await open()
      const dialog = page.raw.getByRole('dialog', {
        name: 'Recorded talk',
        exact: true
      })
      await expect(dialog).toBeVisible()
      const player = dialog.locator('video')
      await expect(player).toBeVisible()
      await page.raw.waitForFunction(
        () => document.querySelector('dialog video')?.readyState > 0
      )
      assert(requests.some((r) => r.method === 'HEAD'))
      assert(requests.some((r) => r.method === 'GET' && r.range))
      const handle = await player.elementHandle()
      await player.evaluate((el) => {
        el.muted = true
        el.currentTime = 0
        return el.play()
      })
      await page.raw.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
      await page.raw.waitForFunction(
        (el) => el.paused && !el.hasAttribute('src'),
        handle
      )
      await expect(trigger).toBeFocused()
      for (const kind of ['video', 'pdf']) {
        type = kind
        const pdfResponse =
          kind === 'pdf'
            ? page.raw.waitForResponse(
                (response) =>
                  response.request().method() === 'GET' &&
                  response.url().includes('/api/talk-assets/asset-1/preview')
              )
            : null
        await open()
        const modal = page.raw.getByRole('dialog', {
          name: kind === 'video' ? 'Recorded talk' : 'Speaker slides',
          exact: true
        })
        await expect(
          modal.locator(kind === 'video' ? 'video' : 'iframe')
        ).toBeVisible()
        if (pdfResponse) await pdfResponse
        let pdfBlob
        if (kind === 'pdf') {
          const frame = await (
            await modal.locator('iframe').elementHandle()
          ).contentFrame()
          await frame.waitForURL((url) => url.protocol === 'blob:')
          await frame.waitForLoadState('load')
          pdfBlob = await modal.locator('iframe').getAttribute('src')
          await frame.waitForLoadState('networkidle')
        }
        for (const width of [1440, 390]) {
          await page.raw.setViewportSize({ width, height: 1000 })
          for (const colorScheme of ['light', 'dark']) {
            await page.raw.emulateMedia({
              colorScheme,
              reducedMotion: 'reduce'
            })
            await modal.screenshot({
              path: path.join(root, `${kind}-${width}-${colorScheme}.png`),
              animations: 'disabled'
            })
          }
        }
        await modal
          .getByRole('button', { name: 'Close preview', exact: true })
          .click()
        await expect(modal).toBeHidden()
        if (pdfBlob)
          assert(
            await page.raw.evaluate(async (url) => {
              try {
                await fetch(url)
                return false
              } catch {
                return true
              }
            }, pdfBlob)
          )
      }
      denied = true
      await open()
      await expect(page.raw.getByRole('alert')).toContainText(
        'access has expired'
      )
      await expect(page.raw.locator('dialog video, dialog iframe')).toHaveCount(
        0
      )
    } finally {
      state.restore()
    }
  }
)

function pdfFixture() {
  const stream =
    'BT /F1 30 Tf 50 270 Td (Speaker slides) Tj 0 -60 Td /F1 16 Tf (Safe local PDF preview fixture) Tj ET'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 400] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]
  let result = '%PDF-1.4\n'
  const offsets = [0]
  for (const [i, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(result))
    result += `${i + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = Buffer.byteLength(result)
  result += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((o) => String(o).padStart(10, '0') + ' 00000 n \n')
    .join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(result)
}
