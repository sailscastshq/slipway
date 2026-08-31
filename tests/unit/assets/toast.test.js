const fs = require('node:fs')
const path = require('node:path')
const { test } = require('sounding')

function source(file) {
  return fs.readFileSync(path.resolve(file), 'utf8')
}

const container = source('assets/js/components/ToastContainer.vue')
const toastComposable = source('assets/js/composables/toast.js')
const serviceActions = source('assets/js/composables/service-actions.js')
const deployment = source('assets/js/components/DeploymentToast.vue')
const serviceAction = source('assets/js/components/ServiceActionToast.vue')
const appLayout = source('assets/js/layouts/AppLayout.vue')

test('Slipway composes one Klean Toast viewport without rebuilding lifecycle mechanics', ({
  expect
}) => {
  expect(container).toContain(
    "import Toast from '@/components/ui/toast/Toast.vue'"
  )
  expect(container).toContain('position="bottom-right"')
  expect(container).toContain('from="right"')
  expect(container).toContain('to="right"')
  expect(container.includes('<Teleport')).toBe(false)
  expect(container.includes('<TransitionGroup')).toBe(false)

  expect(toastComposable).toContain(
    "import { createToast as createKleanToast } from '@/components/ui/toast/toast.js'"
  )
  expect(toastComposable.includes('setTimeout')).toBe(false)
  expect(appLayout.match(/<ToastContainer/g)?.length).toBe(1)
  expect(appLayout.includes('v-for="action in serviceActions"')).toBe(false)
  expect(appLayout.includes('v-for="deployment in activeDeployments"')).toBe(
    false
  )
})

test('operational notifications keep product UI but delegate durable timing and motion', ({
  expect
}) => {
  expect(serviceActions).toContain("kind: 'service-action'")
  expect(serviceActions).toContain('duration: false')
  expect(serviceActions).toContain('duration: 4000')
  expect(serviceActions.includes('setTimeout')).toBe(false)

  expect(appLayout).toContain("kind: 'deployment'")
  expect(appLayout).toContain('duration: false')
  expect(appLayout).toContain('? 5000')
  expect(deployment).toContain("import { Link } from '@inertiajs/vue3'")
  expect(deployment).toContain('closeStream()')
  expect(deployment).toContain('role="status"')
  expect(deployment).toContain('shadow-lg')
  expect(deployment.includes('shadow-2xl')).toBe(false)
  expect(serviceAction).toContain('shadow-lg')
  expect(appLayout).toContain('shadow-none')
  expect(serviceActions).toContain('shadow-none')
  expect(deployment.includes('<Transition')).toBe(false)
  expect(deployment.includes('setTimeout')).toBe(false)
  expect(deployment.includes('router.visit')).toBe(false)
})
