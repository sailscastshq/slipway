const assert = require('node:assert/strict')

// quest-runtime-client uses this optional config override for dashboard requests
// that do not pass options.binary. A configured-slipway world may omit it.
function useDockerBinary(config, binary) {
  assert.equal(typeof binary, 'string')
  assert.ok(binary.length > 0)
  const previous = Object.getOwnPropertyDescriptor(config, 'docker')
  config.docker = { ...config.docker, binaryPath: binary }
  return () => {
    if (previous) Object.defineProperty(config, 'docker', previous)
    else delete config.docker
  }
}

module.exports = { useDockerBinary }
