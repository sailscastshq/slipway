/**
 * Console environment
 *
 * Lightweight configuration for Quest job child processes.
 * Disables hooks that background jobs don't need.
 */
module.exports = {
  hooks: {
    views: false,
    sockets: false,
    pubsub: false
  }
}
