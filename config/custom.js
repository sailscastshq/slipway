/**
 * Custom configuration
 * (sails.config.custom)
 *
 * One-off settings specific to your application.
 *
 * For more information on custom configuration, visit:
 * https://sailsjs.com/config/custom
 */

module.exports.custom = {
  /**************************************************************************
   *                                                                         *
   * The base URL to use during development.                                 *
   *                                                                         *
   * • No trailing slash at the end                                          *
   * • `http://` or `https://` at the beginning.                             *
   *                                                                         *
   * > This is for use in custom logic that builds URLs.                     *
   * > It is particularly handy for building dynamic links in emails,        *
   * > but it can also be used for user-uploaded images, webhooks, etc.      *
   *                                                                         *
   **************************************************************************/
  baseUrl: 'http://localhost:1337',

  /**************************************************************************
   *                                                                         *
   * The TTL (time-to-live) for various sorts of tokens before they expire.  *
   *                                                                         *
   **************************************************************************/
  passwordResetTokenTTL: 24 * 60 * 60 * 1000, // 24 hours
  emailProofTokenTTL: 24 * 60 * 60 * 1000, // 24 hours

  /**************************************************************************
   *                                                                         *
   * The extended length that browsers should retain the session cookie      *
   * if "Remember Me" was checked while logging in.                          *
   *                                                                         *
   **************************************************************************/
  rememberMeCookieMaxAge: 30 * 24 * 60 * 60 * 1000, // 30 days

  // Email address for receiving support messages & other correspondences.
  internalEmail: 'support+development@example.com',

  /**************************************************************************
   *                                                                         *
   * Slipway configuration                                                   *
   *                                                                         *
   **************************************************************************/

  // Base domain for deployed apps (e.g., myapp-production.localhost)
  slipwayDomain: 'localhost',

  // Docker network name for app containers
  slipwayNetwork: 'slipway',

  // Directory where app source code is stored
  slipwayAppsDir: '/var/slipway/apps',

  // Port range for app containers (Slipway allocates from this range)
  slipwayPortRange: { start: 1338, end: 1500 },

  // Host interface used when checking and reserving app container ports
  slipwayPortHost: '0.0.0.0',

  // Keep database transfers bounded on memory-constrained VPS hosts.
  databaseOperations: {
    backupMaxBytes: 50 * 1024 * 1024 * 1024,
    restoreMaxBytes: 50 * 1024 * 1024 * 1024,
    sqlImportMaxBytes: 500 * 1024 * 1024,
    minFreeDiskBytes: 512 * 1024 * 1024,
    backupTimeoutMs: 60 * 60 * 1000,
    restoreTimeoutMs: 60 * 60 * 1000,
    sqlImportTimeoutMs: 30 * 60 * 1000,
    maxProcessOutputBytes: 64 * 1024,
    maxProcessStderrBytes: 64 * 1024,
    killGraceMs: 5000
  },

  // Helm runs application-aware JavaScript in isolated, bounded processes.
  helm: {
    timeoutMs: 30 * 1000,
    processGraceMs: 2 * 1000,
    maxSourceBytes: 64 * 1024,
    maxLogBytes: 64 * 1024,
    maxResultBytes: 128 * 1024,
    maxProcessOutputBytes: 256 * 1024,
    maxProcessStderrBytes: 64 * 1024,
    killGraceMs: 250
  },

  // Lookout keeps infrastructure samples for 24 hours and application
  // telemetry for 7 days. Maintenance uses bounded batches so pruning cannot
  // hold a long SQLite write lock on a busy host.
  observability: {
    containerMetricsRetentionMs: 24 * 60 * 60 * 1000,
    applicationTelemetryRetentionMs: 7 * 24 * 60 * 60 * 1000,
    pruneBatchSize: 500,
    maxPruneBatchesPerRun: 20
  },

  // API version (used for building API URLs)
  apiVersion: 'v1',

  // How long users must wait before requesting another auth email link.
  emailLinkResendCooldown: 30 * 1000

  /***************************************************************************
   *                                                                          *
   * Any other custom config this Sails app should use during development.    *
   *                                                                          *
   ***************************************************************************/
  // sendgridSecret: 'SG.fake.3e0Bn0qSQVnwb1E4qNPz9JZP5vLZYqjh7sn8S93oSHU',
  // stripeSecret: 'sk_test_Zzd814nldl91104qor5911gjald',
  // …
}
