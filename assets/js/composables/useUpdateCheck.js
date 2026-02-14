import { ref } from 'vue'

// Singleton state shared across all components using this composable
const updateInfo = ref(null)
const checking = ref(false)

export function useUpdateCheck() {
  async function check() {
    checking.value = true
    try {
      const response = await fetch('/api/v1/system/check-update')
      if (response.ok) {
        updateInfo.value = await response.json()
      }
    } catch (err) {
      console.error('Failed to check for updates:', err)
    } finally {
      checking.value = false
    }
  }

  return { updateInfo, checking, check }
}
