const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { test } = require('sounding')

const BARE_SELECT_SURFACES = [
  { path: 'assets/js/components/LogViewer.vue', count: 1 },
  { path: 'assets/js/components/bridge/BridgeFilterMenu.vue', count: 3 },
  { path: 'assets/js/pages/bearing/feedback.vue', count: 2 },
  { path: 'assets/js/pages/projects/app-settings.vue', count: 2 },
  { path: 'assets/js/pages/projects/bridge-model.vue', count: 2 },
  { path: 'assets/js/pages/projects/bridge.vue', count: 1 },
  { path: 'assets/js/pages/projects/dock.vue', count: 1 },
  { path: 'assets/js/pages/settings/git.vue', count: 1 }
]

function source(path) {
  return readFileSync(resolve(path), 'utf8')
}

function bareSelectTags(contents) {
  return contents.match(/<BareSelect\b[\s\S]*?\/>/g) || []
}

test('BareSelect composes Klean Select with a hard borderless trigger reset', ({
  expect
}) => {
  const bareSelect = source('assets/js/components/BareSelect.vue')
  expect(bareSelect).toContain(
    "import Select from '@/components/ui/select/Select.vue'"
  )
  expect(bareSelect).toContain("border: '0'")
  expect(bareSelect).toContain("borderRadius: '0'")
  expect(bareSelect).toContain("boxShadow: 'none'")
  expect(bareSelect).toContain("background: 'transparent'")
  expect(bareSelect).toContain('focus-visible:outline-none')

  for (const surface of BARE_SELECT_SURFACES) {
    const contents = source(surface.path)
    const tags = bareSelectTags(contents)
    expect(contents).toContain(
      "import BareSelect from '@/components/BareSelect.vue'"
    )
    expect(tags.length).toBe(surface.count)

    for (const tag of tags) {
      expect(tag.includes('border-b')).toBe(false)
      expect(tag.includes('border-dashed')).toBe(false)
      expect(tag.includes('shadow-')).toBe(false)
    }
  }
})

test('the relationship combobox uses the same hard borderless treatment', ({
  expect
}) => {
  const relationship = source(
    'assets/js/components/bridge/BridgeRelationshipCombobox.vue'
  )

  expect(relationship.includes('border-b')).toBe(false)
  expect(relationship.includes('border-dashed')).toBe(false)
  expect(relationship).toContain('border: 0;')
  expect(relationship).toContain('border-radius: 0;')
  expect(relationship).toContain('box-shadow: none;')
  expect(relationship).toContain('background: transparent;')
})

test('Dock relies on the Klean Select icon instead of layering a second chevron', ({
  expect
}) => {
  const dock = source('assets/js/pages/projects/dock.vue')
  const selector = dock.match(
    /data-test="dock-database-selector"[\s\S]*?<!-- Single DB badge -->/
  )?.[0]

  expect(selector).toBeDefined()
  expect(selector.includes('<ChevronDown')).toBe(false)
  expect(source('assets/js/components/ui/select/Select.vue')).toContain(
    'data-slot="select-icon"'
  )
})
