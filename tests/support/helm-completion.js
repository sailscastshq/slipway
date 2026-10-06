// A visible CodeMirror tooltip is not yet keyboard-ready. CodeMirror retains
// obsolete tooltips during recomputation and guards a newly opened menu for
// interactionDelay. Observe those preconditions; keep testing the real Enter
// key and the application's unchanged autocomplete/keymap configuration.
async function waitForHelmCompletion(page, label) {
  await page.waitForFunction((expected) => {
    const content = document.querySelector(
      '[data-test="helm-editor"].cm-content'
    )
    const view = content?.cmTile?.root?.view
    if (!view?.hasFocus) return false
    // CodeMirror does not expose acceptance readiness through its DOM or public
    // completionStatus API. Keep this test-only inspection in one helper.
    const completion = view.state.values.find(
      (value) => value?.active && 'open' in value
    )
    const open = completion?.open
    const providers = Object.values(view.state.config.facets).find((items) => {
      const value = view.state.facet(items[0].facet)
      return value && typeof value === 'object' && 'interactionDelay' in value
    })
    if (!open || open.disabled || open.selected < 0 || !providers) return false
    const configuration = view.state.facet(providers[0].facet)
    return (
      completion.active.every((source) => source.state !== 1) &&
      open.options[open.selected]?.completion.label === expected &&
      Date.now() - open.timestamp >= configuration.interactionDelay
    )
  }, label)
}

module.exports = { waitForHelmCompletion }
