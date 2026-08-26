import { customRef, getCurrentScope, onScopeDispose } from 'vue'
import { readQuery, subscribeQuery, writeQuery } from './core.js'

export function useQueryState(key, fallback = null, options = {}) {
  let timer

  return customRef((track, trigger) => {
    const notify = () => trigger()
    const unsubscribe = subscribeQuery(key, notify)
    if (getCurrentScope()) {
      onScopeDispose(() => {
        clearTimeout(timer)
        unsubscribe()
      })
    }

    return {
      get() {
        track()
        return readQuery(key, fallback, options)
      },
      set(next) {
        const value =
          typeof next === 'function'
            ? next(readQuery(key, fallback, options))
            : next
        clearTimeout(timer)
        const commit = () => {
          if (writeQuery(key, value, fallback, options)) trigger()
        }
        if (options.debounceMs > 0)
          timer = setTimeout(commit, options.debounceMs)
        else commit()
      }
    }
  })
}
