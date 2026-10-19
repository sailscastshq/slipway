/**
 * Preview eligible old deployment images daily. Removal requires an explicit
 * server opt-in; Bosun also offers a per-run Preview.
 */
module.exports.imageRetention = {
  remove: process.env.SLIPWAY_IMAGE_RETENTION_REMOVE === 'true',
  minimumAgeDays: 14,
  keepSuccessful: 3,
  // Exact image IDs, tags, or repository digests. Missing pins hold the run.
  pinnedImages: [],
  maxImages: 5000,
  maxContainers: 1000,
  maxRecords: 20000,
  inspectBatchSize: 50,
  maxRemovals: 100,
  maxRunMs: 5 * 60 * 1000
}
