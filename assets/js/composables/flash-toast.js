import { watch } from 'vue'
import { usePage } from '@inertiajs/vue3'

/**
 * Watches Inertia flash messages and shows them as toast notifications.
 *
 * Server-side usage:
 *   sails.inertia.flash('success', 'Project deleted.')
 *   sails.inertia.flash('error', 'Something went wrong.')
 *
 * Call once in AppLayout — no per-page setup needed.
 */
export function useFlashToast(toast) {
  const page = usePage()

  watch(
    () => page.props.flash,
    (flash) => {
      if (!flash) return

      if (flash.success) {
        toast({ message: flash.success, type: 'success' })
      }

      if (flash.error) {
        toast({ message: flash.error, type: 'error', duration: 5000 })
      }

      if (flash.message) {
        toast({ message: flash.message, type: 'info' })
      }
    },
    { deep: true, immediate: true }
  )
}
