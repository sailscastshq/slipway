const { AsyncLocalStorage } = require('node:async_hooks')
module.exports = function guardWrites(sails, onDenied) {
  const context = new AsyncLocalStorage(),
    restorers = []
  const wrap = (owner, key) => {
    if (typeof owner?.[key] !== 'function') return
    const original = owner[key]
    const guarded = function (...args) {
      const session = context.getStore()
      if (session) {
        onDenied(session)
        throw Error('Writes are unavailable in a read-only support view.')
      }
      return original.apply(this, args)
    }
    owner[key] = guarded
    restorers.push(() => {
      if (owner[key] === guarded) owner[key] = original
    })
  }
  for (const model of Object.values(sails.models || {}))
    for (const method of [
      'create',
      'createEach',
      'findOrCreate',
      'update',
      'updateOne',
      'destroy',
      'destroyOne',
      'archive',
      'archiveOne',
      'addToCollection',
      'removeFromCollection',
      'replaceCollection'
    ])
      wrap(model, method)
  for (const datastore of Object.values(sails.getDatastores?.() || {})) {
    wrap(datastore, 'sendNativeQuery')
    wrap(datastore, 'transaction')
  }
  for (const method of ['run', 'schedule', 'enqueue']) wrap(sails.quest, method)
  return {
    run: (session, next) => context.run(session, next),
    stop: () => {
      restorers.forEach((restore) => restore())
      context.disable()
    }
  }
}
