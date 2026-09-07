const crypto = require('node:crypto')
const transaction = require('./with-datastore-transaction')

module.exports = async function withWebhookDelivery(source, deliveryId, work) {
  if (
    typeof deliveryId !== 'string' ||
    !/^[a-zA-Z0-9-]{1,128}$/.test(deliveryId)
  ) {
    throw {
      invalidDelivery: {
        message: 'A valid X-GitHub-Delivery header is required.'
      }
    }
  }
  const key = crypto
    .createHash('sha256')
    .update(`${source}:${deliveryId}`)
    .digest('hex')
  const claimed = await transaction(async (db) => {
    await WebhookDelivery.destroy({
      createdAt: { '<': Date.now() - 7 * 86400000 }
    }).usingConnection(db)
    const existing = await WebhookDelivery.findOne({ key }).usingConnection(db)
    if (existing) return { existing }
    if ((await WebhookDelivery.count({}).usingConnection(db)) >= 10000) {
      throw {
        busy: { message: 'Webhook delivery capacity reached. Retry later.' }
      }
    }
    const receipt = await WebhookDelivery.create({ key })
      .usingConnection(db)
      .fetch()
    return { receipt }
  })
  if (claimed.existing) {
    return {
      ...(claimed.existing.result || { received: true, action: 'processing' }),
      duplicate: true
    }
  }
  try {
    const result = await work()
    if (
      result?.action === 'failed' ||
      result?.message?.startsWith('Git error:')
    ) {
      await WebhookDelivery.destroyOne({ id: claimed.receipt.id })
    } else {
      await WebhookDelivery.updateOne({ id: claimed.receipt.id }).set({
        status: 'completed',
        result
      })
    }
    return result
  } catch (error) {
    await WebhookDelivery.destroyOne({ id: claimed.receipt.id })
    throw error
  }
}
