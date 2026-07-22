const { test } = require('sounding')

test(
  'Content Manager loads the canonical file and blob SHA from GitHub',
  {
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: { slug: 'git-content-read' }
      }
    }
  },
  async ({ sails, world, expect }) => {
    const current = world.current
    const provider = await world.create('gitprovider').with({
      team: current.teams.genesisTeam.id
    })
    await world.create('gitrepository').with({
      fullName: 'sailscastshq/site',
      name: 'site',
      owner: 'sailscastshq',
      cloneUrl: 'git@github.com:sailscastshq/site.git',
      branchMappings: { main: 'production' },
      provider: provider.id,
      environment: current.environments.production.id,
      app: current.apps.web.id
    })

    const originalFetch = global.fetch
    const calls = []
    global.fetch = async (url, options) => {
      calls.push({ url: String(url), options })
      return {
        ok: true,
        status: 200,
        json: async () => ({
          type: 'file',
          sha: 'canonical-blob-sha',
          content: Buffer.from('# Canonical content\n', 'utf8').toString(
            'base64'
          )
        })
      }
    }

    try {
      const result = await sails.helpers.git.readContentFile.with({
        environment: current.environments.production,
        app: current.apps.web,
        filePath: 'content/posts/welcome.md'
      })

      expect(result.mode).toBe('repository')
      expect(result.branch).toBe('main')
      expect(result.sha).toBe('canonical-blob-sha')
      expect(result.content).toBe('# Canonical content\n')
      expect(calls.length).toBe(1)
      expect(calls[0].url).toBe(
        'https://api.github.com/repos/sailscastshq/site/contents/content/posts/welcome.md?ref=main'
      )
      expect(calls[0].options.headers.Authorization).toBe('Bearer github-token')
    } finally {
      global.fetch = originalFetch
    }
  }
)
