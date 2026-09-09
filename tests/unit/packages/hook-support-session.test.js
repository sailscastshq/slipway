const { test } = require('sounding')
const assert = require('node:assert/strict')
const express = require('express')
const sessions = require('express-session')
const overlay = require('../../../packages/hook/lib/bridge-support-session')
test('support identity never reaches the normal session store or cookie, including parallel normal requests', async () => {
  const app = express(),
    store = new sessions.MemoryStore()
  app.use(
    sessions({
      secret: 'isolated-support-session-test-secret',
      resave: false,
      saveUninitialized: false,
      store
    })
  )
  app.get('/login', (req, res) => {
    req.session.creatorId = 'operator'
    req.session.activeTeamId = 'operator-team'
    res.json({ id: req.session.creatorId })
  })
  app.get('/normal', (req, res) =>
    res.json({ id: req.session.creatorId, team: req.session.activeTeamId })
  )
  app.get('/support', (req, res) => {
    overlay(
      req,
      { actor: 'admin', subject: 'customer' },
      { creatorId: 'customer' }
    )
    assert.equal(req.session.activeTeamId, undefined)
    req.session.extra = 'never-persist'
    req.session.save(() => res.json({ id: req.session.creatorId }))
  })
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const url = `http://127.0.0.1:${server.address().port}`
  try {
    const login = await fetch(url + '/login')
    const cookie = login.headers.get('set-cookie').split(';')[0]
    const [support, normal] = await Promise.all([
      fetch(url + '/support', { headers: { cookie } }),
      fetch(url + '/normal', { headers: { cookie } })
    ])
    assert.equal((await support.json()).id, 'customer')
    assert.equal(support.headers.get('set-cookie'), null)
    assert.equal((await normal.json()).id, 'operator')
    const after = await fetch(url + '/normal', { headers: { cookie } })
    assert.deepEqual(await after.json(), {
      id: 'operator',
      team: 'operator-team'
    })
    const records = await new Promise((resolve, reject) =>
      store.all((error, result) => (error ? reject(error) : resolve(result)))
    )
    assert.equal(Object.keys(records).length, 1)
    assert.ok(!JSON.stringify(records).includes('customer'))
    assert.ok(!JSON.stringify(records).includes('never-persist'))
  } finally {
    await new Promise((resolve) => server.close(resolve))
    store.clear()
  }
})
