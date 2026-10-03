module.exports.quest = {
  autoStart: true,
  environment: 'staging',
  withoutOverlapping: true,
  jobs: [
    'rebuild-search-index',
    'typed-report',
    'result-value',
    'named-exit',
    'throwing-job',
    'self-signal',
    'validated-job',
    'protected-report',
    'slow-job',
    { name: 'slow-overlap', script: 'slow-job', interval: 2000 },
    {
      name: 'index-from-config',
      script: 'rebuild-search-index',
      interval: 600000,
      inputs: { collection: 'articles', batchSize: 50, dryRun: false }
    },
    {
      name: 'invalid-schedule',
      script: 'result-value',
      cron: 'definitely-not-a-cron'
    },
    {
      name: 'expired-schedule',
      script: 'result-value',
      date: '2000-01-01T00:00:00.000Z'
    },
    { name: 'stopped-schedule', script: 'result-value', interval: 600000 },
    {
      name: 'consumed-once',
      script: 'result-value',
      timeout: 200,
      inputs: { value: 'one-shot' }
    },
    {
      name: 'timezone-cron',
      script: 'result-value',
      cron: '0 0 1 1 *',
      timezone: 'UTC',
      cronOptions: { tz: 'America/New_York' }
    },
    {
      name: 'timezone-default',
      script: 'result-value',
      cron: '0 0 1 1 *',
      timezone: 'UTC',
      cronOptions: { tz: '', timezone: 'Pacific/Auckland' }
    }
  ]
}
