const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

// Real navigation, input, EventSource, HTTP admission, detail/log reads and pixels.
// No route.fulfill, runtime double or browser component-state injection.
async function realBrowserFlow(
  { page, login, world, expect },
  { slug, base, runtimeId }
) {
  const root = path.resolve('.tmp/screenshots/quest-real-resident')
  await fs.mkdir(root, { recursive: true })
  const captureInspection = async (filename) => {
    // Move focus and the pointer off action controls before the review image.
    // This dismisses their real transient tooltips without modifying the UI.
    await page.raw.getByRole('heading', { name: 'Quest', exact: true }).click()
    await expect(page.raw.getByRole('tooltip')).toHaveCount(0)
    await page.screenshot(path.join(root, filename), { fullPage: true })
  }
  const logReads = []
  const observeRequest = (request) => {
    if (
      request.url().includes(`${base}/runs/`) &&
      request.url().endsWith('/logs')
    )
      logReads.push(request.url())
  }
  page.raw.on('request', observeRequest)
  await page.raw.setViewportSize({ width: 1440, height: 1000 })
  await page.raw.emulateMedia({ colorScheme: 'light' })
  await login.withPassword('genesisUser', page, {
    password: world.current.auth.genesisUserPassword
  })
  await page.raw.waitForURL('**/')
  await page.goto(`/projects/${slug}/quest?job=rebuild-search-index`)
  const opener = page.raw.locator(
    '[data-test="quest-job-detail"] [data-test="quest-open-run"]'
  )
  await expect(opener).toBeEnabled({ timeout: 25000 })
  await expect(
    page.raw.getByRole('button', { name: 'View slow-overlap', exact: true })
  ).toContainText('Every 2 seconds')
  await opener.click()
  const form = page.raw.locator('[data-test="quest-run-form"]')
  await expect(form).toBeVisible()
  await page.raw.locator('#quest-input-0').click()
  await page.raw.getByRole('option', { name: 'articles', exact: true }).click()
  await page.raw.locator('#quest-input-1').fill('200')
  await expect(page.raw.locator('#quest-input-2')).toContainText('True')
  await page.raw.locator('[data-test="quest-production-confirm"]').check()
  await page.screenshot(path.join(root, 'typed-review.png'), { fullPage: true })
  const posted = page.raw.waitForResponse(
    (response) =>
      response.url().endsWith(`${base}/jobs/rebuild-search-index/run`) &&
      response.request().method() === 'POST'
  )
  await page.raw.locator('[data-test="quest-confirm-run"]').click()
  const response = await posted
  assert.equal(response.status(), 202, await response.text())
  assert.deepEqual(response.request().postDataJSON().jobInputs, {
    collection: 'articles',
    batchSize: 200,
    dryRun: true
  })
  assert.equal(response.request().postDataJSON().runtimeId, runtimeId)
  const { run } = await response.json()
  assert.ok(run.runId)
  await expect(form).not.toBeVisible()
  const detail = page.raw.locator('[data-test="quest-run-detail"]')
  await expect(detail).toContainText('Completed', { timeout: 25000 })
  await expect(detail).toContainText('Exit 0')
  await expect(
    page.raw.locator('[data-test="quest-run-result"]')
  ).toContainText('240')
  assert.equal(new URL(page.raw.url()).searchParams.get('run'), run.runId)
  const stableUrl = page.raw.url()
  assert.equal(
    logReads.filter((url) => url.endsWith(`/runs/${run.runId}/logs`)).length,
    0,
    'Logs stay lazy until the operator opens them'
  )
  await captureInspection('structured-result.png')
  await detail.getByRole('tab', { name: 'Logs', exact: true }).click()
  await expect(page.raw.locator('[data-test="quest-run-logs"]')).toContainText(
    'fixture-warning',
    { timeout: 10000 }
  )
  await captureInspection('stderr-warning.png')
  await page.raw.goto('about:blank')
  await page.goto(stableUrl)
  await expect(
    page.raw.locator('[data-test="quest-run-detail"]')
  ).toContainText('Completed', { timeout: 20000 })
  await expect(
    page.raw.locator('[data-test="quest-run-result"]')
  ).toContainText('240')
  assert.equal(new URL(page.raw.url()).searchParams.get('run'), run.runId)
  await captureInspection('reopened-run.png')
  expect(page).toHaveNoJavascriptErrors()
  await fs.writeFile(
    path.join(root, 'browser-proof.json'),
    JSON.stringify(
      {
        transport:
          'Real browser → HTTP/authentication → Docker/private UDS → upstream Sails/Quest → ledger',
        syntheticBusinessData: true,
        interceptedResponses: false,
        runId: run.runId,
        runtimeId,
        screenshots: [
          'typed-review.png',
          'structured-result.png',
          'stderr-warning.png',
          'reopened-run.png'
        ]
      },
      null,
      2
    ) + '\n'
  )
  await page.raw.goto('about:blank')
  page.raw.off('request', observeRequest)
  return run.runId
}
module.exports = { realBrowserFlow }
