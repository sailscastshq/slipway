module.exports = {
  hooks: {
    // The repo contains the published hook as a workspace package, but the
    // Slipway dashboard app itself should not auto-load and instrument itself.
    slipway: false,
  },
}
