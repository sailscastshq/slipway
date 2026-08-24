import { inject, provide } from 'vue'
import { createToast as createKleanToast } from '@/components/ui/toast/toast.js'

const TOAST_KEY = Symbol('toast')
const ORDINARY_TOAST_CLASS =
  'flex items-start space-x-3 rounded-lg border border-gray-200 bg-white p-4 shadow-lg ring-0 dark:border-gray-700 dark:bg-gray-900'

export function createToast(options = {}) {
  const controller = createKleanToast({ duration: 4000, ...options })

  function toast(input = {}, toastOptions = {}) {
    const item =
      typeof input === 'string'
        ? { ...toastOptions, message: input }
        : { ...input }

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
