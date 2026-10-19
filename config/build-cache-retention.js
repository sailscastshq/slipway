module.exports.buildCacheRetention = {
  remove:
    process.env.SLIPWAY_BUILD_CACHE_RETENTION_REMOVE === undefined ||
    process.env.SLIPWAY_BUILD_CACHE_RETENTION_REMOVE === 'true',
  minimumUnusedHours: 168,
  keepStorageBytes: 20 * 1024 ** 3,
  maxRunMs: 5 * 60 * 1000
}
