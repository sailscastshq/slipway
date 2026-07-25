export const MINIMUM_NODE_MAJOR = 22

export function assertSupportedNodeVersion(version = process.versions.node) {
  const major = Number.parseInt(String(version).split('.')[0], 10)

  if (!Number.isInteger(major) || major < MINIMUM_NODE_MAJOR) {
    const error = new Error(
      `Slipway CLI requires Node.js ${MINIMUM_NODE_MAJOR} or newer. Current version: ${version}.`
    )
    error.code = 'UNSUPPORTED_NODE_VERSION'
    throw error
  }
}
