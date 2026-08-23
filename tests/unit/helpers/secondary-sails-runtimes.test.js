const fs = require('node:fs')
const path = require('node:path')

const { test } = require('sounding')

const runtimeFiles = [
  'api/helpers/dock/get-models.js',
  'api/helpers/quest/list-jobs.js',
  'api/helpers/quest/pause-job.js',
  'api/helpers/quest/resume-job.js'
]

test('Slipway-owned secondary Sails lifts cannot run automigrations', async ({
  expect
}) => {
  for (const file of runtimeFiles) {
    const source = fs.readFileSync(path.resolve(file), 'utf8')

    expect(source).toContain('sailsApp.load')
    expect(source).toContain("migrate: 'safe'")
  }
})
