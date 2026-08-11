const fs = require('node:fs')
const path = require('node:path')
const { parse } = require('@vue/compiler-sfc')
const { baseParse, NodeTypes } = require('@vue/compiler-dom')
const { test } = require('sounding')

const tooltipPath = path.resolve('assets/js/components/ui/tooltip/Tooltip.vue')
const tooltipSource = fs.readFileSync(tooltipPath, 'utf8')

function vueFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return vueFiles(entryPath)
    return entry.name.endsWith('.vue') ? [entryPath] : []
  })
}

function buttonTitles(file) {
  const source = fs.readFileSync(file, 'utf8')
  const { descriptor } = parse(source, { filename: file })
  if (!descriptor.template) return []

  const root = baseParse(descriptor.template.content)
  const titles = []

  function visit(node) {
    if (node.type === NodeTypes.ELEMENT && node.tag === 'button') {
      const title = node.props.find(
        (prop) =>
          (prop.type === NodeTypes.ATTRIBUTE && prop.name === 'title') ||
          (prop.type === NodeTypes.DIRECTIVE &&
            prop.name === 'bind' &&
            prop.arg?.content === 'title')
      )
      if (title) titles.push(node.loc.start.line)
    }
    node.children?.forEach(visit)
  }

  visit(root)
  return titles
}

test('Klean Tooltip owns accessible hint behavior and collision-safe positioning', ({
  expect
}) => {
  expect(tooltipSource.includes("from '@floating-ui/dom'")).toBe(true)
  expect(tooltipSource.includes('computePosition')).toBe(true)
  expect(tooltipSource.includes('autoUpdate')).toBe(true)
  expect(tooltipSource.includes('flip()')).toBe(true)
  expect(tooltipSource.includes('shift({ padding: 8 })')).toBe(true)
  expect(tooltipSource.includes('floatingArrow')).toBe(true)
  expect(tooltipSource.includes('ARROW_CLIP_PATHS')).toBe(true)
  expect(tooltipSource.includes('clipPath: ARROW_CLIP_PATHS[side]')).toBe(true)
  expect(tooltipSource.includes('rotate-45')).toBe(false)
  expect(tooltipSource.includes('popover="hint"')).toBe(true)
  expect(tooltipSource.includes('role="tooltip"')).toBe(true)
  expect(
    tooltipSource.includes("element.setAttribute('aria-describedby'")
  ).toBe(true)
  expect(
    tooltipSource.includes("element.removeAttribute('aria-describedby'")
  ).toBe(true)
})

test('Klean Tooltip supports pointer, keyboard, touch, Escape, and reduced motion', ({
  expect
}) => {
  expect(tooltipSource.includes('@pointerover="handlePointerOver"')).toBe(true)
  expect(tooltipSource.includes('@focusin="handleFocusIn"')).toBe(true)
  expect(tooltipSource.includes("event.pointerType === 'touch'")).toBe(true)
  expect(tooltipSource.includes("event.key !== 'Escape'")).toBe(true)
  expect(
    tooltipSource.includes("window.addEventListener('blur', closeNow)")
  ).toBe(true)
  expect(tooltipSource.includes('motion-reduce:transition-none')).toBe(true)
})

test('Slipway imports Tooltip directly without a compatibility wrapper or barrel', ({
  expect
}) => {
  const sourceFiles = vueFiles(path.resolve('assets/js'))
  const tooltipConsumers = sourceFiles.filter((file) =>
    fs.readFileSync(file, 'utf8').includes('<Tooltip')
  )

  expect(fs.existsSync(path.resolve('assets/js/components/Tooltip.vue'))).toBe(
    false
  )
  expect(
    fs.existsSync(path.resolve('assets/js/components/ui/tooltip/index.js'))
  ).toBe(false)

  for (const file of tooltipConsumers) {
    const source = fs.readFileSync(file, 'utf8')
    expect(
      source.includes(
        "import Tooltip from '@/components/ui/tooltip/Tooltip.vue'"
      )
    ).toBe(true)
    expect(source.includes('position="')).toBe(false)
  }
})

test('native button titles remain only for full truncated value disclosure', ({
  expect
}) => {
  const titledButtons = vueFiles(path.resolve('assets/js'))
    .filter((file) => buttonTitles(file).length > 0)
    .map((file) => path.relative(process.cwd(), file))
    .sort()

  expect(titledButtons).toEqual(
    [
      'assets/js/components/HelmScratchpadTabs.vue',
      'assets/js/components/HelmWorkspaceLibrary.vue',
      'assets/js/pages/projects/dock.vue'
    ].sort()
  )
})
