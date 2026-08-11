const fs = require('node:fs')
const path = require('node:path')
const { test } = require('sounding')

const spinnerSource = fs.readFileSync(
  path.resolve('assets/js/components/ui/spinner/Spinner.vue'),
  'utf8'
)
const slippySource = fs.readFileSync(
  path.resolve('assets/js/components/SlippyLoader.vue'),
  'utf8'
)
const slipwaySpinnerSource = fs.readFileSync(
  path.resolve('assets/js/components/SlipwaySpinner.vue'),
  'utf8'
)

function vueFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return vueFiles(entryPath)
    return entry.name.endsWith('.vue') ? [entryPath] : []
  })
}

test('Klean Spinner is class-first and inherits the caller color', ({
  expect
}) => {
  expect(spinnerSource.includes('data-slot="spinner"')).toBe(true)
  expect(spinnerSource.includes('data-slot="spinner-mark"')).toBe(true)
  expect(spinnerSource.includes('stroke="currentColor"')).toBe(true)
  expect(spinnerSource.includes('import { twMerge }')).toBe(true)
  expect(spinnerSource.includes('attrs.class')).toBe(true)
  expect(spinnerSource.includes('size:')).toBe(false)
  expect(spinnerSource.includes('color:')).toBe(false)
  expect(spinnerSource.includes('speed:')).toBe(false)
  expect(spinnerSource.includes('strokeWidth:')).toBe(false)
})

test('Klean Spinner stays decorative and leaves status ownership to its caller', ({
  expect
}) => {
  expect(spinnerSource.includes('aria-hidden="true"')).toBe(true)
  expect(spinnerSource.includes('role: _role')).toBe(true)
  expect(spinnerSource.includes("'aria-hidden': _ariaHidden")).toBe(true)
  expect(spinnerSource.includes('label:')).toBe(false)
  expect(spinnerSource.includes('role="status"')).toBe(false)
})

test('Klean Spinner keeps a visible reduced-motion fallback', ({ expect }) => {
  expect(spinnerSource.includes('animate-spin')).toBe(true)
  expect(spinnerSource.includes('motion-reduce:animate-none!')).toBe(true)
  expect(spinnerSource.includes('motion-reduce:[&_*]:animate-none!')).toBe(true)
  expect(spinnerSource.includes('<circle')).toBe(true)
  expect(spinnerSource.includes('<path')).toBe(true)
})

test('Klean Spinner accepts an app-owned mark without double spinning it', ({
  expect
}) => {
  expect(spinnerSource.includes('useSlots')).toBe(true)
  expect(spinnerSource.includes('hasCustomMark')).toBe(true)
  expect(spinnerSource.includes("hasCustomMark ? '' : 'animate-spin'")).toBe(
    true
  )
  expect(spinnerSource.includes('[&>*]:size-full')).toBe(true)
})

test('Slipway routes every loading indicator through its spinner recipes', ({
  expect
}) => {
  const sourceFiles = vueFiles(path.resolve('assets/js'))
  const oneOffSpinners = sourceFiles
    .filter((file) => !file.endsWith('/ui/spinner/Spinner.vue'))
    .filter((file) => fs.readFileSync(file, 'utf8').includes('animate-spin'))
  const labelledSpinnerProps = sourceFiles
    .filter((file) =>
      /<Spinner\b[^>]*\blabel=/.test(fs.readFileSync(file, 'utf8'))
    )
    .map((file) => path.relative(process.cwd(), file))

  expect(oneOffSpinners).toEqual([])
  expect(labelledSpinnerProps).toEqual([])
})

test('UI components use direct imports without barrel files', ({ expect }) => {
  const uiRoot = path.resolve('assets/js/components/ui')
  const barrelFiles = fs
    .readdirSync(uiRoot, { recursive: true })
    .filter((file) => /(^|\/)index\.(js|ts)$/.test(file))

  expect(barrelFiles).toEqual([])
})

test('standalone loading regions own their truthful status text', ({
  expect
}) => {
  const statusSources = [
    'assets/js/components/HelmWorkspaceLibrary.vue',
    'assets/js/pages/bosun/index.vue',
    'assets/js/pages/projects/dock.vue',
    'assets/js/pages/settings/team-profile.vue'
  ].map((file) => fs.readFileSync(path.resolve(file), 'utf8'))

  for (const source of statusSources) {
    expect(source.includes('role="status"')).toBe(true)
    expect(source.includes('class="sr-only"')).toBe(true)
  }
})

test('Slippy remains a class-first, reduced-motion brand recipe', ({
  expect
}) => {
  const expectedBrandCallers = [
    'assets/js/components/ConfirmModal.vue',
    'assets/js/components/DeploymentToast.vue',
    'assets/js/components/HelmResultViewer.vue',
    'assets/js/components/HelmSnippetDialog.vue',
    'assets/js/components/HelmWorkspaceLibrary.vue',
    'assets/js/components/HelmWriteGuardDialog.vue',
    'assets/js/components/LogViewer.vue',
    'assets/js/components/ServiceActionToast.vue',
    'assets/js/components/SlideToDeploy.vue',
    'assets/js/components/UpdateModal.vue',
    'assets/js/components/bridge/BridgeActionDialog.vue',
    'assets/js/pages/auth/forgot-password.vue',
    'assets/js/pages/auth/login.vue',
    'assets/js/pages/auth/reset-password.vue',
    'assets/js/pages/bosun/index.vue',
    'assets/js/pages/cli/authorize.vue',
    'assets/js/pages/projects/app.vue',
    'assets/js/pages/projects/app-settings.vue',
    'assets/js/pages/projects/bridge-form.vue',
    'assets/js/pages/projects/deployment.vue',
    'assets/js/pages/projects/dock.vue',
    'assets/js/pages/projects/environment.vue',
    'assets/js/pages/projects/helm.vue',
    'assets/js/pages/projects/lookout.vue',
    'assets/js/pages/projects/quest.vue',
    'assets/js/pages/projects/service-settings.vue',
    'assets/js/pages/settings/team-profile.vue',
    'assets/js/pages/settings/update.vue',
    'assets/js/pages/setup/setup.vue'
  ]
  const slippyCallers = vueFiles(path.resolve('assets/js'))
    .filter((file) => !file.endsWith('/SlippyLoader.vue'))
    .filter((file) => fs.readFileSync(file, 'utf8').includes('SlippyLoader'))
    .map((file) => path.relative(process.cwd(), file))
    .sort()

  const brandRecipeCallers = vueFiles(path.resolve('assets/js'))
    .filter((file) =>
      fs.readFileSync(file, 'utf8').includes('@/components/SlipwaySpinner.vue')
    )
    .map((file) => path.relative(process.cwd(), file))
    .sort()

  expect(slippyCallers).toEqual(['assets/js/components/SlipwaySpinner.vue'])
  expect(brandRecipeCallers).toEqual(expectedBrandCallers.sort())
  expect(
    slipwaySpinnerSource.includes('@/components/ui/spinner/Spinner.vue')
  ).toBe(true)
  expect(slipwaySpinnerSource.includes('<SlippyLoader />')).toBe(true)
  expect(slippySource.includes('size:')).toBe(false)
  expect(slippySource.includes('attrs.class')).toBe(true)
  expect(slippySource.includes('@media (prefers-reduced-motion: reduce)')).toBe(
    true
  )
})
