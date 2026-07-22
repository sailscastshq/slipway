const MAX_ATTEMPTS = 20

module.exports = async function withDatastoreTransaction(work) {
  let lastError

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await sails.getDatastore().transaction(work)
    } catch (error) {
      lastError = error
      if (!isRetryableLock(error) || attempt === MAX_ATTEMPTS) throw error
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(attempt * 10, 100))
      )
    }
  }

  throw lastError
}

function isRetryableLock(error) {
  const message = [error?.message, error?.raw?.message, error?.cause?.message]
    .filter(Boolean)
    .join(' ')

  return /transaction is already active|sqlite_busy|database is locked/i.test(
    message
  )
}

module.exports._private = { isRetryableLock }
