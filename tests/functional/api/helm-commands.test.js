const { test } = require('sounding')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')

const SOURCE = 'node -e "process.stdout.write(\'fixture only\')"'
const RESULT = {
  success: false,
  status: 'error',
  exitCode: 7,
  signal: null,
  exitStatusObserved: true,
  terminationConfirmed: true,
  terminationScope: 'foreground-process-group',
  durationMs: 12,
  outputBytes: 32,
  truncated: false,
  stdout: 'transient stdout fixture',
  stderr: 'transient stderr fixture',
  output: 'transient stdout fixture\ntransient stderr fixture'
}
const worldFor = (slug) => ({
  name: 'configured-slipway',
  context: { deploymentTarget: { slug, name: 'Helm command fixture' } }
})
const commandHash = (source) =>
  crypto
    .createHash('sha256')
    .update('helm-command-v1\0')
    .update(source)
    .digest('hex')

// HTTP transport cannot inherit Sounding's virtual session. Use disposable
// bearer tokens against the real authentication and policy middleware.
async function authenticatedRequest(sails, request, user) {
  const token = crypto.randomBytes(32).toString('hex')
  await sails.models.clitoken.create({
    user: user.id,
    token: crypto.createHash('sha256').update(token).digest('hex')
  })
  const client = request.withHeaders({
    authorization: `Bearer sl_${token}`,
    Accept: 'application/json'
  })
  // Sounding 0.2 treats application/x-ndjson as one JSON object. Preserve the
  // real wire stream with native fetch while using Sounding for JSON endpoints.
  const address = sails.hooks.http.server.address()
  client.openStream = (path, data) =>
    fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer sl_${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(15000)
    })
  client.streamPost = async (path, data) => {
    const response = await client.openStream(path, data)
    const text = await response.text()
    return {
      status: response.status,
      data: response.headers.get('content-type')?.includes('application/json')
        ? JSON.parse(text)
        : undefined,
      header: (name) => response.headers.get(name),
      text: async () => text
    }
  }
  return client
}

async function open({ sails, world, request }, actor = 'genesisUser') {
  const current = world.current
  const project = current.projects.deploymentTarget
  const environment = current.environments.production
  const app = current.apps.web
  await sails.models.app.updateOne({ id: app.id }).set({
    status: 'running',
    containerName: 'sounding-disposable-command-fixture'
  })
  const browser = await authenticatedRequest(
    sails,
    request,
    typeof actor === 'string' ? current.users[actor] : actor
  )
  return {
    current,
    project,
    environment,
    app,
    browser,
    base: `/api/v1/projects/${project.slug}/environments/${environment.slug}/helm`
  }
}
async function events(response) {
  assert.equal(response.status, 200, await response.text())
  assert.match(response.header('content-type'), /application\/x-ndjson/)
  assert.match(response.header('cache-control'), /no-store/)
  return (await response.text()).trim().split('\n').map(JSON.parse)
}
function stubRunner(sails, run = async () => RESULT) {
  const original = sails.helpers.helm.executeCommandInContainer
  const calls = []
  sails.helpers.helm.executeCommandInContainer = {
    async with(input) {
      calls.push(input)
      return run(input)
    }
  }
  return {
    calls,
    restore() {
      sails.helpers.helm.executeCommandInContainer = original
    }
  }
}
async function arm(browser, base, code = SOURCE, extra = {}) {
  const response = await browser.post(`${base}/arm-writes`, {
    mode: 'command',
    code,
    ...extra
  })
  assert.equal(response.status, 201, await response.text())
  return response.data
}
async function execute(browser, base, body = {}) {
  return browser.streamPost(`${base}/commands`, {
    code: SOURCE,
    executionId: crypto.randomUUID(),
    ...body
  })
}

