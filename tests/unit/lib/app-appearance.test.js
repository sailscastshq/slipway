const { test } = require('sounding')
const assert = require('node:assert/strict')
const {
  normalize,
  validate,
  css,
  contrast,
  warnings
} = require('../../../api/lib/app-appearance')
const { normalizeLogo } =
  require('../../../api/controllers/project/update-app-appearance')._private
const fs = require('node:fs')
const path = require('node:path')
test('App appearance validates semantic palettes without accepting style or asset payloads', ({
  expect
}) => {
  const valid = normalize({}, 'Tembo')
  expect(warnings(valid)).toEqual([])
  expect(validate(valid).displayName).toBe('Tembo')
  for (const value of [
    { ...valid, css: 'body{display:none}' },
    { ...valid, font: 'https://evil.test/font' },
    { ...valid, mode: 'anything' },
    { ...valid, light: { ...valid.light, accent: 'red;display:none' } },
    { ...valid, light: { ...valid.light, text: '#ffffff' } }
  ])
    assert.throws(() => validate(value))
  expect(
    normalize({ version: 2, displayName: 'Unsupported' }, 'Fallback')
      .displayName
  ).toBe('Fallback')
  expect(
    normalize({ version: 1, light: { accent: 'url(evil)' } }).light.accent
  ).toBe('#0369a1')
  expect(contrast('#000000', '#ffffff')).toBe(21)
  expect(css({ ...valid, mode: 'host', fallbackMode: 'dark' })).toContain(
    'color-scheme:dark'
  )
  expect(css(valid)).toContain('@media(prefers-color-scheme:dark)')
})
test('App logos are decoded, bounded and re-encoded as managed still WebP images', async ({
  expect
}) => {
  const input =
    'data:image/png;base64,' +
    fs
      .readFileSync(path.resolve('tests/fixtures/appearance/tembo-logo.png'))
      .toString('base64')
  const result = await normalizeLogo(input)
  expect(result.hash).toMatch(/^[a-f0-9]{16}$/)
  expect(Buffer.from(result.data, 'base64').subarray(8, 12).toString()).toBe(
    'WEBP'
  )
  expect(await normalizeLogo('keep', result)).toEqual(result)
  expect(await normalizeLogo(null, result)).toBe(null)
  for (const value of [
    'https://evil.test/logo.png',
    'data:image/svg+xml;base64,PHN2Zz4=',
    input + ';bad',
    'data:image/png;base64,' + 'a'.repeat(360000)
  ]) {
    await assert.rejects(normalizeLogo(value))
  }
})
