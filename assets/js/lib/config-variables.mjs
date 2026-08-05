export function configVariableSummary(metadata = {}, changeSummary = '') {
  const context = []

  if (metadata.managed === true) {
    context.push('Managed by Slipway')
  } else if (metadata.kind === 'plain') {
    context.push('Plain config')
  }

  if (changeSummary) context.push(changeSummary)

  return context.join(' · ')
}
