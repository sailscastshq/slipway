/**
 * File Upload Settings
 * (sails.config.uploads)
 *
 * Used by sails-hook-uploads for S3-compatible storage.
 * Public images use these defaults. Backup helpers pass their selected private
 * storage configuration explicitly to sails-hook-uploads.
 *
 * Configure via environment variables on your Slipway instance:
 *
 *   R2_ACCESS_KEY     - S3-compatible access key
 *   R2_SECRET_KEY     - S3-compatible secret key
 *   R2_BUCKET         - Bucket name
 *   R2_ENDPOINT       - S3-compatible endpoint (e.g. https://<account>.r2.cloudflarestorage.com)
 *   R2_PUBLIC_URL     - Public bucket URL or custom domain used to serve files
 *
 * Works with: Cloudflare R2, AWS S3, DigitalOcean Spaces, MinIO, etc.
 */

module.exports.uploads = {
  provider: 'r2',
  adapter: require('../adapters/s3'),
  key: process.env.R2_ACCESS_KEY,
  secret: process.env.R2_SECRET_KEY,
  bucket: process.env.R2_BUCKET,
  endpoint: process.env.R2_ENDPOINT,
  region: process.env.R2_REGION || 'auto',
  publicUrl: process.env.R2_PUBLIC_URL
}
