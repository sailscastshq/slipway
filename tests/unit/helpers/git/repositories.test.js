const { test } = require('sounding')
const assert = require('node:assert/strict')

function repo(id, name) {
  return {
    id,
    name,
    full_name: `owner/${name}`,
    owner: { login: 'owner' },
    default_branch: 'main'
  }
}

test('GitHub repository pages and branches isolate credentials, respect next links, and do not cache failures', async ({
  sails
}) => {
  const originalFetch = global.fetch
  const originalGet = sails.cache.get
  const originalSet = sails.cache.set
  const cache = new Map()
  const calls = []
  let fail = false
  sails.cache.get = async (key) => cache.get(key)
  sails.cache.set = async (key, value) => cache.set(key, value)
  try {
    global.fetch = async (url, options) => {
      calls.push({ url, token: options.headers.Authorization })
      if (fail) return new Response('', { status: 503 })
      const name = options.headers.Authorization.endsWith('account-a')
        ? 'alpha'
        : 'beta'
      if (url.includes('/branches')) return Response.json([{ name }])
      const page = Number(new URL(url).searchParams.get('page'))
      return Response.json([repo(page, name)], {
        headers:
          page === 1
            ? { link: '<https://api.github.com/user/repos?page=2>; rel="next"' }
            : {}
      })
    }
    const first = await sails.helpers.git.listGithubRepos('account-a', 1)
    assert.equal(first.hasMore, true)
    assert.equal(first.repos[0].name, 'alpha')
    assert.equal(
      (await sails.helpers.git.listGithubRepos('account-b', 1)).repos[0].name,
      'beta'
    )
    assert.equal(
      (await sails.helpers.git.listGithubRepos('account-a', 2)).hasMore,
      false
    )
    await sails.helpers.git.listGithubRepos('account-a', 1)
    assert.equal(calls.length, 3)
    fail = true
    await assert.rejects(sails.helpers.git.listGithubRepos('account-a', 3))
    fail = false
    await sails.helpers.git.listGithubRepos('account-a', 3)
    assert.equal(calls.length, 5)
    assert.equal(
      (
        await sails.helpers.git.listGithubBranches('account-a', 'owner', 'repo')
      )[0].name,
      'alpha'
    )
    assert.equal(
      (
        await sails.helpers.git.listGithubBranches('account-b', 'owner', 'repo')
      )[0].name,
      'beta'
    )
    assert.ok(
      [...cache.keys()].every(
        (key) => !key.includes('account-a') && !key.includes('account-b')
      )
    )
    await assert.rejects(sails.helpers.git.listGithubRepos('account-a', -1))
    await assert.rejects(sails.helpers.git.listGithubRepos('account-a', 1.5))
  } finally {
    global.fetch = originalFetch
    sails.cache.get = originalGet
    sails.cache.set = originalSet
  }
})

test('GitHub selection resolves the exact ID afresh and fails closed for inaccessible or mismatched repositories', async ({
  sails
}) => {
  const originalFetch = global.fetch
  const calls = []
  let status = 200
  let id = 201
  try {
    global.fetch = async (url, options) => {
      calls.push({ url, token: options.headers.Authorization })
      return Response.json(repo(id, 'sailsconf.com'), { status })
    }
    assert.equal(
      (await sails.helpers.git.getGithubRepo('current-token', '201')).id,
      '201'
    )
    assert.deepEqual(calls[0], {
      url: 'https://api.github.com/repositories/201',
      token: 'Bearer current-token'
    })
    status = 404
    assert.equal(
      await sails.helpers.git.getGithubRepo('rotated-token', '201'),
      null
    )
    status = 403
    await assert.rejects(
      sails.helpers.git.getGithubRepo('current-token', '201')
    )
    status = 200
    id = 202
    await assert.rejects(
      sails.helpers.git.getGithubRepo('current-token', '201')
    )
    await assert.rejects(
      sails.helpers.git.getGithubRepo('current-token', '../user/repos')
    )
  } finally {
    global.fetch = originalFetch
  }
})
