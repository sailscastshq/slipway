const { test } = require('sounding')

test(
  'Git-backed content saves use a conventional commit and optimistic SHA',
  {
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: { slug: 'git-content-save' }
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
      branchMappings: { production: 'unused', main: 'production' },
      provider: provider.id,
      environment: current.environments.production.id,
      app: current.apps.web.id
    })

    const originalFetch = global.fetch
    const calls = []
    global.fetch = async (url, options) => {
      calls.push({ url, options })
      return {
        ok: true,
        status: 200,
        json: async () => ({
          content: { sha: 'new-blob-sha' },
          commit: { sha: 'new-commit-sha' }
        })
      }
    }

    try {
      const result = await sails.helpers.git.commitContentFile.with({
        environment: current.environments.production,
        app: current.apps.web,
        user: current.users.genesisUser,
        filePath: 'content/posts/welcome.md',
        content: '# Hello\n',
        expectedSha: 'loaded-blob-sha',
        message: 'chore(content): update posts/welcome'
      })

      expect(result.commitSha).toBe('new-commit-sha')
      expect(result.branch).toBe('main')
      expect(calls.length).toBe(1)
      expect(calls[0].url).toBe(
        'https://api.github.com/repos/sailscastshq/site/contents/content/posts/welcome.md'
      )
      const body = JSON.parse(calls[0].options.body)
      expect(body.sha).toBe('loaded-blob-sha')
      expect(body.branch).toBe('main')
      expect(body.message).toBe(
        'chore(content): update posts/welcome\n\nSlipway-Content-Change: true'
      )
      expect(body.author.name).toBe(current.users.genesisUser.fullName)
      expect(body.author.email).toBe(current.users.genesisUser.email)
    } finally {
      global.fetch = originalFetch
    }
  }
)

test(
  'Git-backed content saves reject a stale editor SHA',
  {
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: { slug: 'git-content-conflict' }
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
      provider: provider.id,
      environment: current.environments.production.id,
      app: current.apps.web.id
    })

    const originalFetch = global.fetch
    global.fetch = async () => ({ ok: false, status: 409 })

    try {
      let conflict
      try {
        await sails.helpers.git.commitContentFile.with({
          environment: current.environments.production,
          app: current.apps.web,
          user: current.users.genesisUser,
          filePath: 'content/posts/welcome.md',
          content: '# Stale edit\n',
          expectedSha: 'stale-sha',
          message: 'chore(content): update posts/welcome'
        })
      } catch (error) {
        conflict = error
      }

      expect(conflict.code).toBe('conflict')
      expect(conflict.raw.message).toBe(
        'This file changed in Git while you were editing it. Reload the latest version before saving.'
      )
    } finally {
      global.fetch = originalFetch
    }
  }
)