test(
  'Helm command inspection and production arms bind the exact mode, source, actor, and target',
  {
    transport: 'http',
    world: worldFor('helm-command-arm-contract')
  },
  async (context) => {
    const { sails } = context
    const { browser, base, app, current, environment } = await open(context)
    const runner = stubRunner(sails)
    const originalJavascript = sails.helpers.helm.executeInContainer
    let javascriptExecutions = 0
    sails.helpers.helm.executeInContainer = async () => {
      javascriptExecutions++
      return { success: true }
    }
    try {
      for (const suffix of ['inspect-source', 'arm-writes', 'commands']) {
        const misplaced = await browser.post(`${base}/${suffix}`, {
          mode: 'command',
          code: 'await User.find()',
          executionId: crypto.randomUUID()
        })
        assert.equal(misplaced.status, 400)
        assert.match(await misplaced.text(), /Use JavaScript mode/)
      }
      assert.equal(runner.calls.length, 0)
      assert.equal(
        await sails.models.helmwritearm.count({
          user: current.users.genesisUser.id
        }),
        0
      )
      const inspection = await browser.post(`${base}/inspect-source`, {
        mode: 'command',
        code: SOURCE
      })
      assert.equal(inspection.status, 200)
      assert.equal(inspection.data.mode, 'command')
      assert.equal(inspection.data.classification.mutating, true)
      assert.equal(inspection.data.classification.complete, false)
      assert.equal(inspection.data.requiresWriteArm, true)
      assert.equal(inspection.data.sourceHash, commandHash(SOURCE))
      assert.equal(inspection.data.target.app.id, app.id)
      assert.equal(inspection.data.target.environment.id, environment.id)
      const js = await browser.post(`${base}/inspect-source`, { code: 'node' })
      const cmd = await browser.post(`${base}/inspect-source`, {
        mode: 'command',
        code: 'node'
      })
      assert.equal(js.data.mode, 'javascript')
      assert.notEqual(js.data.sourceHash, cmd.data.sourceHash)
      for (const writeArmToken of [undefined, 'invented-token']) {
        const blocked = await execute(browser, base, { writeArmToken })
        assert.equal(blocked.status, 409)
        assert.equal(blocked.data.code, 'HELM_WRITES_NOT_ARMED')
      }
      const grant = await arm(browser, base)
      assert.equal(grant.sourceHash, commandHash(SOURCE))
      const stored = await sails.models.helmwritearm.findOne({
        sourceHash: grant.sourceHash
      })
      assert.equal(stored.user, current.users.genesisUser.id)
      assert.notEqual(stored.tokenHash, grant.token)
      const changed = await execute(browser, base, {
        code: `${SOURCE} `,
        writeArmToken: grant.token
      })
      assert.equal(
        changed.status,
        409,
        'Whitespace is part of the exact source grant'
      )
      const wrongMode = await browser.post(
        base.replace(/\/helm$/, '/execute'),
        {
          code: 'await Creator.destroy({ id: 1 })',
          executionId: crypto.randomUUID(),
          writeArmToken: grant.token
        }
      )
      assert.equal(wrongMode.status, 409)
      const sharedText = "sails.quest.run('fixture-probe')"
      const jsGrant = await browser.post(`${base}/arm-writes`, {
        code: sharedText
      })
      assert.equal(jsGrant.status, 201)
      assert.equal(
        (
          await execute(browser, base, {
            code: sharedText,
            writeArmToken: jsGrant.data.token
          })
        ).status,
        409
      )
      const commandGrant = await arm(browser, base, sharedText)
      assert.equal(
        (
          await browser.post(base.replace(/\/helm$/, '/execute'), {
            code: sharedText,
            executionId: crypto.randomUUID(),
            writeArmToken: commandGrant.token
          })
        ).status,
        409
      )
      assert.equal(javascriptExecutions, 0)

      const successful = await events(
        await execute(browser, base, { writeArmToken: grant.token })
      )
      assert.equal(successful.at(-1).result.exitCode, 7)
      assert.equal(
        (await execute(browser, base, { writeArmToken: grant.token })).status,
        409
      )
      assert.equal(runner.calls.length, 1)
      const expired = await arm(browser, base)
      await sails.models.helmwritearm
        .update({
          tokenHash: crypto
            .createHash('sha256')
            .update(expired.token)
            .digest('hex')
        })
        .set({ expiresAt: Date.now() - 1 })
      assert.equal(
        (await execute(browser, base, { writeArmToken: expired.token })).status,
        409
      )
      const staleTarget = await arm(browser, base)
      await sails.models.app
        .updateOne({ id: app.id })
        .set({ containerName: 'sounding-new-deployment-fixture' })
      assert.equal(
        (await execute(browser, base, { writeArmToken: staleTarget.token }))
          .status,
        409
      )
      assert.equal(runner.calls.length, 1)
    } finally {
      sails.helpers.helm.executeInContainer = originalJavascript
      runner.restore()
    }
  }
)

