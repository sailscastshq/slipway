// Suggestions own only blank fields they fill. User input always takes ownership,
// including a deliberate clear or an edit while a request is still pending.
export function createDependentDefaults({
  provider,
  getValues,
  applyValues,
  emptyValue,
  fetchDefaults,
  onError = () => {},
  onPending = () => {}
}) {
  const dirty = new Set()
  const owned = new Set()
  let revision = 0,
    controller,
    disposed = false
  const empty = (value) => value === undefined || value === null || value === ''
  function markEdited(name) {
    dirty.add(name)
    owned.delete(name)
  }
  function dispose() {
    disposed = true
    revision++
    controller?.abort()
    onPending(false)
  }
  async function refresh() {
    if (disposed) return
    const current = ++revision
    controller?.abort()
    controller = new AbortController()
    const cleared = {}
    for (const name of owned)
      if (!dirty.has(name)) cleared[name] = emptyValue(name)
    owned.clear()
    applyValues(cleared)
    const values = getValues()
    const dependencies = Object.fromEntries(
      provider.dependsOn.map((name) => [name, values[name]])
    )
    if (Object.values(dependencies).some(empty)) {
      onPending(false)
      return
    }
    onPending(true)
    try {
      const result = await fetchDefaults(dependencies, controller.signal)
      if (disposed || current !== revision) return
      const patch = {}
      for (const name of provider.fields) {
        if (
          !dirty.has(name) &&
          empty(getValues()[name]) &&
          Object.hasOwn(result.values, name)
        ) {
          patch[name] = result.values[name]
          owned.add(name)
        }
      }
      applyValues(patch)
    } catch (error) {
      if (!disposed && current === revision && error.name !== 'AbortError')
        onError()
    } finally {
      if (!disposed && current === revision) onPending(false)
    }
  }
  return { markEdited, refresh, dispose }
}
