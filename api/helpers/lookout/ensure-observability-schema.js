module.exports = {
  friendlyName: 'Ensure observability schema',

  description:
    'Create Lookout telemetry tables and query-shaped indexes on existing production databases.',

  inputs: {},

  fn: async function () {
    const datastore = sails.getDatastore('observability')

    await datastore.sendNativeQuery(`CREATE TABLE IF NOT EXISTS quest_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, created_at INTEGER, updated_at INTEGER,
      run_id TEXT NOT NULL UNIQUE, request_key TEXT UNIQUE, input_hash TEXT NOT NULL,
      environment TEXT NOT NULL, app TEXT NOT NULL, deployment_id TEXT, runtime_id TEXT,
      job_name TEXT NOT NULL, actor TEXT, trigger TEXT, state TEXT, sequence INTEGER DEFAULT 0,
      requested_at INTEGER NOT NULL, started_at INTEGER, finished_at INTEGER, duration INTEGER,
      exit_code INTEGER, signal TEXT, inputs TEXT, result TEXT, result_status TEXT, error TEXT,
      stdout TEXT, stderr TEXT, logs_truncated INTEGER DEFAULT 0, logs_available INTEGER DEFAULT 0
    )`)
    await datastore.sendNativeQuery(
      'CREATE INDEX IF NOT EXISTS quest_runs_scope_time ON quest_runs (environment, app, requested_at DESC, id DESC)'
    )
    await datastore.sendNativeQuery(
      'CREATE INDEX IF NOT EXISTS quest_runs_retention ON quest_runs (requested_at, id)'
    )

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
      CREATE TABLE IF NOT EXISTS resource_alert_states (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        created_at INTEGER,
        updated_at INTEGER,
        container_name TEXT NOT NULL UNIQUE,
        cpu_active INTEGER NOT NULL DEFAULT 0,
        memory_active INTEGER NOT NULL DEFAULT 0,
        cpu_high_samples INTEGER NOT NULL DEFAULT 0,
        memory_high_samples INTEGER NOT NULL DEFAULT 0,
        cpu_recovery_samples INTEGER NOT NULL DEFAULT 0,
        memory_recovery_samples INTEGER NOT NULL DEFAULT 0,
        last_sample_at INTEGER NOT NULL
      )
    `)

    await datastore.sendNativeQuery(`CREATE TABLE IF NOT EXISTS resource_alert_deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, created_at INTEGER, updated_at INTEGER,
      incident_key TEXT NOT NULL UNIQUE, container_name TEXT NOT NULL, resource TEXT NOT NULL,
      observed_at INTEGER NOT NULL, payload TEXT NOT NULL, receipts TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0,
      lease_owner TEXT NOT NULL DEFAULT '', last_outcome TEXT NOT NULL DEFAULT 'queued'
    )`)
    await datastore.sendNativeQuery(`CREATE INDEX IF NOT EXISTS resource_alert_deliveries_due
      ON resource_alert_deliveries (status, next_attempt_at, lease_until)`)
    await datastore.sendNativeQuery(`CREATE INDEX IF NOT EXISTS resource_alert_deliveries_container_resource
      ON resource_alert_deliveries (container_name, resource, observed_at)`)

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
      CREATE TABLE IF NOT EXISTS telemetry_connections (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        created_at INTEGER,
        updated_at INTEGER,
        app_id TEXT NOT NULL UNIQUE,
        environment TEXT NOT NULL,
        deployment_id TEXT,
        hook_version TEXT NOT NULL,
        protocol_version INTEGER NOT NULL,
        capabilities TEXT NOT NULL DEFAULT '{}',
        enabled TEXT NOT NULL DEFAULT 1,
        started_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL
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

    await datastore.sendNativeQuery(`CREATE TABLE IF NOT EXISTS telemetry_ingestion_budgets (
      id INTEGER PRIMARY KEY AUTOINCREMENT, environment TEXT NOT NULL UNIQUE,
      window_start INTEGER NOT NULL DEFAULT 0, events INTEGER NOT NULL DEFAULT 0,
      bytes INTEGER NOT NULL DEFAULT 0, requests INTEGER NOT NULL DEFAULT 0,
      rejected_events INTEGER NOT NULL DEFAULT 0, rejected_requests INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER, updated_at INTEGER
    )`)
    for (const table of [
      'telemetry_spans',
      'telemetry_exceptions',
      'telemetry_metrics'
    ]) {
      await datastore.sendNativeQuery(
        `UPDATE ${table} SET created_at=? WHERE created_at IS NULL OR created_at>?`,
        [Date.now(), Date.now()]
      )
      await datastore.sendNativeQuery(
        `CREATE INDEX IF NOT EXISTS ${table}_receipt_retention ON ${table} (created_at, id)`
      )
    }

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
      ['telemetry_metrics_recorded_at', 'telemetry_metrics (recorded_at, id)'],
      [
        'telemetry_connections_environment_last_seen',
        'telemetry_connections (environment, last_seen_at DESC)'
      ]
    ]

    for (const [name, shape] of indexes) {
      await datastore.sendNativeQuery(
        `CREATE INDEX IF NOT EXISTS ${name} ON ${shape}`
      )
    }

    return { ready: true }
  }
}