test(
  'Helm command routes require a matching team administrator and reject invalid command syntax before spawn',
  {
    transport: 'http',
    world: worldFor('helm-command-authorization')
  },
  async (context) => {
    const { sails, world, request } = context
    const { browser, base, project, environment, current } = await open(context)
    const runner = stubRunner(sails)
    try {
      const member = await world
        .create('user')
        .with({ team: current.teams.genesisTeam.id, teamRole: 'member' })
      const memberBrowser = await authenticatedRequest(sails, request, member)
      for (const suffix of ['inspect-source', 'arm-writes', 'commands']) {
        const response = await memberBrowser.post(`${base}/${suffix}`, {
          mode: 'command',
          code: SOURCE,
          executionId: crypto.randomUUID()
        })
        assert.equal(response.status, 403)
      }
      const foreignOwner = await world
        .create('user')
        .with({ teamRole: 'owner' })
      const foreignTeam = await world
        .create('team')
        .with({ owner: foreignOwner.id })
      await sails.models.user
        .updateOne({ id: foreignOwner.id })
        .set({ team: foreignTeam.id })
      const outsider = await authenticatedRequest(sails, request, foreignOwner)
      assert.equal((await execute(outsider, base)).status, 403)
      const admin = await world
        .create('user')
        .with({ team: current.teams.genesisTeam.id, teamRole: 'admin' })
      const adminBrowser = await authenticatedRequest(sails, request, admin)
      const ownersGrant = await arm(browser, base)
      assert.equal(
        (
          await execute(adminBrowser, base, {
            writeArmToken: ownersGrant.token
          })
        ).status,
        409
      )
      const adminsGrant = await arm(adminBrowser, base)
      await events(
        await execute(adminBrowser, base, { writeArmToken: adminsGrant.token })
      )
      for (const code of [
        'node --version; echo unsafe',
        'node\necho unsafe',
        'npx arbitrary',
        'NODE_ENV=other node',
        'node "unfinished'
      ]) {
        assert.equal(
          (
            await browser.post(`${base}/inspect-source`, {
              mode: 'command',
              code
            })
          ).status,
          400
        )
        assert.equal(
          (await browser.post(`${base}/arm-writes`, { mode: 'command', code }))
            .status,
          400
        )
        assert.equal((await execute(browser, base, { code })).status, 400)
      }
      assert.equal(
        (
          await browser.streamPost(`${base}/inspect-source`, {
            mode: 'shell',
            code: SOURCE
          })
        ).status,
        400
      )
      assert.equal(
        (await execute(browser, base, { appSlug: 'does-not-exist' })).status,
        404
      )
      for (const invalid of [
        { executionId: 'not-a-uuid' },
        { executionId: undefined },
        { code: undefined }
      ]) {
        const rejected = await execute(browser, base, invalid)
        assert.equal(rejected.status, 400)
        assert.equal(rejected.data.message, 'Invalid request parameters.')
      }
      assert.equal(
        (
          await browser.streamPost(`${base}/arm-writes`, {
            mode: 'shell',
            code: SOURCE
          })
        ).status,
        400
      )
      assert.equal(
        (await browser.get(`${base}/history?mode=shell`)).status,
        400
      )

      assert.equal(runner.calls.length, 1)
    } finally {
      runner.restore()
    }
  }
)

