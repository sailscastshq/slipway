const { test } = require('sounding')

const { sounding } = require('../../../config/sounding')
const testEnvironment = require('../../../config/env/test')

test('Sounding lets the OS allocate an unused HTTP port', ({ expect }) => {
  expect(testEnvironment.port).toBe(0)
  expect(sounding.app.liftOptions.port).toBe(undefined)
  expect(sounding.app.liftOptions.custom?.baseUrl).toBe(undefined)
  expect(sounding.browser.baseUrl).toBe(undefined)
})
