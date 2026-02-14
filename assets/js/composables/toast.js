import { ref, inject, provide } from 'vue'

const TOAST_KEY = Symbol('toast')

export function createToast() {
  const toasts = ref([])
  let nextId = 0

  function toast({ message, type = 'success', duration = 4000 }) {
    const id = nextId++
    toasts.value.push({ id, message, type })

    setTimeout(() => {
      dismiss(id)
    }, duration)
  }

  function dismiss(id) {
    toasts.value = toasts.value.filter(t => t.id !== id)
  }

  provide(TOAST_KEY, toast)

  return { toasts, toast, dismiss }
}

export function useToast() {
  const toast = inject(TOAST_KEY)
  if (!toast) {
    throw new Error('useToast() must be used within a component that has called createToast()')
  }
  return toast
}
