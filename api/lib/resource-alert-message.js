const crypto = require('node:crypto')
function deliveryKey(channel, destination) {
  return crypto
    .createHash('sha256')
    .update(channel + '\0' + destination)
    .digest('hex')
}
function resourceAlertMessage(data) {
  const resourceName = data.cpuHigh ? 'CPU' : 'Memory'
  const percent = data.cpuHigh ? data.cpuPercent : data.memoryPercent
  const memoryDetail =
    (data.memoryUsage / 1048576).toFixed(0) +
    ' MiB of ' +
    (data.memoryLimit / 1048576).toFixed(0) +
    ' MiB'
  const measurement =
    percent.toFixed(1) +
    '%' +
    (data.memHigh ? ' (' + memoryDetail + ')' : ' of one CPU core')
  const observedAtText = new Date(data.observedAt)
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d{3}Z$/, ' UTC')
  const basis = data.memHigh
    ? 'Docker container memory limit; Linux Docker CLI usage excludes inactive file cache.'
    : 'Docker CPU usage: 100% means one CPU core. This is not percent of the configured CPU quota.'
  const recovery =
    'Another warning for this resource is eligible after three valid readings at or below 85%, followed by a new high period.'
  return {
    ...Object.fromEntries(
      [
        'containerName',
        'cpuPercent',
        'memoryPercent',
        'memoryUsage',
        'memoryLimit',
        'cpuHigh',
        'memHigh',
        'observedAt',
        'targetLabel',
        'lookoutUrl',
        'instanceName'
      ]
        .filter((key) => data[key] !== undefined)
        .map((key) => [key, data[key]])
    ),
    resourceName,
    measurement,
    memoryDetail,
    observedAtText,
    basis,
    recovery,
    subject:
      (data.targetLabel || data.containerName) +
      ': ' +
      resourceName.toLowerCase() +
      ' above 90% — ' +
      measurement,
    title: resourceName + ' above 90%',
    summary:
      (data.targetLabel || data.containerName) +
      ': ' +
      resourceName +
      ' ' +
      measurement +
      '. Observed ' +
      observedAtText +
      '. Three consecutive valid readings above 90%, normally sampled every 30 seconds. ' +
      basis +
      ' ' +
      recovery
  }
}
module.exports = { deliveryKey, resourceAlertMessage }
