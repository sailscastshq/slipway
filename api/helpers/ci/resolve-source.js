const contract = require('../../../packages/cli/src/lib/ci-contract.cjs')
module.exports = {
  friendlyName: 'Resolve canonical CI source',
  description:
    'Verify the connected GitHub repository, exact branch head and immutable package blobs on the server. Never execute repository code.',
  inputs: {
    app: { type: 'ref', required: true },
    commit: { type: 'string', required: true },
    branch: { type: 'string', required: true }
  },
  exits: { success: { outputType: 'ref' } },
  fn: async function ({ app, commit, branch }) {
    if (
      !/^[a-f0-9]{40}$/.test(commit) ||
      !/^[A-Za-z0-9][A-Za-z0-9_./-]{0,159}$/.test(branch) ||
      branch.includes('..')
    )
      throw new Error('An exact commit and reviewed branch are required.')
    const repository =
      (await GitRepository.findOne({ app: app.id })) ||
      (await GitRepository.findOne({ environment: app.environment }))
    if (
      !repository ||
      !/^[A-Za-z0-9_.-]+$/.test(repository.owner) ||
      !/^[A-Za-z0-9_.-]+$/.test(repository.name)
    )
      throw new Error('Connect a GitHub repository before enabling CI.')
    const provider = await GitProvider.findOne({
      id: repository.provider
    }).decrypt()
    const environment = await Environment.findOne({ id: app.environment })
    const project =
      environment && (await Project.findOne({ id: environment.project }))
    const team = project && (await Team.findOne({ id: project.team }))
    const legacyOwner = team && (await User.findOne({ id: team.owner }))
    if (
      !project ||
      !provider ||
      (provider.team
        ? String(provider.team) !== String(project.team)
        : !legacyOwner?.isGenesisUser)
    )
      throw new Error('The GitHub connection is not available to this team.')
    if (provider?.type !== 'github' || !provider.clientSecret)
      throw new Error('Reconnect GitHub before configuring CI.')
    const base = `https://api.github.com/repos/${encodeURIComponent(
      repository.owner
    )}/${encodeURIComponent(repository.name)}`
    const read = async (suffix) => {
      const response = await fetch(base + suffix, {
        headers: {
          Authorization: `Bearer ${provider.clientSecret}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28'
        },
        signal: AbortSignal.timeout(15000)
      })
      if (!response.ok) {
        await response.body?.cancel()
        throw new Error('GitHub could not verify the requested CI source.')
      }
      const chunks = []
      let size = 0
      for await (const chunk of response.body) {
        size += chunk.length
        if (size > 16 * 1024 * 1024) {
          throw new Error('CI source metadata exceeds its limit.')
        }
        chunks.push(chunk)
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'))
    }
    const [metadata, ref, revision] = await Promise.all([
      read(''),
      read(
        '/git/ref/heads/' + branch.split('/').map(encodeURIComponent).join('/')
      ),
      read('/commits/' + commit)
    ])
    if (
      String(metadata.id) !== repository.externalId ||
      ref.object?.sha !== commit ||
      revision.sha !== commit ||
      !/^[a-f0-9]{40}$/.test(revision.commit?.tree?.sha || '')
    )
      throw new Error(
        'The commit must be the current head of the reviewed connected branch.'
      )
    const blobs = await Promise.all(
      ['package.json', 'package-lock.json'].map((file) =>
        read('/contents/' + file + '?ref=' + commit)
      )
    )
    const contents = blobs.map((blob, index) => {
      if (
        blob.type !== 'file' ||
        blob.encoding !== 'base64' ||
        typeof blob.content !== 'string'
      )
        throw new Error(
          'A regular package manifest and npm lockfile are required.'
        )
      const text = Buffer.from(
        blob.content.replace(/\s/g, ''),
        'base64'
      ).toString('utf8')
      if (Buffer.byteLength(text) > (index === 0 ? 262144 : 8 * 1024 * 1024))
        throw new Error('CI package metadata exceeds its limit.')
      return text
    })
    const manifest = JSON.parse(contents[0]),
      lock = JSON.parse(contents[1])
    if (
      manifest.version !== lock.version ||
      manifest.version !== lock.packages?.['']?.version
    )
      throw new Error('Package and lockfile root versions must agree.')
    return {
      repositoryId: repository.externalId,
      repositoryName: repository.fullName,
      commit,
      tree: revision.commit.tree.sha,
      branch,
      manifest,
      manifestDigest: contract.digest(contents[0]),
      lockDigest: contract.digest(contents[1])
    }
  }
}
