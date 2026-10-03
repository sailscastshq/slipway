const dayNames = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday'
]

function duration(value) {
  if (!Number.isFinite(value) || value < 0) return null
  for (const [size, unit] of [
    [86400000, 'day'],
    [3600000, 'hour'],
    [60000, 'minute'],
    [1000, 'second']
  ]) {
    if (value >= size && value % size === 0) {
      const count = value / size
      return `${count} ${unit}${count === 1 ? '' : 's'}`
    }
  }
  return `${value} milliseconds`
}

// Presentation only. The resident hook validates and schedules the expression;
// this deliberately does not predict due times, interpret DST, or add a parser.
function cronSummary(value) {
  if (typeof value !== 'string') return 'Recurring cron expression'
  const fields = value.trim().split(/\s+/)
  if (fields.length !== 5) return 'Recurring cron expression'
  const [minute, hour, date, month, day] = fields
  if (date !== '*' || month !== '*') return 'Recurring cron expression'
  if (minute === '*' && hour === '*' && day === '*') return 'Every minute'
  if (/^\*\/[1-9]\d*$/.test(minute) && hour === '*' && day === '*') {
    const step = Number(minute.slice(2))
    if (step < 60 && 60 % step === 0) return `Every ${step} minutes`
  }
  if (!/^\d+$/.test(minute) || Number(minute) > 59)
    return 'Recurring cron expression'
  if (hour === '*' && day === '*') return `Hourly at minute ${Number(minute)}`
  if (!/^\d+$/.test(hour) || Number(hour) > 23)
    return 'Recurring cron expression'
  const time = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
  if (day === '*') return `Daily at ${time}`
  if (day === '1-5') return `Monday–Friday at ${time}`
  if (/^[0-7]$/.test(day)) return `${dayNames[Number(day) % 7]} at ${time}`
  return 'Recurring cron expression'
}

function restartNote(job) {
  const restart = job?.scheduleState?.restart
  if (
    !restart ||
    restart.persistence !== 'memory_only' ||
    restart.missedRuns !== 'not_replayed'
  )
    return job?.scheduleType === 'manual'
      ? null
      : 'Restart behavior unavailable from this runtime.'
  if (restart.timing === 'none') return null
  const deadline =
    job.scheduleType === 'timeout'
      ? ' This is a schedule, not an execution deadline.'
      : ''
  if (restart.timing === 'relative_to_registration')
    return (
      (restart.oneShot
        ? 'Runs once; the delay starts again when the app registers it.'
        : 'The interval starts again when the app registers it. Missed runs are not replayed.') +
      deadline
    )
  if (restart.timing === 'wall_clock')
    return (
      (restart.oneShot
        ? 'One-time wall-clock schedule. Past occurrences are not replayed on restart.'
        : 'The app runtime determines timezone changes. Missed runs are not replayed.') +
      deadline
    )
  return 'Restart behavior unavailable from this runtime.'
}

export function questScheduleDetails(job) {
  const value = job?.schedule
  let summary = 'Unavailable'
  if (job?.scheduleState?.validation === 'invalid')
    summary = 'Invalid source schedule'
  else
    switch (job?.scheduleType) {
      case 'cron':
        summary = cronSummary(value)
        break
      case 'interval': {
        const label =
          typeof value === 'number'
            ? duration(value)
            : typeof value === 'string'
            ? value.trim()
            : null
        summary = label
          ? /^every\b/i.test(label)
            ? label
            : /^\d/.test(label)
            ? `Every ${label}`
            : `Recurring: ${label}`
          : 'Recurring interval'
        break
      }
      case 'timeout': {
        const label =
          typeof value === 'number'
            ? duration(value)
            : typeof value === 'string'
            ? value.trim()
            : null
        summary = label
          ? /^at\b/i.test(label)
            ? `Once ${label}`
            : `Once after ${label}`
          : 'One-time schedule'
        break
      }
      case 'date':
        summary = 'Once at the source date'
        break
      case 'manual':
        summary = 'Run on demand'
        break
    }
  return { summary, note: restartNote(job) }
}
