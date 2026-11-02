/**
 * Quest Configuration
 *
 * Background job scheduling for Slipway.
 * Jobs live in the `scripts/` directory and reuse a separate loaded Sails child.
 *
 * @see https://github.com/sailscastshq/sails-hook-quest
 */
module.exports.quest = {
  // Auto-start scheduled jobs when Sails lifts
  autoStart: true,

  // Default timezone for cron expressions
  timezone: 'UTC',

  // Prevent overlapping runs by default
  withoutOverlapping: true,

  // The reusable child loads the console environment without resident collectors
  environment: 'console',

  // Reuse Quest's owned Linux child lifecycle and bounded live-log snapshots.
  runtimeControls: true,
  logBytes: 32768
}
