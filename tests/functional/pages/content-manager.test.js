const fs = require('fs')
const os = require('os')
const path = require('path')

const { test } = require('sounding')
const { withCsrfFromPage } = require('../../support/csrf-request')

function contentWorld(slug) {
  return {
    name: 'configured-slipway',
    context: {
      deploymentTarget: { slug }
    }
  }
}

test(
  'Content Manager saves pushed-source content without creating a deployment',
  { world: contentWorld('content-save-only') },
  async ({ sails, world, request, expect }) => {
    const workspace = await prepareContentWorkspace({ sails, world })

    try {
      const editor = await withCsrfFromPage(
        request,
        workspace.editorPath,
        'genesisUser'
      )
      const sourceSha = editor.page.data.props.content.sourceSha
      const response = await editor.request.post(workspace.updatePath, {
        raw: '# Updated locally\n',
        deploy: false,
        appSlug: workspace.app.slug,
        sourceSha
      })

      expect(response).toHaveStatus(302)
      expect(response).toRedirectTo(
        `${workspace.editorPath}?appSlug=${workspace.app.slug}`
      )
      expect(fs.readFileSync(workspace.filePath, 'utf8')).toBe(
        '# Updated locally\n'
      )
      const deployments = await sails.models.deployment.find({
        environment: workspace.environment.id
      })
      expect(deployments).toEqual([])
    } finally {
      workspace.restore()
    }
  }
)

test(
  'Content Manager persists Markdown serialized by the visual editor',
  { world: contentWorld('content-visual-save') },
  async ({ sails, world, request, expect }) => {
    const workspace = await prepareContentWorkspace({ sails, world })

    try {
      const editor = await withCsrfFromPage(
        request,
        workspace.editorPath,
        'genesisUser'
      )
      const response = await editor.request.post(workspace.updatePath, {
        frontmatter: {
          title: 'A calmer release',
          description: 'Written visually'
        },
        body: '# A calmer release\n\nThis was **formatted** without changing the storage format.\n',
        deploy: false,
        appSlug: workspace.app.slug,
        sourceSha: editor.page.data.props.content.sourceSha
      })

      expect(response).toHaveStatus(302)
      expect(fs.readFileSync(workspace.filePath, 'utf8')).toBe(
        '---\ntitle: A calmer release\ndescription: Written visually\n---\n\n# A calmer release\n\nThis was **formatted** without changing the storage format.\n'
      )
    } finally {
      workspace.restore()
    }
  }
)

test(
  'Content Manager commits and queues one targeted deployment',
  { world: contentWorld('content-save-deploy') },
  async ({ sails, world, request, expect }) => {
    const workspace = await prepareContentWorkspace({ sails, world })
    const originalExecutePipeline = sails.helpers.deploy.executePipeline
    const pipelineCalls = []
    sails.helpers.deploy.executePipeline = {
      with: async (values) => {
        pipelineCalls.push(values)
        await sails.models.deployment
          .updateOne({ id: values.deploymentId })
          .set({
            status: 'running',
            finishedAt: Date.now()
          })
      }
    }
    const provider = await world.create('gitprovider').with({
      team: world.current.teams.genesisTeam.id
    })
    await world.create('gitrepository').with({
      provider: provider.id,
      environment: workspace.environment.id,
      app: workspace.app.id
    })
    await world.create('app').with({
      name: 'Worker',
      slug: 'worker',
      environment: workspace.environment.id,
      isDefault: false,
      routePath: null
    })
    expect(
      await sails.models.gitrepository.count({ app: workspace.app.id })
    ).toBe(1)
    const originalFetch = global.fetch
    const commitCalls = []

    try {
      global.fetch = async (url, options = {}) => {
        if (!options.method || options.method === 'GET') {
          return githubContentResponse(workspace.originalContent)
        }
        commitCalls.push({ url, options })
        return githubCommitResponse({
          contentSha: 'content-blob-sha',
          commitSha: 'content-commit-sha'
        })
      }
      const editor = await withCsrfFromPage(
        request,
        `${workspace.editorPath}?appSlug=${workspace.app.slug}`,
        'genesisUser'
      )
      expect(editor.page).toHaveInertiaProp('app.slug', workspace.app.slug)
      const response = await editor.request.post(workspace.updatePath, {
        raw: '# Published from Slipway\n',
        deploy: true,
        appSlug: workspace.app.slug,
        sourceSha: editor.page.data.props.content.sourceSha
      })

      expect(response).toHaveStatus(302)
      const deployment = await waitFor(async () => {
        const records = await sails.models.deployment.find({
          environment: workspace.environment.id
        })
        return records[0]
      })
      await waitFor(() => pipelineCalls.length === 1)
      expect(response).toRedirectTo(
        `/projects/${workspace.project.slug}/deployments/${deployment.id}`
      )
      expect(commitCalls.length).toBe(1)
      const commitBody = JSON.parse(commitCalls[0].options.body)
      expect(commitBody.message).toBe(
        'chore(content): update posts/welcome\n\nSlipway-Content-Change: true'
      )
      expect(pipelineCalls.length).toBe(1)
      expect(deployment.app).toBe(workspace.app.id)
      expect(deployment.triggerType).toBe('content')
      expect(deployment.gitCommit).toBe('content-commit-sha')
      expect(deployment.gitBranch).toBe('main')
      expect(deployment.gitMessage).toBe('chore(content): update posts/welcome')
      await waitForDeploymentJob(sails, deployment.id)
    } finally {
      global.fetch = originalFetch
      sails.helpers.deploy.executePipeline = originalExecutePipeline
      workspace.restore()
    }
  }
)

