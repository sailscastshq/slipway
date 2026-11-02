const { isContention } = require('./ci-datastore-retry')

// DB-only callbacks, never Docker, network, logging transports or cutover.
// Use the explicit callback: promise-style Waterline errors are cloned.
// The callback returns the exact work error only after a successful rollback.
// A wrapped rollback error or any commit/release error is deliberately NOT
// replayed, even if its nested cause says SQLITE_BUSY.
module.exports = async function deploymentTransaction(work, options = {}) {
  const now = options.now || Date.now
  const wait =
    options.wait || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const datastore = options.datastore || sails.getDatastore()
  const deadline = Math.min(options.deadline ?? Infinity, now() + 1500)
  // This bounds recovery attempts, not an in-flight native SQLite busy wait.
  // Do not race a transaction with a timeout or release it while it still runs.
  let lastError
  for (let attempt = 0; attempt < 5; attempt++) {
    options.signal?.throwIfAborted()
    if (now() >= deadline) {
      if (lastError) throw lastError
      throw new Error('Deployment database recovery deadline exceeded.')
    }
    let entered = false
    let bodyError
    try {
      return await new Promise((resolve, reject) =>
        datastore.transaction(
          async (db) => {
            entered = true
            try {
              await assertLease(db, options)
              const result = await work(db)
              // A lock wait can outlive ownership; never commit a stale worker's write.
              await assertLease(db, options)
              return result
            } catch (error) {
              bodyError = error
              throw error
            }
          },
          (error, result) => (error ? reject(error) : resolve(result))
        )
      )
    } catch (error) {
      lastError = error
      const safe = entered ? bodyError === error : true
      const contention =
        isContention(error) ||
        (!entered &&
          error?.message ===
            'Transaction is already active on this connection.')
      if (!safe || !contention || attempt === 4) throw error
      const delay = 50 * (attempt + 1)
      if (now() + delay >= deadline) throw error
      await wait(delay)
    }
  }
}

async function assertLease(db, { deploymentId, leaseToken }) {
  if (!leaseToken) return
  const lease = await DeploymentLease.findOne({
    deployment: deploymentId,
    token: leaseToken,
    expiresAt: { '>': Date.now() }
  }).usingConnection(db)
  const deployment = await Deployment.findOne({
    id: deploymentId
  }).usingConnection(db)
  if (!lease || !deployment || deployment.status === 'cancelled') {
    const error = new Error(
      deployment?.status === 'cancelled'
        ? `Deployment ${deploymentId} was cancelled.`
        : `Deployment ${deploymentId} no longer owns its pipeline lease.`
    )
    error.code =
      deployment?.status === 'cancelled'
        ? 'DEPLOYMENT_CANCELLED'
        : 'DEPLOYMENT_LEASE_LOST'
    throw error
  }
}