test(
  'Helm command execution streams selected-app output and native status while persisting source-only history',
  {
    transport: 'http',
    world: worldFor('helm-command-stream-contract')
  },
  async (context) => {
    const { sails, world } = context
    const { browser, base, current, environment, app } = await open(context)
    const worker = await world.create('app').with({
      environment: environment.id,
      name: 'Fixture worker',
      slug: 'fixture-worker',
      isDefault: false,
      status: 'running',
      containerName: 'sounding-selected-worker-fixture'
    })
    const deployment = await world.create('deployment').with({
      app: worker.id,
      environment: environment.id,
      status: 'running',
      gitCommit: 'a'.repeat(40)
    })
    await sails.models.app
      .updateOne({ id: worker.id })
      .set({ currentDeployment: deployment.id })
    const runner = stubRunner(sails, async ({ onEvent }) => {
      onEvent({ type: 'started' })
      onEvent({ type: 'stdout', text: RESULT.stdout })
      onEvent({ type: 'stderr', text: RESULT.stderr })
      return RESULT
    })
    try {
      const wrongAppGrant = await arm(browser, base)
      assert.equal(
        (
          await execute(browser, base, {
            appSlug: worker.slug,
            writeArmToken: wrongAppGrant.token
          })
        ).status,
        409
      )
      const grant = await arm(browser, base, SOURCE, { appSlug: worker.slug })
      const id = crypto.randomUUID()
      const stream = await events(
        await execute(browser, base, {
          appSlug: worker.slug,
          writeArmToken: grant.token,
          executionId: id
        })
      )
      assert.deepEqual(
        stream.map((event) => event.type),
        ['accepted', 'started', 'stdout', 'stderr', 'result']
      )
      assert.equal(stream[0].executionId, id)
      assert.equal(stream[0].target.app.id, worker.id)
      assert.equal(stream[0].target.environment.id, environment.id)
      const { stdout, stderr, output, ...terminalMetadata } = RESULT
      assert.deepEqual(stream.at(-1), {
        type: 'result',
        executionId: id,
        result: terminalMetadata
      })
      const invocation = runner.calls[0]
      assert.equal(invocation.containerName, 'sounding-selected-worker-fixture')
      assert.deepEqual(invocation.argv, [
        'node',
        '-e',
        "process.stdout.write('fixture only')"
      ])
      assert.deepEqual(invocation.expectedRuntime, {
        appId: String(worker.id),
        deploymentId: String(deployment.id),
        required: true
      })
      assert.equal(invocation.signal.aborted, false)
      const saved = await sails.models.helmhistoryentry.findOne({
        user: current.users.genesisUser.id,
        app: worker.id
      })
      assert.equal(saved.source, SOURCE)
      assert.equal(saved.mode, 'command')
      assert.equal(saved.status, 'error')
      assert.equal(saved.durationMs, 12)
      const audit = await sails.models.auditlog.findOne({
        action: 'helm.executed',
        resourceId: String(worker.id)
      })
      assert.equal(audit.details.mode, 'command')
      assert.equal(audit.details.sourceHash, commandHash(SOURCE))
      assert.equal(audit.details.writeArmed, true)
      assert.equal(audit.details.outputBytes, RESULT.outputBytes)
      assert.ok(!JSON.stringify(audit).includes(SOURCE))
      for (const secret of [RESULT.stdout, RESULT.stderr]) {
        assert.ok(!JSON.stringify(saved).includes(secret))
        assert.ok(!JSON.stringify(audit).includes(secret))
      }
      assert.equal(
        (await browser.get(`${base}/history`)).data.entries.length,
        0
      )
      assert.equal(
        (await browser.get(`${base}/history?mode=command&appSlug=${app.slug}`))
          .data.entries.length,
        0
      )
      const history = await browser.get(
        `${base}/history?mode=command&appSlug=${worker.slug}`
      )
      assert.equal(history.data.entries[0].source, SOURCE)
      assert.equal(history.data.entries[0].mode, 'command')
      assert.ok(!JSON.stringify(history.data).includes(RESULT.stdout))
    } finally {
      runner.restore()
    }
  }
)

test(
  'Helm command history lists and clears only the selected mode, app, environment, and owner',
  {
    transport: 'http',
    world: worldFor('helm-command-history-scope')
  },
  async (context) => {
    const { sails, world } = context
    const { browser, base, project, environment, app, current } = await open(
      context
    )
    const otherApp = await world.create('app').with({
      environment: environment.id,
      slug: 'second-fixture',
      isDefault: false
    })
    const otherUser = await world
      .create('user')
      .with({ team: current.teams.genesisTeam.id })
    const staging = await world
      .create('environment')
      .with({ project: project.id })
    const common = {
      source: SOURCE,
      mode: 'command',
      status: 'unconfirmed',
      durationMs: 5,
      executedAt: Date.now(),
      target: app.slug,
      app: app.id,
      user: current.users.genesisUser.id,
      project: project.id,
      environment: environment.id,
      team: current.teams.genesisTeam.id
    }
    const entries = []
    for (const extra of [
      {},
      { pinned: true },
      { mode: 'javascript', source: 'return 1' },
      { app: otherApp.id },
      { user: otherUser.id },
      { environment: staging.id }
    ]) {
      entries.push(
        await sails.models.helmhistoryentry
          .create({ ...common, ...extra })
          .fetch()
      )
    }
    const history = await browser.get(`${base}/history?mode=command&q=fixture`)
    assert.deepEqual(
      new Set(history.data.entries.map((entry) => entry.id)),
      new Set([entries[0].id, entries[1].id])
    )
    assert.match(history.header('cache-control'), /no-store/)
    assert.equal(
      (await browser.get(`${base}/history`)).data.entries[0].id,
      entries[2].id
    )
    const cleared = await browser.delete(`${base}/history`, { mode: 'command' })
    assert.equal(cleared.data.deletedCount, 1)
    assert.equal(
      await sails.models.helmhistoryentry.count({ id: entries[0].id }),
      0
    )
    for (const entry of entries.slice(1))
      assert.equal(
        await sails.models.helmhistoryentry.count({ id: entry.id }),
        1
      )
  }
)

