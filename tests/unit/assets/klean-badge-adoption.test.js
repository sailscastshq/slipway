const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { test } = require('sounding')

const SURFACES = [
  'assets/js/pages/projects/show.vue',
  'assets/js/pages/projects/app.vue',
  'assets/js/pages/lookout/index.vue',
  'assets/js/pages/projects/lookout.vue',
  'assets/js/pages/bosun/index.vue',
  'assets/js/pages/projects/dock.vue',
  'assets/js/layouts/AppLayout.vue',
  'assets/js/components/DeploymentOutcome.vue',
  'assets/js/components/DeploymentHistory.vue',
  'assets/js/components/bridge/BridgeFieldValue.vue',
  'assets/js/components/bridge/BridgeFilterMenu.vue'
]

function source(path) {
  return readFileSync(resolve(path), 'utf8')
}

test('Slipway composes passive status, count, and type metadata with Klean Badge', ({
  expect
}) => {
  for (const path of SURFACES) {
    const contents = source(path)
    expect(contents).toContain(
      "import Badge from '@/components/ui/badge/Badge.vue'"
    )
    expect(contents).toContain('<Badge')
    expect(/<Badge[^>]*\bvariant=/.test(contents)).toBe(false)
  }

  const badge = source('assets/js/components/ui/badge/Badge.vue')
  expect(badge).toContain('data-slot="badge"')
  expect(badge).toContain('<span')
  expect(badge.includes('href')).toBe(false)
  expect(badge.includes('@click')).toBe(false)
})

test('Badge callers retain application-owned meaning and presentation', ({
  expect
}) => {
  const project = source('assets/js/pages/projects/show.vue')
  expect(project).toContain('badgeClasses(statusBadge(env).color)')
  expect(project).toContain('<Link')

  const app = source('assets/js/pages/projects/app.vue')
  expect(app).toContain('appStatusClasses(app).bg')
  expect(app).toContain('statusBadge(service.status).classes')

  const deployment = source('assets/js/components/DeploymentOutcome.vue')
  expect(deployment).toContain('presentation.classes')
  expect(deployment).toContain('currently serving traffic')

  const bosun = source('assets/js/pages/bosun/index.vue')
  expect(bosun).toContain('statusColor(activity.status)')
  expect(bosun).toContain('tabular-nums')
})
