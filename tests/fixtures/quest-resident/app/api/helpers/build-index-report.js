module.exports = {
  friendlyName: 'Build index report',
  description:
    'Count disposable synthetic records without reading or writing external state.',
  sync: true,
  inputs: {
    collection: {
      type: 'string',
      required: true,
      isIn: ['articles', 'products']
    },
    batchSize: { type: 'number', defaultsTo: 100, min: 1, max: 1000 },
    dryRun: { type: 'boolean', defaultsTo: true }
  },
  fn(inputs, exits) {
    const records = Array.from({ length: 243 }, (_, index) => ({
      collection: inputs.collection,
      indexable: index < 240
    }))
    let indexed = 0,
      skipped = 0
    const batchSize = Math.floor(inputs.batchSize)
    for (let offset = 0; offset < records.length; offset += batchSize)
      for (const record of records.slice(offset, offset + batchSize)) {
        if (record.collection === inputs.collection && record.indexable)
          indexed++
        else skipped++
      }
    return exits.success({ indexed, skipped, dryRun: inputs.dryRun })
  }
}
