/**
 * Quest Configuration
 *
 * Background job scheduling for Slipway.
 * Jobs live in the `scripts/` directory and run as isolated child processes.
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

  // Jobs run in the console environment for lightweight execution
  environment: 'console'
}
