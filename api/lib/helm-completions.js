const EMPTY_HELM_COMPLETIONS = Object.freeze({
  version: 1,
  truncated: false,
  models: [],
  helpers: [],
  config: []
})

const collectSailsCompletionMetadata = require('./contracts/helm-completion-metadata')

function buildSailsCompletionSource() {
  return `return (${collectSailsCompletionMetadata.toString()})(sails)`
}

function emptyHelmCompletions() {
  return {
    version: EMPTY_HELM_COMPLETIONS.version,
    truncated: EMPTY_HELM_COMPLETIONS.truncated,
    models: [],
    helpers: [],
    config: []
  }
}

function isHelmCompletionMetadata(value) {
  return (
    value?.version === 1 &&
    typeof value.truncated === 'boolean' &&
    Array.isArray(value.models) &&
    Array.isArray(value.helpers) &&
    Array.isArray(value.config)
  )
}

module.exports = {
  buildSailsCompletionSource,
  collectSailsCompletionMetadata,
  emptyHelmCompletions,
  isHelmCompletionMetadata
}
