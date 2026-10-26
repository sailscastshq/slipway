import { ref } from 'vue'
import { requestUpdateJson } from '@/composables/useUpdateOperation'

// Singleton state shared across all components using this composable
const updateInfo = ref(null)
const checking = ref(false)

export function useUpdateCheck() {
  async function check() {
    checking.value = true
    try {
      updateInfo.value = await requestUpdateJson('/api/v1/system/check-update')
    } catch (err) {
      console.error('Failed to check for updates:', err)
    } finally {
      checking.value = false
    }
  }

  return { updateInfo, checking, check }
}
