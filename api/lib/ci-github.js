// Connected-repository authority stays on the management side of the sandbox.
async function connection(app) {
  const repository =
    (await GitRepository.findOne({ app: app.id }).decrypt()) ||
    (await GitRepository.findOne({ environment: app.environment }).decrypt())
  if (
    !repository ||
    !/^[A-Za-z0-9_.-]+$/.test(repository.owner) ||
    !/^[A-Za-z0-9_.-]+$/.test(repository.name)
  )
    throw new Error('Connect a GitHub repository before running CI.')
  const environment = await Environment.findOne({ id: app.environment })
  const project =
    environment && (await Project.findOne({ id: environment.project }))
  const provider = await GitProvider.findOne({
    id: repository.provider
  }).decrypt()
  const team = project && (await Team.findOne({ id: project.team }))
  const owner = team && (await User.findOne({ id: team.owner }))
  if (
    !provider ||
    !project ||
    provider.type !== 'github' ||
    !provider.clientSecret ||
    (provider.team
      ? String(provider.team) !== String(project.team)
      : !owner?.isGenesisUser)
  ) {
    throw new Error('The GitHub connection is not available to this team.')
  }
  const base = `https://api.github.com/repos/${encodeURIComponent(
    repository.owner
  )}/${encodeURIComponent(repository.name)}`
  async function request(suffix, { method = 'GET', body } = {}) {
    const response = await fetch(base + suffix, {
      method,
      headers: {
        Authorization: `Bearer ${provider.clientSecret}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15000)
    })
    if (!response.ok) {
      await response.body?.cancel()
      const error = new Error(
        `GitHub CI ${method} ${base + suffix} failed (HTTP ${
          response.status
        }). Check the existing connection's repository permissions.`
      )
      error.status = response.status
      throw error
    }
    let size = 0
    const chunks = []
    for await (const chunk of response.body) {
      size += chunk.length
      if (size > 2 * 1024 * 1024)
        throw new Error('GitHub CI response exceeds its limit.')
      chunks.push(chunk)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  }
  return { repository, environment, project, request }
}
module.exports = { connection }
