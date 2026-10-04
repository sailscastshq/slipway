module.exports.quest = {
  autoStart: false,
  environment: 'test',
  withoutOverlapping: true,
  jobs: [
    'rebuild-search-index',
    'typed-report',
    'throwing-job',
    ...Array.from({ length: 36 }, (_, index) => ({
      name: `telemetry-burst-${index}`,
      script: 'telemetry-burst'
    }))
  ]
}
