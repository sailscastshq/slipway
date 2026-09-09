module.exports = function furnishWake(sails, runtime) {
  const definitions = {
    track: {
      friendlyName: 'Track authoritative Wake goal',
      inputs: {
        name: { type: 'string', required: true },
        req: { type: 'ref', required: true },
        properties: { type: 'ref' },
        eventId: { type: 'string' },
        occurredAt: { type: 'number' }
      },
      fn: async (inputs) => runtime()?.track(inputs) || { accepted: false }
    },
    attribution: {
      friendlyName: 'Get Wake checkout attribution',
      inputs: { req: { type: 'ref', required: true } },
      fn: async ({ req }) => runtime()?.attribution(req) || null
    },
    revenue: {
      friendlyName: 'Commit Wake payment analytics',
      inputs: {
        transactionId: { type: 'string', required: true },
        amount: { type: 'number', required: true },
        currency: { type: 'string', required: true },
        occurredAt: { type: 'number', required: true },
        attributionId: { type: 'string' },
        adjustmentId: { type: 'string' }
      },
      fn: async (inputs) => {
        if (!runtime())
          throw Object.assign(
            Error('Wake unavailable; retry from the durable payment record.'),
            { retriable: true }
          )
        return runtime().revenue(inputs)
      }
    }
  }
  sails.after('hook:helpers:loaded', () => {
    for (const [name, definition] of Object.entries(definitions)) {
      if (sails.helpers.wake?.[name]) {
        sails.log.warn(`Keeping app-owned wake.${name} helper.`)
        continue
      }
      sails.hooks.helpers.furnishHelper('wake.' + name, definition)
    }
  })
}
