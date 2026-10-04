const fs = require('node:fs')
const path = require('node:path')

const { test } = require('sounding')

const runtimeFiles = ['api/helpers/dock/get-models.js']

test('Slipway-owned secondary Sails lifts cannot run automigrations', async ({
  expect
}) => {
  for (const file of runtimeFiles) {
    const source = fs.readFileSync(path.resolve(file), 'utf8')

    expect(source).toContain('sailsApp.load')
    expect(source).toContain("migrate: 'safe'")
  }
})

test('Quest inspection and controls never lift a temporary Sails scheduler', async ({
  expect
}) => {
  for (const file of ['list-jobs', 'pause-job', 'resume-job']) {
    const source = fs.readFileSync(
      path.resolve(`api/helpers/quest/${file}.js`),
      'utf8'
    )
    expect(source.includes('sailsApp.load')).toBe(false)
    expect(source.includes('executeInContainer')).toBe(false)
  }
})