test(
  'Content Manager does not overwrite a newer Git revision',
  { world: contentWorld('content-git-conflict') },
  async ({ sails, world, request, expect }) => {
    const workspace = await prepareContentWorkspace({ sails, world })
    const provider = await world.create('gitprovider').with({
      team: world.current.teams.genesisTeam.id
    })
    await world.create('gitrepository').with({
      provider: provider.id,
      environment: workspace.environment.id,
      app: workspace.app.id
    })
    const originalFetch = global.fetch

    try {
      global.fetch = async (_url, options = {}) => {
        if (!options.method || options.method === 'GET') {
          return githubContentResponse(workspace.originalContent)
        }
        return { ok: false, status: 409 }
      }
      const editor = await withCsrfFromPage(
        request,
        `${workspace.editorPath}?appSlug=${workspace.app.slug}`,
        'genesisUser'
      )
      const response = await editor.request.post(workspace.updatePath, {
        raw: '# Stale browser edit\n',
        deploy: false,
        appSlug: workspace.app.slug,
        sourceSha: editor.page.data.props.content.sourceSha
      })

      expect(response).toHaveStatus(303)
      expect(fs.readFileSync(workspace.filePath, 'utf8')).toBe(
        workspace.originalContent
      )
      const page = await editor.request.get(
        `${workspace.editorPath}?appSlug=${workspace.app.slug}`
      )
      expect(page).toHaveInertiaError(
        'content',
        'This file changed in Git while you were editing it. Reload the latest version before saving'
      )
      const deployments = await sails.models.deployment.find({
        environment: workspace.environment.id
      })
      expect(deployments).toEqual([])
    } finally {
      global.fetch = originalFetch
      workspace.restore()
    }
  }
)

test(
  'Content Manager creates Git-backed content with a conventional commit',
  { world: contentWorld('content-git-create') },
  async ({ sails, world, request, expect }) => {
    const workspace = await prepareContentWorkspace({ sails, world })
    const provider = await world.create('gitprovider').with({
      team: world.current.teams.genesisTeam.id
    })
    await world.create('gitrepository').with({
      provider: provider.id,
      environment: workspace.environment.id,
      app: workspace.app.id
    })
    const originalFetch = global.fetch
    const commitCalls = []

    try {
      const managerPath = `/projects/${workspace.project.slug}/content`
      const manager = await withCsrfFromPage(
        request,
        managerPath,
        'genesisUser'
      )
      global.fetch = async (url, options) => {
        commitCalls.push({ url, options })
        return {
          ok: true,
          status: 201,
          json: async () => ({
            content: { sha: 'created-blob-sha' },
            commit: { sha: 'created-commit-sha' }
          })
        }
      }
      const response = await manager.request.post(
        `${managerPath}/posts/create`,
        {
          contentSlug: 'release-notes',
          title: 'Release notes',
          appSlug: workspace.app.slug
        }
      )

      expect(response).toHaveStatus(302)
      expect(response).toRedirectTo(
        `${managerPath}/posts/release-notes?appSlug=${workspace.app.slug}`
      )
      expect(commitCalls.length).toBe(1)
      expect(commitCalls[0].options.method).toBe('PUT')
      const body = JSON.parse(commitCalls[0].options.body)
      expect(body.sha).toBe(undefined)
      expect(body.message).toBe(
        'chore(content): create posts/release-notes\n\nSlipway-Content-Change: true'
      )
      expect(
        fs.existsSync(
          path.join(path.dirname(workspace.filePath), 'release-notes.md')
        )
      ).toBe(true)
    } finally {
      global.fetch = originalFetch
      workspace.restore()
    }
  }
)

