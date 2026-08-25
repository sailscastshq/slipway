const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { test } = require('sounding')

function source(path) {
  return readFileSync(resolve(path), 'utf8')
}

test('Slipway composes button-shaped navigation with Klean Button and Inertia Link', ({
  expect
}) => {
  const teams = source('assets/js/pages/teams/create.vue')
  const dashboard = source('assets/js/pages/dashboard/index.vue')

  for (const contents of [teams, dashboard]) {
    expect(contents).toContain(
      "import Button from '@/components/ui/button/Button.vue'"
    )
    expect(contents).toContain(':as="Link"')
    expect(contents).toContain('<Button')
  }

  expect(teams).toContain('href="/"')
  expect(dashboard).toContain('href="/projects/new"')
  expect(dashboard).toContain('<button')
})

test('Klean Button keeps form and confirmation behavior application-owned', ({
  expect
}) => {
  const teams = source('assets/js/pages/teams/create.vue')
  const confirmModal = source('assets/js/components/ConfirmModal.vue')

  expect(teams).toContain('type="submit"')
  expect(teams).toContain(':disabled="form.processing || !form.name"')
  expect(teams).toContain(':aria-busy="form.processing ? \'true\' : undefined"')
  expect(teams).toContain("form.post('/teams')")

  expect(confirmModal).toContain(
    "import Button from '@/components/ui/button/Button.vue'"
  )
  expect(confirmModal).toContain(
    "import Spinner from '@/components/SlipwaySpinner.vue'"
  )
  expect(confirmModal).toContain(':disabled="loading"')
  expect(confirmModal).toContain(':aria-busy="loading ? \'true\' : undefined"')
  expect(confirmModal).toContain("emit('confirm')")
  expect(confirmModal).toContain("emit('cancel')")
  expect(confirmModal).toContain('bg-red-600')
})

test('the copied Button preserves native and disabled link semantics', ({
  expect
}) => {
  const button = source('assets/js/components/ui/button/Button.vue')

  expect(button).toContain("default: 'button'")
  expect(button).toContain(':type="isNativeButton ? type : undefined"')
  expect(button).toContain(':disabled="isNativeButton ? disabled : undefined"')
  expect(button).toContain(':aria-disabled="managedAriaDisabled"')
  expect(button).toContain(':tabindex="managedTabindex"')
  expect(button).toContain('event.preventDefault()')
  expect(button).toContain('twMerge(baseClasses, attrs.class)')
})
