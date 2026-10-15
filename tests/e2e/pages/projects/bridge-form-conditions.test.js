const { test } = require('sounding')
const { setup } = require('../../../support/bridge-conditional-actions')

test(
  'native Bridge hides preview confirmation and requires it only when sending',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'submit-captions' } }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    const state = await setup(sails, world)
    const action =
      state.contract.resources.proposal.actionDefinitions.sendDecision
    delete action.fields.acceptanceMessage
    delete action.fields.reason
    action.fields.send = {
      type: 'boolean',
      label: 'Send this email',
      required: false,
      field: { type: 'boolean', default: false }
    }
    action.fields.confirmRecipients = {
      type: 'number',
      label: 'Confirm recipient count',
      required: true,
      min: 1,
      visibleWhen: { 'form.send': true },
      field: { type: 'number' }
    }
    action.submit = {
      field: 'send',
      whenFalse: {
        label: 'Preview recipients',
        processingLabel: 'Previewing recipients…'
      },
      whenTrue: { label: 'Send email', processingLabel: 'Sending email…' }
    }
    try {
      await login.withPassword('genesisUser', page, {
        password: world.current.auth.genesisUserPassword
      })
      await page.raw.waitForURL((url) => !url.pathname.startsWith('/login'))
      await page.goto(
        '/projects/submit-captions/environments/production/bridge/submission/1'
      )
      const dialog = page.raw.locator(
        '[data-test="bridge-action-dialog-sendDecision"]'
      )
      async function open() {
        await page.raw
          .getByRole('button', {
            name: 'Actions for Building with Sails',
            exact: true
          })
          .click()
        await page.raw
          .getByRole('menuitem', { name: 'Send decision', exact: true })
          .click()
        await expect(dialog).toBeVisible()
      }
      await open()
      const toggle = dialog.getByRole('switch', {
        name: 'Send this email',
        exact: true
      })
      await expect(
        dialog.getByRole('heading', { name: 'Send decision', exact: true })
      ).toBeVisible()
      await expect(
        dialog.getByRole('button', { name: 'Preview recipients', exact: true })
      ).toBeVisible()
      const count = dialog.getByRole('spinbutton', {
        name: 'Confirm recipient count',
        exact: true
      })
      const previewButton = dialog.getByRole('button', {
        name: 'Preview recipients',
        exact: true
      })
      const sendButton = dialog.getByRole('button', {
        name: 'Send email',
        exact: true
      })
      await expect(count).toBeHidden()
      await expect(previewButton).toBeEnabled()
      await dialog.screenshot({
        path: '/Users/koo/Documents/Codex/2026-10-15/task-5/caption-screenshots/form-count-preview.png'
      })
      await toggle.click()
      await expect(count).toBeVisible()
      await expect(dialog.getByText('Optional', { exact: true })).toBeHidden()
      await expect(sendButton).toBeDisabled()
      await dialog.screenshot({
        path: '/Users/koo/Documents/Codex/2026-10-15/task-5/caption-screenshots/form-count-send-required.png'
      })
      await count.fill('18')
      await expect(sendButton).toBeEnabled()
      await toggle.click()
      await expect(count).toBeHidden()
      await expect(previewButton).toBeEnabled()
      await toggle.click()
      await expect(count).toHaveValue('18')
      await count.fill('')
      await count.blur()
      await expect(sendButton).toBeDisabled()
      await toggle.click()
      await expect(previewButton).toBeEnabled()
      await previewButton.click()
      await expect(dialog).toBeHidden()
      expect(state.calls.at(-1).values).toEqual({ send: false })
      await open()
      await toggle.click()
      await count.fill('18')
      await sendButton.click()
      await expect(dialog).toBeHidden()
      expect(state.calls.at(-1).values.confirmRecipients).toBe(18)
    } finally {
      state.restore()
    }
  }
)
