const { test } = require('sounding')
const { setup } = require('../../../support/bridge-conditional-actions')

test(
  'native Bridge follows the toggle and freezes the submitted intent in loading captions',
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
    action.fields.send = {
      type: 'boolean',
      label: 'Send this email',
      required: false,
      field: { type: 'boolean', default: false }
    }
    action.submit = {
      field: 'send',
      whenFalse: {
        label: 'Preview recipients',
        processingLabel: 'Previewing recipients…'
      },
      whenTrue: { label: 'Send email', processingLabel: 'Sending email…' }
    }
    const originalExecute = sails.helpers.bridge.executeInContainer
    let release
    let pending
    sails.helpers.bridge.executeInContainer = async (container, code) => {
      if (code.includes('const helperIdentity =')) await pending
      return originalExecute(container, code)
    }
    const waitForRelease = () => {
      pending = new Promise((resolve) => {
        release = resolve
      })
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
      await toggle.click()
      await expect(
        dialog.getByRole('button', { name: 'Send email', exact: true })
      ).toBeVisible()
      await toggle.click()
      waitForRelease()
      await dialog
        .getByRole('button', { name: 'Preview recipients', exact: true })
        .click({ noWaitAfter: true })
      const previewing = dialog.getByRole('button', {
        name: 'Previewing recipients…',
        exact: true
      })
      await expect(previewing).toBeVisible()
      await expect(previewing).toBeDisabled()
      await toggle.click()
      await expect(previewing).toBeVisible()
      release()
      await expect(dialog).toBeHidden()
      expect(state.calls.at(-1).values.send).toBe(false)
      await open()
      await toggle.click()
      waitForRelease()
      await dialog
        .getByRole('button', { name: 'Send email', exact: true })
        .click({ noWaitAfter: true })
      const sending = dialog.getByRole('button', {
        name: 'Sending email…',
        exact: true
      })
      await expect(sending).toBeVisible()
      await expect(sending).toBeDisabled()
      await toggle.click()
      await expect(sending).toBeVisible()
      release()
      await expect(dialog).toBeHidden()
      expect(state.calls.at(-1).values.send).toBe(true)
    } finally {
      release?.()
      state.restore()
    }
  }
)
