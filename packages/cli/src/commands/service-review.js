import fs from 'node:fs/promises'
import { api } from '../lib/api.js'
import { requireProject, error } from '../lib/utils.js'
export default async function review(options, positionals) {
  const project = requireProject()
  try {
    const definition = options.definition
      ? JSON.parse(await fs.readFile(options.definition, 'utf8'))
      : {}
    if (positionals[0]) definition.image = positionals[0]
    if (options.name) definition.name = options.name
    if (options.port) definition.port = Number(options.port)
    if (options.app) definition.appIds = options.app.split(',')
    const data = await api.post(
      `/projects/${project.project}/environments/${
        options.env || 'production'
      }/services/custom/review`,
      { definition },
      { timeoutMs: 150000 }
    )
    console.log(JSON.stringify(data.review, null, 2))
    if (!options.json)
      console.log(
        `\nCreate this exact review with: slipway service:create ${data.review.id}`
      )
  } catch (e) {
    error(e.message)
  }
}
