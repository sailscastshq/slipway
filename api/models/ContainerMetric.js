/**
 * ContainerMetric.js
 *
 * Stores periodic CPU/memory snapshots for running containers (apps + services).
 * Collected by the Lookout hook every 30 seconds. Retention is managed by the
 * independent observability maintenance job.
 */

module.exports = {
  datastore: 'observability',
  tableName: 'container_metrics',

  attributes: {
    containerName: {
      type: 'string',
      required: true,
      description: 'Docker container name, e.g. "slipway-myapp-production"',
      columnName: 'container_name'
    },

    containerType: {
      type: 'string',
      isIn: ['app', 'service'],
      required: true,
      description: 'Whether this metric is for an app or a service container',
      columnName: 'container_type'
    },

    cpuPercent: {
      type: 'number',
      required: true,
      description: 'CPU usage percentage, e.g. 2.45',
      columnName: 'cpu_percent'
    },

    memoryUsage: {
      type: 'number',
      required: true,
      description: 'Memory usage in bytes',
      columnName: 'memory_usage'
    },

    memoryLimit: {
      type: 'number',
      required: true,
      description: 'Memory limit in bytes',
      columnName: 'memory_limit'
    },

    memoryPercent: {
      type: 'number',
      required: true,
      description: 'Memory usage percentage, e.g. 34.2',
      columnName: 'memory_percent'
    },

    netIO: {
      type: 'string',
      allowNull: true,
      description: 'Network I/O, e.g. "1.2MB / 500KB"',
      columnName: 'net_io'
    },

    blockIO: {
      type: 'string',
      allowNull: true,
      description: 'Block I/O, e.g. "50MB / 10MB"',
      columnName: 'block_io'
    },

    pids: {
      type: 'number',
      allowNull: true,
      description: 'Number of running processes'
    },

    recordedAt: {
      type: 'number',
      required: true,
      description: 'Timestamp when this metric was recorded (Date.now())',
      columnName: 'recorded_at'
    },

    legacySourceId: {
      type: 'number',
      allowNull: true,
      description:
        'Original ID from the default datastore during the one-time migration',
      columnName: 'legacy_source_id'
    },

    // These IDs refer to records in the default datastore. They intentionally
    // are not Waterline associations because cross-datastore joins are unsafe.
    environment: {
      type: 'number',
      required: true
    },

    app: {
      type: 'number',
      allowNull: true,
      description:
        'The app this metric belongs to (null for service containers)'
    },

    service: {
      type: 'number',
      allowNull: true,
      description:
        'The service this metric belongs to (null for app containers)'
    }
  }
}
