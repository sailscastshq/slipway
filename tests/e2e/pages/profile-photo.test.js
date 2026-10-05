const { test } = require('sounding')
const fs = require('node:fs')
const path = require('node:path')

test(
  'own photo upload uses the real form, keeps invalid uploads out of storage and refreshes account avatars',
  { browser: true, world: 'configured-slipway' },
  async ({ sails, world, login, page, expect }) => {
    const sharp = require('sharp')
    const { S3 } = require('@aws-sdk/client-s3')
    const originalStorage = sails.helpers.uploads.getStorageConfig
    const originalPut = S3.prototype.putObject
    const originalDelete = S3.prototype.deleteObject
    const objects = new Map()
    const storage = {
      key: 'local-test-only',
      secret: 'local-test-only',
      bucket: 'profile-fixture',
      region: 'us-east-1',
      publicUrl: 'https://files.example.test'
    }
    sails.helpers.uploads.getStorageConfig = { with: async () => storage }
    S3.prototype.putObject = async function (input) {
      objects.set(input.Key, input.Body)
      return {}
    }
    S3.prototype.deleteObject = async function (input) {
      objects.delete(input.Key)
      return {}
    }
    await page.raw.route('**/profile/photo', async (route) => {
      const request = route.request()
      const boundary = request
        .headers()
        ['content-type']?.match(/boundary=([^;]+)/)?.[1]
      const body = request.postDataBuffer()
      const close = Buffer.from(`--${boundary}--\r\n`)
      const index = body?.lastIndexOf(close)
      if (!boundary || index < 0)
        throw new Error('Expected actual multipart photo upload')
      const ownerOverride = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="userId"\r\n\r\n999999\r\n`
      )
      await route.continue({
        postData: Buffer.concat([
          body.subarray(0, index),
          ownerOverride,
          body.subarray(index)
        ])
      })
    })
    await page.raw.route('https://files.example.test/**', (route) => {
      const key = new URL(route.request().url()).pathname.slice(1)
      return route.fulfill({
        contentType: 'image/webp',
        body: objects.get(key) || Buffer.alloc(0)
      })
    })
    await page.raw.route('**/api/v1/system/check-update', (route) =>
      route.fulfill({ json: { updateAvailable: false } })
    )
    try {
      await login.withPassword('genesisUser', page, {
        password: world.current.auth.genesisUserPassword
      })
      await page.raw.waitForURL('**/')
      await page.goto('/profile')
      const buffer = await sharp({
        create: { width: 640, height: 640, channels: 3, background: '#159bd7' }
      })
        .png()
        .toBuffer()
      await page.raw
        .locator('input[type=file]')
        .setInputFiles({ name: 'profile.png', mimeType: 'image/png', buffer })
      await expect(
        page.raw.getByRole('button', { name: 'Change photo', exact: true })
      ).toBeVisible()
      await expect(
        page.raw.locator('img[data-test="profile-photo-avatar"]')
      ).toBeVisible()
      expect(objects.size).toBe(1)
      const savedKey = [...objects.keys()][0]
      expect(
        savedKey.startsWith(
          `users/${world.current.users.genesisUser.id}/photos/`
        )
      ).toBe(true)
      const metadata = await sharp(objects.get(savedKey)).metadata()
      expect(metadata.format).toBe('webp')
      expect(metadata.width).toBe(512)
      await page.raw
        .locator('input[type=file]')
        .setInputFiles({ name: 'spoof.jpg', mimeType: 'image/jpeg', buffer })
      await expect(page.raw.getByRole('alert')).toContainText(
        'matching file type'
      )
      expect(objects.size).toBe(1)
      expect(objects.has(savedKey)).toBe(true)
      await page.raw.locator('input[type=file]').setInputFiles({
        name: 'active.svg',
        mimeType: 'image/svg+xml',
        buffer: Buffer.from('<svg/>')
      })
      await expect(page.raw.getByRole('alert')).toContainText(
        'Choose a PNG, JPEG or WebP'
      )
      expect(objects.size).toBe(1)
      const output = path.resolve('.tmp/local-review/profile/photo')
      fs.mkdirSync(output, { recursive: true })
      for (const width of [1440, 390]) {
        await page.resize(width, 1000)
        for (const scheme of ['light', 'dark']) {
          await (scheme === 'light' ? page.inLightMode() : page.inDarkMode())
          await page.goto('/profile')
          await expect(
            page.raw.locator('img[data-test="profile-photo-avatar"]')
          ).toBeVisible()
          await page.screenshot(path.join(output, `${width}-${scheme}.png`), {
            animations: 'disabled',
            fullPage: true
          })
        }
      }
    } finally {
      sails.helpers.uploads.getStorageConfig = originalStorage
      S3.prototype.putObject = originalPut
      S3.prototype.deleteObject = originalDelete
    }
  }
)