test(
  'Content Manager validates create and editor values without writing source',
  { world: contentWorld('content-precognition') },
  async ({ sails, world, request, expect }) => {
    const workspace = await prepareContentWorkspace({ sails, world })

    try {
      const managerPath = `/projects/${workspace.project.slug}/content`
      const manager = await withCsrfFromPage(
        request,
        managerPath,
        'genesisUser'
      )
      const createRequest = manager.request.withHeaders({
        Precognition: 'true',
        'Precognition-Validate-Only': 'contentSlug'
      })

      const invalidSlug = await createRequest.post(
        `${managerPath}/posts/create`,
        {
          contentSlug: 'Release Notes',
          title: 'Release notes',
          appSlug: workspace.app.slug
        }
      )
      expect(invalidSlug).toHaveStatus(422)
      expect(invalidSlug.data.errors.contentSlug[0]).toContain(
        'Use lowercase letters'
      )

      const duplicateSlug = await createRequest.post(
        `${managerPath}/posts/create`,
        {
          contentSlug: 'welcome',
          title: 'Another welcome',
          appSlug: workspace.app.slug
        }
      )
      expect(duplicateSlug).toHaveStatus(422)
      expect(duplicateSlug.data.errors.contentSlug[0]).toContain(
        'This content slug is already in use'
      )

      const availableSlug = await createRequest.post(
        `${managerPath}/posts/create`,
        {
          contentSlug: 'release-notes',
          title: 'Release notes',
          appSlug: workspace.app.slug
        }
      )
      expect(availableSlug).toHaveStatus(204)
      expect(availableSlug).toHaveHeader('precognition-success', 'true')

      const editor = await withCsrfFromPage(
        request,
        workspace.editorPath,
        'genesisUser'
      )
      const editorRequest = editor.request.withHeaders({
        Precognition: 'true',
        'Precognition-Validate-Only': 'frontmatter.bad/key'
      })
      const invalidMetadata = await editorRequest.post(workspace.updatePath, {
        frontmatter: { 'bad/key': 'unsafe' },
        body: 'This request must not be written.',
        appSlug: workspace.app.slug
      })
      expect(invalidMetadata).toHaveStatus(422)
      expect(invalidMetadata.data.errors['frontmatter.bad/key'][0]).toContain(
        'valid metadata field name'
      )

      const validEditor = await editorRequest.post(workspace.updatePath, {
        frontmatter: { title: 'Welcome' },
        body: 'This valid preflight must not be written either.',
        appSlug: workspace.app.slug
      })
      expect(validEditor).toHaveStatus(204)
      expect(validEditor).toHaveHeader('precognition-success', 'true')
      expect(
        fs.existsSync(
          path.join(path.dirname(workspace.filePath), 'release-notes.md')
        )
      ).toBe(false)
      expect(fs.readFileSync(workspace.filePath, 'utf8')).toBe(
        workspace.originalContent
      )
    } finally {
      workspace.restore()
    }
  }
)

test(
  'Content Manager deletes Git-backed content with a conventional commit',
  { world: contentWorld('content-git-delete') },
  async ({ sails, world, request, expect }) => {
    const workspace = await prepareContentWorkspace({ sails, world })
    const provider = await world.create('gitprovider').with({
      team: world.current.teams.genesisTeam.id
    })
    await world.create('gitrepository').with({
      provider: provider.id,
      environment: workspace.environment.id,
      app: workspace.app.id
    })
    const originalFetch = global.fetch
    const commitCalls = []

    try {
      global.fetch = async (url, options = {}) => {
        if (!options.method || options.method === 'GET') {
          return githubContentResponse(workspace.originalContent)
        }
        commitCalls.push({ url, options })
        return githubCommitResponse({ commitSha: 'deleted-commit-sha' })
      }
      const editor = await withCsrfFromPage(
        request,
        `${workspace.editorPath}?appSlug=${workspace.app.slug}`,
        'genesisUser'
      )
      const sourceSha = editor.page.data.props.content.sourceSha
      const response = await editor.request.post(
        `${workspace.editorPath}/delete`,
        {
          appSlug: workspace.app.slug,
          sourceSha
        }
      )

      expect(response).toHaveStatus(302)
      expect(response).toRedirectTo(
        `/projects/${workspace.project.slug}/content?appSlug=${workspace.app.slug}`
      )
      expect(commitCalls.length).toBe(1)
      expect(commitCalls[0].options.method).toBe('DELETE')
      const body = JSON.parse(commitCalls[0].options.body)
      expect(body.sha).toBe(sourceSha)
      expect(body.message).toBe(
        'chore(content): delete posts/welcome\n\nSlipway-Content-Change: true'
      )
      expect(fs.existsSync(workspace.filePath)).toBe(false)
    } finally {
      global.fetch = originalFetch
      workspace.restore()
    }
  }
)

