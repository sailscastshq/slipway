import { c } from '../lib/colors.js'
import { api } from '../lib/api.js'
import { isLoggedIn } from '../lib/config.js'
import { error, createSpinner, table, formatDate } from '../lib/utils.js'

export default async function auditLog(options) {
  if (!isLoggedIn()) {
    error('Not logged in. Run `slipway login` first.')
  }

  const page = parseInt(options.page, 10) || 1
  const limit = parseInt(options.limit, 10) || 20

  const spin = createSpinner('Fetching audit logs...').start()

  try {
    const { logs, pagination } = await api.auditLogs.list(page, limit)

    spin.stop()

    console.log()
    console.log(`  ${c.bold(c.highlight('Audit Log'))} ${c.dim(`— page ${pagination.page} of ${pagination.totalPages}`)}`)
    console.log()

    if (!logs || logs.length === 0) {
      console.log(`  ${c.dim('No audit log entries found.')}`)
      console.log()
      return
    }

    const rows = logs.map(log => [
      formatDate(log.createdAt),
      log.action,
      log.resourceType,
      log.userName,
      log.ipAddress || 'N/A'
    ])

    table(
      ['Date', 'Action', 'Resource', 'User', 'IP'],
      rows
    )

    if (pagination.page < pagination.totalPages) {
      console.log()
      console.log(`  ${c.dim('Next page:')} ${c.highlight(`slipway audit-log --page ${pagination.page + 1}`)}`)
    }

    console.log()
  } catch (err) {
    spin.fail('Failed to fetch audit logs')
    error(err.message)
  }
}
