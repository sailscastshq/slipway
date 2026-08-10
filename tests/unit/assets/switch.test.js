const fs = require('node:fs')
const path = require('node:path')
const { test } = require('sounding')

const switchSource = fs.readFileSync(
  path.resolve('assets/js/components/ui/switch/Switch.vue'),
  'utf8'
)

test('Klean Switch keeps one native boolean control and caller-owned styling', ({
  expect
}) => {
  expect(switchSource.includes('defineModel({ type: Boolean')).toBe(true)
  expect(switchSource.includes('type="checkbox"')).toBe(true)
  expect(switchSource.includes('role="switch"')).toBe(true)
  expect(switchSource.includes('data-slot="switch"')).toBe(true)
  expect(switchSource.includes('import { twMerge }')).toBe(true)
  expect(switchSource.includes('attrs.class')).toBe(true)
  expect(switchSource.includes('variant')).toBe(false)
  expect(switchSource.includes('true-value')).toBe(true)
  expect(switchSource.includes('false-value')).toBe(true)
})

test('Klean Switch preserves native reset, disabled, invalid, and motion behavior', ({
  expect
}) => {
  expect(switchSource.includes("form?.addEventListener('reset'")).toBe(true)
  expect(switchSource.includes(':data-disabled')).toBe(true)
  expect(switchSource.includes(':data-invalid')).toBe(true)
  expect(switchSource.includes('disabled:cursor-not-allowed')).toBe(true)
  expect(switchSource.includes('aria-invalid:outline-2')).toBe(true)
  expect(switchSource.includes('motion-reduce:duration-100')).toBe(true)
  expect(switchSource.includes('forced-colors:border')).toBe(true)
})
