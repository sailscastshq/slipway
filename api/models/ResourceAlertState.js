/** Durable high-resource incident state for each managed container. */
module.exports = {
  datastore: 'observability',
  tableName: 'resource_alert_states',

  attributes: {
    containerName: {
      type: 'string',
      required: true,
      unique: true,
      columnName: 'container_name'
    },
    cpuActive: { type: 'boolean', defaultsTo: false, columnName: 'cpu_active' },
    memoryActive: {
      type: 'boolean',
      defaultsTo: false,
      columnName: 'memory_active'
    },
    cpuHighSamples: {
      type: 'number',
      defaultsTo: 0,
      columnName: 'cpu_high_samples'
    },
    memoryHighSamples: {
      type: 'number',
      defaultsTo: 0,
      columnName: 'memory_high_samples'
    },
    cpuRecoverySamples: {
      type: 'number',
      defaultsTo: 0,
      columnName: 'cpu_recovery_samples'
    },
    memoryRecoverySamples: {
      type: 'number',
      defaultsTo: 0,
      columnName: 'memory_recovery_samples'
    },
    lastSampleAt: {
      type: 'number',
      required: true,
      columnName: 'last_sample_at'
    }
  }
}
