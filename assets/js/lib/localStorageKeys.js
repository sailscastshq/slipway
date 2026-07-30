export const LOCAL_STORAGE_KEYS = Object.freeze({
  sidebarCollapsed: 'slipway:sidebar-collapsed',
  commandHistory: 'slipway:command-history',
  helmScratchpads: 'slipway:helm-scratchpads',
  updateDismissed: 'slipway:update-dismissed'
})

export const LEGACY_LOCAL_STORAGE_KEYS = Object.freeze({
  sidebarCollapsed: ['sidebarCollapsed'],
  updateDismissed: ['slipway_update_dismissed']
})

export function readLocalStorageValue(key, legacyKeys = []) {
  const value = localStorage.getItem(key)
  if (value !== null) {
    return value
  }

  for (const legacyKey of legacyKeys) {
    const legacyValue = localStorage.getItem(legacyKey)
    if (legacyValue !== null) {
      localStorage.setItem(key, legacyValue)
      localStorage.removeItem(legacyKey)
      return legacyValue
    }
  }

  return null
}