test(
  'Helm command nonproduction still uses administrator scope and records unknown transport outcomes honestly',
  {
    transport: 'http',
    world: worldFor('helm-command-unknown-outcome')
  },
  async (context) => {
    const { sails } = context
    const { browser, base, environment, app } = await open(context)
    await sails.models.environment
      .updateOne({ id: environment.id })
      .set({ isProduction: false })
    const runner = stubRunner(sails, async () => {
      throw new Error('synthetic transport loss')
    })
    try {
      const inspection = await browser.post(`${base}/inspect-source`, {
        mode: 'command',
        code: SOURCE
      })
      assert.equal(inspection.data.requiresWriteArm, false)
      const stream = await events(await execute(browser, base))
      assert.equal(stream.at(-1).result.status, 'unconfirmed')
      assert.equal(stream.at(-1).result.exitCode, null)
      assert.equal(stream.at(-1).result.success, false)
      assert.equal(
        stream.some((event) => event.type === 'started'),
        false
      )
      assert.equal(
        (await sails.models.helmhistoryentry.findOne({ app: app.id })).status,
        'unconfirmed'
      )
      assert.equal(runner.calls.length, 1)
    } finally {
      runner.restore()
    }
  }
)

test(
  'Helm command HTTP streams before completion and cancellation waits for owner-scoped terminal evidence',
  {
    transport: 'http',
    world: worldFor('helm-command-cancellation-contract')
  },
  async (context) => {
    const { sails, world, request } = context
    const { browser, base, environment, current } = await open(context)
    await sails.models.environment
      .updateOne({ id: environment.id })
      .set({ isProduction: false })
    const other = await world
      .create('user')
      .with({ team: current.teams.genesisTeam.id, teamRole: 'admin' })
    const otherBrowser = await authenticatedRequest(sails, request, other)
    const { readHelmCommandStream } = await import(
      '../../../assets/js/lib/helmCommandStream.mjs'
    )
    let finish
    let signal
    let reportAbort
    const runner = stubRunner(sails, async (input) => {
      signal = input.signal
      signal.addEventListener('abort', () => reportAbort(), { once: true })
      input.onEvent({ type: 'started' })
      input.onEvent({ type: 'stdout', text: 'live fixture stdout\n' })
      input.onEvent({ type: 'stderr', text: 'live fixture stderr\n' })
      return new Promise((resolve) => {
        finish = resolve
      })
    })
    try {
      for (const status of ['cancelled', 'unconfirmed']) {
        const id = crypto.randomUUID()
        const aborted = new Promise((resolve) => {
          reportAbort = resolve
        })
        const stream = await browser.openStream(`${base}/commands`, {
          code: SOURCE,
          executionId: id
        })
        let reportOutput
        const gotOutput = new Promise((resolve) => {
          reportOutput = resolve
        })
        const live = []
        let completed = false
        const terminal = readHelmCommandStream(stream, {
          executionId: id,
          onEvent(event) {
            live.push(event)
            if (event.type === 'stderr') reportOutput()
          }
        }).then((result) => {
          completed = true
          return result
        })
        await gotOutput
        assert.deepEqual(
          live.map((event) => event.type),
          ['accepted', 'started', 'stdout', 'stderr']
        )
        assert.equal(completed, false)
        const wrongOwner = await otherBrowser.post(
          `/api/v1/helm/executions/${id}/cancel`,
          {}
        )
        assert.equal(wrongOwner.data.cancelled, false)
        assert.equal(signal.aborted, false)
        let stopResolved = false
        const stopping = browser
          .post(`/api/v1/helm/executions/${id}/cancel`, {})
          .then((response) => {
            stopResolved = true
            return response
          })
        await aborted
        assert.equal(stopResolved, false)
        assert.equal(completed, false)
        finish({
          ...RESULT,
          status,
          exitCode: null,
          signal: status === 'cancelled' ? 'SIGTERM' : null,
          terminationConfirmed: status === 'cancelled'
        })
        const [stop, result] = await Promise.all([stopping, terminal])
        assert.equal(stop.data.cancelled, status === 'cancelled')
        assert.equal(result.status, status)
        assert.equal(result.exitCode, null)
        assert.equal(
          (await browser.post(`/api/v1/helm/executions/${id}/cancel`, {})).data
            .cancelled,
          false
        )
      }
      assert.equal(runner.calls.length, 2)
    } finally {
      finish?.({
        ...RESULT,
        status: 'unconfirmed',
        terminationConfirmed: false
      })
      runner.restore()
    }
  }
)
