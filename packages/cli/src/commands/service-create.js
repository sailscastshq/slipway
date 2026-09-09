import { api } from '../lib/api.js'
import { error } from '../lib/utils.js'
export default async function create(options, positionals) {
  if (!positionals[0]) error('Provide the ID from slipway service:review.')
  try {
    const { service } = await api.post(
      '/services/custom',
      { reviewId: positionals[0] },
      { timeoutMs: 90000 }
    )
    console.log(
      `${service.name}: ${service.status}. Health: ${
        service.customState?.health || 'unverified'
      }.`
    )
  } catch (e) {
    error(e.message)
  }
}