test(
  'Content Manager keeps the draft and shows a missing-source error',
  { world: contentWorld('content-missing-source') },
  async ({ sails, world, request, expect }) => {
    const workspace = await prepareContentWorkspace({ sails, world })
    const originalGetSourceReadiness = sails.helpers.deploy.getSourceReadiness
    sails.helpers.deploy.getSourceReadiness = {
      with: async () => ({
        available: false,
        mode: 'none',
        message: 'No deployable source is available.'
      })
    }

    try {
      const editor = await withCsrfFromPage(
        request,
        workspace.editorPath,
        'genesisUser'
      )
      const response = await editor.request.post(workspace.updatePath, {
        raw: '# Must not be written\n',
        deploy: true,
        appSlug: workspace.app.slug,
        sourceSha: editor.page.data.props.content.sourceSha
      })

      expect(response).toHaveStatus(303)
      expect(fs.readFileSync(workspace.filePath, 'utf8')).toBe(
        workspace.originalContent
      )
      const page = await editor.request.get(workspace.editorPath)
      expect(page).toHaveInertiaError(
        'deploy',
        'No deployable source is available'
      )
      const deployments = await sails.models.deployment.find({
        environment: workspace.environment.id
      })
      expect(deployments).toEqual([])
    } finally {
      sails.helpers.deploy.getSourceReadiness = originalGetSourceReadiness
      workspace.restore()
    }
  }
)

test(
  'Content Manager inherits its app scope in a multi-app environment',
  { world: contentWorld('content-multi-app') },
  async ({ sails, world, request, expect }) => {
    const workspace = await prepareContentWorkspace({ sails, world })
    const worker = await world.create('app').with({
      name: 'Worker',
      slug: 'worker',
      environment: workspace.environment.id,
      isDefault: false,
      routePath: null
    })

    try {
      const editor = await withCsrfFromPage(
        request,
        `${workspace.editorPath}?appSlug=${worker.slug}`,
        'genesisUser'
      )
      expect(editor.page).toHaveInertiaProp('app.slug', worker.slug)
      const response = await editor.request.post(workspace.updatePath, {
        raw: '# Worker-owned content\n',
        deploy: false,
        appSlug: worker.slug,
        sourceSha: editor.page.data.props.content.sourceSha
      })

      expect(response).toHaveStatus(302)
      expect(response).toRedirectTo(
        `${workspace.editorPath}?appSlug=${worker.slug}`
      )
      expect(fs.readFileSync(workspace.filePath, 'utf8')).toBe(
        '# Worker-owned content\n'
      )
    } finally {
      workspace.restore()
    }
  }
)

async function prepareContentWorkspace({ sails, world }) {
  const current = world.current
  const project = current.projects.deploymentTarget
  const environment = current.environments.production
  const app = current.apps.web
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'slipway-content-manager-')
  )
  const projectRoot = path.join(tempRoot, project.slug)
  const collectionRoot = path.join(projectRoot, 'content', 'posts')
  const filePath = path.join(collectionRoot, 'welcome.md')
  const originalContent = '---\ntitle: Welcome\n---\n\nHello.\n'
  fs.mkdirSync(collectionRoot, { recursive: true })
  fs.writeFileSync(path.join(projectRoot, 'Dockerfile'), 'FROM node:22\n')
  fs.writeFileSync(filePath, originalContent)

  await sails.models.environment.updateOne({ id: environment.id }).set({
    features: {
      'sails-content': {
        version: '1.0.0',
        contentDir: 'content'
      }
    }
  })
  environment.features = {
    'sails-content': {
      version: '1.0.0',
      contentDir: 'content'
    }
  }

  const originalAppsDir = sails.config.custom.slipwayAppsDir
  sails.config.custom.slipwayAppsDir = tempRoot
  const editorPath = `/projects/${project.slug}/content/posts/welcome`

  return {
    app,
    editorPath,
    environment,
    filePath,
    originalContent,
    project,
    updatePath: `${editorPath}/update`,
    restore() {
      sails.config.custom.slipwayAppsDir = originalAppsDir
      fs.rmSync(tempRoot, { recursive: true, force: true })
    }
  }
}

async function waitFor(predicate, timeout = 2000) {
  const deadline = Date.now() + timeout
  let result
  while (!(result = await predicate())) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for state.')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  return result
}

async function waitForDeploymentJob(sails, deploymentId) {
  await waitFor(async () => {
    const [job, leases] = await Promise.all([
      sails.models.deploymentjob.findOne({ deployment: deploymentId }),
      sails.models.deploymentlease.count({ deployment: deploymentId })
    ])
    return job?.stage === 'complete' && leases === 0
  })
}

function githubContentResponse(content, sha = 'source-blob-sha') {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      type: 'file',
      sha,
      content: Buffer.from(content, 'utf8').toString('base64')
    })
  }
}

function githubCommitResponse({ contentSha = null, commitSha }) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      content: contentSha ? { sha: contentSha } : null,
      commit: { sha: commitSha }
    })
  }
}
