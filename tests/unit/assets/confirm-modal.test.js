const fs = require('node:fs')
const path = require('node:path')
const { test } = require('sounding')

const source = fs.readFileSync(
  path.resolve('assets/js/components/ConfirmModal.vue'),
  'utf8'
)

test('ConfirmModal composes Klean Dialog without rebuilding modal mechanics', ({
  expect
}) => {
  expect(source).toContain(
    "import Dialog from '@/components/ui/dialog/Dialog.vue'"
  )
  expect(source).toContain("import { useId } from 'vue'")
  expect(source).toContain(':dismissible="!loading"')
  expect(source).toContain(':aria-busy="loading ? \'true\' : undefined"')
  expect(source).toContain('autofocus')
  expect(source.includes('<Teleport')).toBe(false)
  expect(source.includes('role="dialog"')).toBe(false)
  expect(source.includes("document.addEventListener('keydown'")).toBe(false)
})
