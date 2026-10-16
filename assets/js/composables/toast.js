import { inject, provide } from 'vue'
import { createToast as createKleanToast } from '@/components/ui/toast/toast.js'

const TOAST_KEY = Symbol('toast')
const ORDINARY_TOAST_CLASS =
  'ml-auto w-80 max-w-full flex items-start space-x-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm ring-0 dark:border-gray-700 dark:bg-gray-900'

export function createToast(options = {}) {
  const { max = 4, ...settings } = options
  // Detailed results stay until explicitly dismissed, including when ordinary
  // notifications reach their capacity. Klean owns timers and dismissal.
  const controller = createKleanToast({ duration: 4000, ...settings, max: 0 })

  function toast(input = {}, toastOptions = {}) {
    const item =
      typeof input === 'string'
        ? { ...toastOptions, message: input }
        : { ...input }

    if (max > 0 && item.kind !== 'bridge-action-result') {
      const ordinary = controller
        .getSnapshot()
        .filter(
          (candidate) =>
            candidate.state !== 'closing' &&
            candidate.kind !== 'bridge-action-result'
        )
      if (ordinary.length >= max) controller.dismiss(ordinary[0].id)
    }
    return controller({
      type: 'success',
      ...item,
      class: [item.kind ? '' : ORDINARY_TOAST_CLASS, item.class]
        .filter(Boolean)
        .join(' ')
    })
  }

  Object.assign(toast, controller)

  provide(TOAST_KEY, toast)
  return toast
}

export function useToast() {
  const toast = inject(TOAST_KEY)
  if (!toast) {
    throw new Error(
      'useToast() must be used within a component that has called createToast()'
    )
  }
  return toast
}
