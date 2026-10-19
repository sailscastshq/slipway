/**
 * Clean up eligible old deployment images daily. Set the environment variable
 * to false for preview-only operation; Bosun also offers a per-run Preview.
 */
module.exports.imageRetention = {
  remove:
    process.env.SLIPWAY_IMAGE_RETENTION_REMOVE === undefined ||
    process.env.SLIPWAY_IMAGE_RETENTION_REMOVE === 'true',
  // Fixed policy: current image plus one distinct previous successful rollback.
  // Legacy minimumAgeDays/keepSuccessful overrides no longer affect selection.
  // Exact image IDs, tags, or repository digests. Missing pins hold the run.
  pinnedImages: [],
  maxImages: 5000,
  maxContainers: 1000,
  maxRecords: 20000,
  inspectBatchSize: 50,
  maxRemovals: 100,
  maxRunMs: 5 * 60 * 1000
}
