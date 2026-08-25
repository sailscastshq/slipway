const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { test } = require('sounding')

const SURFACES = [
  'assets/js/pages/bearing/feedback.vue',
  'assets/js/pages/projects/dock.vue',
  'assets/js/pages/settings/team-profile.vue',
  'assets/js/components/bridge/BridgeFieldInput.vue',
  'assets/js/components/content/MarkdownEditor.vue'
]

function source(path) {
  return readFileSync(resolve(path), 'utf8')
}

test('Slipway routes every application file picker through Klean FileUpload', ({
  expect
}) => {
  for (const path of SURFACES) {
    const contents = source(path)
    expect(contents).toContain(
      "import FileUpload from '@/components/ui/file-upload/FileUpload.vue'"
    )
    expect(contents).toContain('<FileUpload')
    expect(/<input[\s\S]*?type=["']file["']/.test(contents)).toBe(false)
  }

  const fileUpload = source(
    'assets/js/components/ui/file-upload/FileUpload.vue'
  )
  expect(fileUpload).toContain('data-slot="file-upload"')
  expect(fileUpload).toContain('data-part="input"')
  expect(fileUpload).toContain('type="file"')
  expect(fileUpload).toContain(':multiple="multiple"')
  expect(fileUpload).toContain(':previews="previews"')
  expect(fileUpload).toContain(':remove="remove"')
  expect(fileUpload).toContain('input.value.showPicker()')
})

test('Klean selection state leaves Slipway upload transport application-owned', ({
  expect
}) => {
  expect(source('assets/js/pages/bearing/feedback.vue')).toContain(
    'form.post(props.app.feedbackPath'
  )
  expect(source('assets/js/pages/projects/dock.vue')).toContain(
    "fetch(apiUrl('/import')"
  )
  expect(source('assets/js/pages/settings/team-profile.vue')).toContain(
    "logoForm.post('/settings/team-profile/logo'"
  )

  const bridge = source('assets/js/components/bridge/BridgeFieldInput.vue')
  expect(bridge).toContain('uploadMultipartParts')
  expect(bridge).toContain('new AbortController()')
  expect(bridge).toContain('Retry upload')

  const editor = source('assets/js/components/content/MarkdownEditor.vue')
  expect(editor).toContain('const formData = new FormData()')
  expect(editor).toContain('await fetch(props.uploadUrl')
})
