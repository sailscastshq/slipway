module.exports = {
  friendlyName: 'Observe own SIGTERM exit',
  fn: async function () {
    require('../lib/probe')('business:start', { name: 'self-signal' })
    // Only this disposable job's own process. This is observed process outcome,
    // not a cancellation API or a signal sent to another application.
    process.kill(process.pid, 'SIGTERM')
    await new Promise((resolve) => setTimeout(resolve, 5000))
    throw new Error('Fixture SIGTERM did not terminate the owned job')
  }
}
