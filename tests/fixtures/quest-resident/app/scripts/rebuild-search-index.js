module.exports = {
  friendlyName: 'Rebuild search index',
  description: 'Synthetic collection indexing report; no external writes.',
  quest: {},
  inputs: {
    collection: {
      type: 'string',
      required: true,
      isIn: ['articles', 'products'],
      description: 'Synthetic collection'
    },
    batchSize: { type: 'number', defaultsTo: 100, min: 1, max: 1000 },
    dryRun: { type: 'boolean', defaultsTo: true }
  },
  fn: async function (inputs) {
    require('../lib/probe')('business:start', {
      name: 'rebuild-search-index',
      inputs
    })
    console.log('{"indexed":999999,"thisIsOnlyALog":true}')
    console.error('fixture-warning: three synthetic records were skipped')
    return this.sails.helpers.buildIndexReport.with(inputs)
  }
}
