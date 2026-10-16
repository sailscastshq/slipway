module.exports = {
  friendlyName: 'Normalize Bridge action notification',
  sync: true,
  inputs: { value: { type: 'ref' } },
  exits: { success: { outputType: 'ref' } },
  fn: function ({ value }) {
    const text = (v, max) =>
      typeof v === 'string'
        ? v.trim().length > max
          ? v.trim().slice(0, max - 1) + '…'
          : v.trim()
        : ''
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      !text(value.title, 120)
    )
      return null
    const result = {
      title: text(value.title, 120),
      type: ['success', 'info', 'warning', 'error'].includes(value.type)
        ? value.type
        : 'info'
    }
    if (value.subject !== undefined) result.subject = text(value.subject, 300)
    if (value.message !== undefined) result.message = text(value.message, 2000)
    if (value.counts !== undefined) {
      if (
        !Array.isArray(value.counts) ||
        value.counts.length > 8 ||
        value.counts.some(
          (c) =>
            !c ||
            !text(c.label, 60) ||
            !Number.isSafeInteger(c.value) ||
            c.value < 0
        )
      )
        return null
      result.counts = value.counts.map((c) => ({
        label: text(c.label, 60),
        value: c.value
      }))
    }
    if (value.items !== undefined) {
      if (
        !Array.isArray(value.items) ||
        value.items.some((item) => typeof item !== 'string')
      )
        return null
      result.items = value.items.slice(0, 100).map((item) => text(item, 320))
      result.omittedItems = Math.max(0, value.items.length - 100)
    }
    if (value.detailsLabel !== undefined)
      result.detailsLabel = text(value.detailsLabel, 120)
    return result
  }
}
