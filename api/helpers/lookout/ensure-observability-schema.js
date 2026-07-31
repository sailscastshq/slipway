module.exports = {
  friendlyName: 'Ensure observability schema',

  description:
    'Create Lookout telemetry tables and query-shaped indexes on existing production databases.',

  inputs: {},

  fn: async function () {
    const datastore = sails.getDatastore('observability')

    await datastore.sendNativeQuery(`
      CREATE TABLE IF NOT EXISTS container_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        created_at INTEGER,
        updated_at INTEGER,
        container_name TEXT,
        container_type TEXT,
        cpu_percent INTEGER,
        memory_usage INTEGER,
        memory_limit INTEGER,
        memory_percent INTEGER,
        net_io TEXT,
        block_io TEXT,
        pids INTEGER,
        recorded_at INTEGER,
        environment INTEGER,
        app INTEGER,
        service INTEGER
      )
    `)

    await datastore.sendNativeQuery(`
      CREATE TABLE IF NOT EXISTS telemetry_spans (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        created_at INTEGER,
        updated_at INTEGER,
        trace_id TEXT,
        span_id TEXT,
        parent_span_id TEXT,
        name TEXT,
        kind TEXT,
        method TEXT,
        url TEXT,
        status_code INTEGER,
        duration INTEGER,
        started_at INTEGER,
        attributes TEXT,
        environment TEXT
      )
    `)

    await datastore.sendNativeQuery(`
      CREATE TABLE IF NOT EXISTS telemetry_exceptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        created_at INTEGER,
        updated_at INTEGER,
        exception_type TEXT,
        message TEXT,
        stack_trace TEXT,
        handled TEXT,
        method TEXT,
        url TEXT,
        trace_id TEXT,
        occurred_at INTEGER,
        environment TEXT
      )
    `)

    await datastore.sendNativeQuery(`
      CREATE TABLE IF NOT EXISTS telemetry_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        created_at INTEGER,
        updated_at INTEGER,
        name TEXT,
        value INTEGER,
        unit TEXT,
        attributes TEXT,
        recorded_at INTEGER,
        environment TEXT
      )
    `)

    await datastore.sendNativeQuery(`
      CREATE TABLE IF NOT EXISTS observability_job_health (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        created_at INTEGER,
        updated_at INTEGER,
        job_name TEXT NOT NULL UNIQUE,
        last_attempt_at INTEGER,
        last_success_at INTEGER,
        last_failure_at INTEGER,
        last_error TEXT,
        last_duration_ms INTEGER,
        row_count INTEGER NOT NULL DEFAULT 0,
        details TEXT
      )
    `)

    const indexes = [
      [
        'container_metrics_environment_recorded_at',
        'container_metrics (environment, recorded_at DESC)'
      ],
      [
        'container_metrics_container_recorded_at',
        'container_metrics (container_name, recorded_at DESC)'
      ],
      ['container_metrics_recorded_at', 'container_metrics (recorded_at, id)'],
      [
        'telemetry_spans_environment_started_at',
        'telemetry_spans (environment, started_at DESC)'
      ],
      [
        'telemetry_spans_trace_started_at',
        'telemetry_spans (trace_id, started_at DESC)'
      ],
      ['telemetry_spans_started_at', 'telemetry_spans (started_at, id)'],
      [
        'telemetry_exceptions_environment_occurred_at',
        'telemetry_exceptions (environment, occurred_at DESC)'
      ],
      [
        'telemetry_exceptions_trace_occurred_at',
        'telemetry_exceptions (trace_id, occurred_at DESC)'
      ],
      [
        'telemetry_exceptions_occurred_at',
        'telemetry_exceptions (occurred_at, id)'
      ],
      [
        'telemetry_metrics_environment_recorded_at',
        'telemetry_metrics (environment, recorded_at DESC)'
      ],
      [
        'telemetry_metrics_environment_name_recorded_at',
        'telemetry_metrics (environment, name, recorded_at DESC)'
      ],
      ['telemetry_metrics_recorded_at', 'telemetry_metrics (recorded_at, id)']
    ]

    for (const [name, shape] of indexes) {
      await datastore.sendNativeQuery(
        `CREATE INDEX IF NOT EXISTS ${name} ON ${shape}`
      )
    }

    return { ready: true }
  }
}
