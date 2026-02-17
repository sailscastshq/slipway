const Sails = require('sails').constructor

// Singleton instance - initialized once, never torn down (process exits after tests)
let sailsInstance = null
let initPromise = null

async function getSails() {
  if (sailsInstance) {
    return sailsInstance
  }

  // Prevent multiple concurrent initializations
  if (initPromise) {
    return initPromise
  }

  initPromise = new Promise((resolve, reject) => {
    const sailsApp = new Sails()
    sailsApp.load(
      {
        environment: 'test',
        hooks: { shipwright: false, lookout: false }
      },
      (err, sails) => {
        if (err) {
          return reject(err)
        }
        sailsInstance = sails
        resolve(sails)
      }
    )
  })

  return initPromise
}

module.exports = { getSails }
