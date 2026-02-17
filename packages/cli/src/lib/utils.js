import { c } from './colors.js'
import { getProjectConfig } from './config.js'

export function error(message) {
  console.error(`${c.error('Error:')} ${message}`)
  process.exit(1)
}

export function warn(message) {
  console.warn(`${c.warn('Warning:')} ${message}`)
}

export function success(message) {
  console.log(`${c.success('✓')} ${message}`)
}

export function info(message) {
  console.log(`${c.info('ℹ')} ${message}`)
}

export function requireProject() {
  const project = getProjectConfig()
  if (!project) {
    error('No Slipway project found. Run `slipway init` or `slipway link <project>` first.')
  }
  return project
}

export function formatDate(timestamp) {
  if (!timestamp) return 'N/A'
  const date = new Date(timestamp)
  return date.toLocaleString()
}

export function formatBytes(bytes) {
  if (!bytes) return 'N/A'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let size = bytes
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++ }
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export function formatDuration(seconds) {
  if (!seconds) return 'N/A'
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${minutes}m ${secs}s`
}

export function statusColor(status) {
  const colorMap = {
    running: c.success,
    pending: c.warn,
    building: c.info,
    deploying: c.info,
    stopped: c.gray,
    failed: c.error,
    cancelled: c.gray
  }
  const colorFn = colorMap[status] || ((s) => s)
  return colorFn(status)
}

// Simple spinner using stdout
export function createSpinner(text) {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
  let i = 0
  let interval = null
  let currentText = text

  return {
    start() {
      process.stdout.write(`\r${c.info(frames[0])} ${currentText}`)
      interval = setInterval(() => {
        i = (i + 1) % frames.length
        process.stdout.write(`\x1b[2K\r${c.info(frames[i])} ${currentText}`)
      }, 80)
      return this
    },
    setText(newText) {
      currentText = newText
      return this
    },
    stop(finalText) {
      if (interval) {
        clearInterval(interval)
        interval = null
      }
      process.stdout.write(`\x1b[2K\r`)
      if (finalText) console.log(finalText)
      return this
    },
    succeed(msg) {
      return this.stop(`${c.success('✓')} ${msg}`)
    },
    fail(msg) {
      return this.stop(`${c.error('✗')} ${msg}`)
    }
  }
}

// Alias for backwards compatibility
export function spinner(text) {
  return createSpinner(text).start()
}

// Simple table display
export function table(headers, rows) {
  // Calculate column widths
  const widths = headers.map((h, i) => {
    const colValues = [h, ...rows.map(r => String(r[i] || ''))]
    return Math.max(...colValues.map(v => stripAnsi(v).length))
  })

  // Print header
  const headerRow = headers.map((h, i) => h.padEnd(widths[i])).join('  ')
  console.log(`  ${c.dim(headerRow)}`)
  console.log(`  ${c.dim('─'.repeat(headerRow.length))}`)

  // Print rows
  for (const row of rows) {
    const rowStr = row.map((cell, i) => {
      const str = String(cell || '')
      const padding = widths[i] - stripAnsi(str).length
      return str + ' '.repeat(Math.max(0, padding))
    }).join('  ')
    console.log(`  ${rowStr}`)
  }
}

// Strip ANSI codes for length calculation
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '')
}
