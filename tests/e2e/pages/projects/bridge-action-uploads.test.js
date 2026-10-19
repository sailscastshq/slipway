const { test } = require('sounding')
const fs = require('node:fs')
const path = require('node:path')
const { setup, models } = require('../../../support/bridge-conditional-actions')
const materialsAction = require('../../../fixtures/bridge-materials-action.cjs')

for (const browser of ['desktop', 'mobile']) {
  test(
    `Bridge Upload materials reuses verified uploads in the action modal on ${browser}`,
    {
      browser,
      world: {
        name: 'configured-slipway',
        context: { deploymentTarget: { slug: `action-upload-${browser}` } }
      }
    },
    async ({ sails, world, login, page, expect }) => {
      const state = await setup(sails, world)
      const normalized =
        await sails.helpers.bridge.normalizeResourceContract.with({
          models,
          config: {
            resources: {
              proposal: { actions: { uploadMaterials: materialsAction } }
            }
          }
        })
      state.contract.resources.proposal.actionDefinitions.uploadMaterials =
        normalized.resources.proposal.actionDefinitions.uploadMaterials
      state.contract.resources.proposal.actions.uploadMaterials = true
      state.target.helpers.bridge.uploadMaterials = {
        with: async (inputs) => {
          state.calls.push(inputs)
          return {}
        }
      }
      const originalStorage = sails.helpers.bridge.getUploadStorageConfig
      const originalDirect = sails.helpers.bridge.directUploadStorage
      const content = Buffer.from(
        '%PDF-1.7\nSynthetic local talk slides\n%%EOF'
      )
      let putFinished = false,
        releasePut
      const pending = new Promise((resolve) => {
        releasePut = resolve
      })
      sails.helpers.bridge.getUploadStorageConfig = {
        with: async () => ({
          publicUrl: 'https://assets.example.test',
          bucket: 'sailsconf-private-fixture'
        })
      }
      sails.helpers.bridge.directUploadStorage = {
        with: async (args) => {
          if (args.operation === 'signPut') {
            expect(args.storage.bucket).toBe('sailsconf-private-fixture')
            expect(args.objectPath).toContain(
              'talk-material-uploads/1/building-with-sails-'
            )
            return {
              uploadUrl: 'https://upload.example.test/material',
              expiresInSeconds: 3600
            }
          }
          if (args.operation === 'head') {
            if (!putFinished)
              throw new Error('The fixture upload has not finished.')
            return {
              size: content.length,
              type: 'application/pdf',
              etag: 'fixture-etag'
            }
          }
          throw new Error(
            `Unexpected fixture storage operation ${args.operation}`
          )
        }
      }
      try {
        await page.raw.route(
          'https://upload.example.test/material',
          async (route) => {
            if (route.request().method() === 'OPTIONS')
              return route.fulfill({
                status: 204,
                headers: {
                  'Access-Control-Allow-Origin': '*',
                  'Access-Control-Allow-Methods': 'PUT, OPTIONS',
                  'Access-Control-Allow-Headers': 'content-type'
                }
              })
            expect(route.request().method()).toBe('PUT')
            expect(route.request().postDataBuffer()).toEqual(content)
            await pending
            putFinished = true
            await route.fulfill({
              status: 200,
              headers: {
                'Access-Control-Allow-Origin': '*',
                ETag: 'fixture-etag'
              }
            })
          }
        )
        await login.withPassword('genesisUser', page, {
          password: world.current.auth.genesisUserPassword
        })
        await page.raw.waitForURL((url) => !url.pathname.startsWith('/login'))
        await page.raw.setViewportSize({
          width: browser === 'mobile' ? 390 : 1440,
          height: browser === 'mobile' ? 844 : 1000
        })
        await page.goto(
          `/projects/action-upload-${browser}/environments/production/bridge/submission/1`
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
        const dialog = page.raw.getByRole('dialog', {
          name: 'Upload materials'
        })
        const submit = dialog.getByRole('button', {
          name: 'Upload materials',
          exact: true
        })
        await expect(
          dialog.getByRole('button', { name: 'Choose file', exact: true })
        ).toBeVisible()
        await expect(submit).toBeDisabled()
        await expect(dialog).toHaveCSS('opacity', '1')
        await expect(dialog.locator('..')).toHaveCSS('opacity', '1')
        const output = path.resolve('.tmp/screenshots/bridge-action-uploads')
        fs.mkdirSync(output, { recursive: true })
        for (const colorScheme of ['light', 'dark']) {
          await page.raw.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
          await page.raw.screenshot({
            path: path.join(output, `modal-${browser}-${colorScheme}.png`)
          })
        }
        await dialog.getByRole('combobox', { name: 'Material type' }).click()
        await page.raw.getByRole('option', { name: /slides/i }).click()
        await dialog.locator('input[type="file"]').setInputFiles({
          name: 'talk-slides.pdf',
          mimeType: 'application/pdf',
          buffer: content
        })
        await expect(
          dialog.getByRole('status', { name: 'Slides upload status' })
        ).toBeVisible()
        await expect(submit).toBeDisabled()
        releasePut()
        await expect(
          dialog.getByRole('button', { name: 'Replace', exact: true })
        ).toBeVisible()
        await expect(submit).toBeEnabled()
        await submit.click()
        await expect(dialog).toHaveCount(0)
        expect(state.calls.length).toBe(1)
        expect(state.calls[0].slides).toContain(
          'https://assets.example.test/talk-material-uploads/1/'
        )
        expect(state.calls[0].materialType).toBe('slides')
        expect(Object.hasOwn(state.calls[0], 'recording')).toBe(false)
        expect(state.calls[0].recordId).toBe(1)
      } finally {
        releasePut()
        sails.helpers.bridge.getUploadStorageConfig = originalStorage
        sails.helpers.bridge.directUploadStorage = originalDirect
        state.restore()
      }
    }
  )
}
