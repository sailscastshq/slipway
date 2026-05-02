import { ref, provide, inject } from 'vue'
import { LOCAL_STORAGE_KEYS } from '@/lib/localStorageKeys'

const COMMAND_PALETTE_KEY = Symbol('commandPalette')

// Module-level command registry (singleton)
const commands = new Map()

function loadHistory() {
  try {
    return JSON.parse(
      localStorage.getItem(LOCAL_STORAGE_KEYS.commandHistory) || '[]'
    )
  } catch {
    return []
  }
}

function saveHistory(history) {
  localStorage.setItem(
    LOCAL_STORAGE_KEYS.commandHistory,
    JSON.stringify(history)
  )
}

export function createCommandPalette() {
  const isOpen = ref(false)
  const history = ref(loadHistory())

  function register(command) {
    commands.set(command.id, {
      ...command,
      _searchText: [command.title, ...(command.keywords || [])]
        .join(' ')
        .toLowerCase()
    })
  }

  function unregister(id) {
    commands.delete(id)
  }

  function getAll() {
    return Array.from(commands.values())
  }

  function execute(command) {
    // Track in history
    history.value = [
      command.id,
      ...history.value.filter((h) => h !== command.id)
    ].slice(0, 10)
    saveHistory(history.value)

    // Close palette
    isOpen.value = false

    // Run the action
    return command.action()
  }

  function open() {
    isOpen.value = true
  }

  function close() {
    isOpen.value = false
  }

  function toggle() {
    isOpen.value = !isOpen.value
  }

  const palette = {
    isOpen,
    history,
    register,
    unregister,
    getAll,
    execute,
    open,
    close,
    toggle
  }

  provide(COMMAND_PALETTE_KEY, palette)

  return palette
}

export function useCommandPalette() {
  const palette = inject(COMMAND_PALETTE_KEY)
  if (!palette) {
    throw new Error(
      'useCommandPalette() requires createCommandPalette() in a parent component'
    )
  }
  return palette
}
