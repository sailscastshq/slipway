import { api } from '../lib/api.js'
import { requireProject, error } from '../lib/utils.js'
export function renderReadiness(report) {
  console.log(
    `Deployment readiness: ${report.summary.blocker} blockers, ${report.summary.warning} recommendations`
  )
  console.log(
    `Source: ${report.sourceRevision || 'not yet verified'} | Health: ${
      report.healthPath
    }`
  )
  for (const item of report.items) {
    console.log(`  [${item.status}] ${item.category}: ${item.title}`)
    console.log(`    ${item.evidence}`)
    if (item.status !== 'pass') console.log(`    ${item.fix}`)
  }
  console.log(
    report.canDeploy
      ? 'Recommendations do not block deployment. The candidate must pass its HTTP health probe.'
      : 'Resolve the required checks before deployment.'
  )
}
export default async function readiness(options = {}) {
  const project = requireProject()
  try {
    const report = await api.environments.readiness(
      project.project,
      options.env || 'production',
      options.app
    )
    if (options.json) console.log(JSON.stringify(report, null, 2))
    else renderReadiness(report)
    if (!report.canDeploy) process.exitCode = 1
  } catch (err) {
    error(err.message)
  }
}
