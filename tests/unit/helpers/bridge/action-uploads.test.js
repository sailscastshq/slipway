const { test } = require('sounding')
const assert = require('node:assert/strict')

const models = {
  submission: {
    identity: 'submission',
    primaryKey: 'id',
    attributes: { id: { type: 'number' }, title: { type: 'string' } }
  }
}
const upload = {
  storage: 'bridge',
  kind: 'file',
  accept: ['application/pdf'],
  maxBytes: 10485760
}
const action = {
  name: 'uploadMaterials',
  scope: 'record',
  helper: 'bridge.uploadMaterials',
  fields: {
    material: {
      type: 'string',
      label: 'Material',
      required: true,
      field: { type: 'file', upload }
    }
  }
}

test('Bridge action uploads reuse normalized upload limits and reject unsafe configurations', async ({
  sails
}) => {
  const normalize = (fields, scope = 'record') =>
    sails.helpers.bridge.normalizeResourceContract.with({
      models,
      config: {
        resources: {
          submission: {
            actions: {
              uploadMaterials: {
                scope,
                helper: 'bridge.uploadMaterials',
                fields
              }
            }
          }
        }
      }
    })
  for (const type of ['file', 'image', 'upload']) {
    const c = await normalize({ material: { type, upload } })
    assert.deepEqual(
      c.resources.submission.actionDefinitions.uploadMaterials.fields.material
        .field.upload.accept,
      ['application/pdf']
    )
    assert.equal(
      c.resources.submission.actionDefinitions.uploadMaterials.fields.material
        .field.upload.maxBytes,
      upload.maxBytes
    )
  }
  await assert.rejects(
    normalize({ material: { type: 'text', upload } }),
    /upload requires/
  )
  await assert.rejects(
    normalize({
      material: { type: 'file', upload: { directory: '../private' } }
    }),
    /safe relative/
  )
  await assert.rejects(
    normalize({ material: { type: 'file', upload } }, 'bulk'),
    /record or resource scope/
  )
})

test('Bridge upload admission and resume authorize the selected action and bind its canonical record', async ({
  sails
}) => {
  const originals = { ...sails.helpers.bridge }
  const originalSecret = sails.config.session.secret
  sails.config.session.secret = 'synthetic-action-upload-signing-secret-only'
  const h = (fn) => ({ with: fn })
  const resource = {
    identity: 'submission',
    primaryKey: 'id',
    attributes: {},
    actions: { update: false, view: true }
  }
  let denied = false,
    hidden = false
  const resolved = {
    project: { id: 2, team: 1 },
    environment: { id: 3 },
    app: { id: 4, containerName: 'fixture' },
    actorId: 5,
    actor: { id: 5 }
  }
  sails.helpers.bridge.resolveRequest = h(async (args) => {
    assert.equal(args.requiredRole, 'editor')
    assert.equal(args.requireRunning, true)
    return resolved
  })
  sails.helpers.bridge.loadResource = h(async (args) => {
    if (denied) throw Object.assign(new Error('Denied'), { code: 'forbidden' })
    return {
      resource,
      recordId: Number(args.recordId),
      actionDefinition: { ...action, name: args.action }
    }
  })
  sails.helpers.bridge.loadActionContext = h(async (args) => ({
    action: hidden ? { ...args.action, fields: {} } : args.action
  }))
  sails.helpers.bridge.getUploadStorageConfig = h(async () => ({
    publicUrl: 'https://assets.example.test'
  }))
  sails.helpers.bridge.authorizeRelationshipValues = h(async () => {})
  sails.helpers.bridge.resolveUploadObjectPath = h(async (args) => {
    assert.deepEqual(args.values, {})
    assert.equal(args.recordId, 1)
    return { directory: 'materials' }
  })
  const args = {
    req: {},
    projectSlug: 'fixture',
    modelIdentity: 'submission',
    fieldName: 'material',
    recordId: '1',
    actionName: 'uploadMaterials',
    values: { id: 99, title: 'forged' }
  }
  const context = {
    actorId: 5,
    projectId: 2,
    environmentId: 3,
    appId: 4,
    resource: 'submission.uploadMaterials',
    field: 'material'
  }
  try {
    const target = await originals.prepareUploadTarget.with(args)
    assert.equal(target.uploadResource, 'submission.uploadMaterials')
    assert.equal(target.loaded.recordId, 1)
    const intent = await originals.createDirectUploadIntent.with({
      context,
      upload: {
        strategy: 'single',
        url: 'https://assets.example.test/material.pdf',
        objectPath: 'material.pdf',
        fileSize: 1024,
        fileType: 'application/pdf',
        recordId: '1'
      }
    })
    const session = await originals.resolveDirectUploadSession.with({
      ...args,
      uploadIntent: intent
    })
    assert.equal(session.payload.fileType, 'application/pdf')
    await assert.rejects(
      originals.resolveDirectUploadSession.with({
        ...args,
        recordId: '2',
        uploadIntent: intent
      }),
      /different record/
    )
    await assert.rejects(
      originals.resolveDirectUploadSession.with({
        ...args,
        actionName: 'otherAction',
        uploadIntent: intent
      }),
      /invalid or expired/
    )
    hidden = true
    await assert.rejects(
      originals.prepareUploadTarget.with(args),
      /not available/
    )
    await assert.rejects(
      originals.resolveDirectUploadSession.with({
        ...args,
        uploadIntent: intent
      }),
      /not available/
    )
    hidden = false
    denied = true
    await assert.rejects(originals.prepareUploadTarget.with(args), /Denied/)
    await assert.rejects(
      originals.resolveDirectUploadSession.with({
        ...args,
        uploadIntent: intent
      }),
      /Denied/
    )
  } finally {
    Object.assign(sails.helpers.bridge, originals)
    sails.config.session.secret = originalSecret
  }
})

test('Bridge action values require an actor, action, field and record-bound upload receipt', async ({
  sails
}) => {
  const secret = sails.config.session.secret
  sails.config.session.secret = 'synthetic-action-upload-signing-secret-only'
  const context = {
    actorId: 5,
    appId: 4,
    projectId: 2,
    environmentId: 3,
    resource: 'submission.uploadMaterials',
    field: 'material',
    recordId: 1
  }
  const url = 'https://assets.example.test/material.pdf'
  try {
    const receipt = await sails.helpers.bridge.createUploadReceipt.with({
      url,
      context
    })
    const allow = (changes = {}, chosenAction = action) =>
      sails.helpers.bridge.allowActionValues.with({
        values: { material: { url, receipt } },
        resource: { identity: 'submission' },
        action: chosenAction,
        uploadContext: {
          actorId: 5,
          appId: 4,
          projectId: 2,
          environmentId: 3,
          recordId: 1,
          ...changes
        }
      })
    assert.deepEqual(await allow(), { material: url })
    await assert.rejects(allow({ appId: 9 }), /Some Bridge fields are invalid/)
    await assert.rejects(
      sails.helpers.bridge.verifyUploadReceipt.with({
        receipt,
        url,
        context: { ...context, field: 'otherField' }
      }),
      /Upload this file/
    )
    await assert.rejects(
      allow({ recordId: 2 }),
      /Some Bridge fields are invalid/
    )
    await assert.rejects(
      allow({ actorId: 6 }),
      /Some Bridge fields are invalid/
    )
    await assert.rejects(
      allow({}, { ...action, name: 'otherAction' }),
      /Some Bridge fields are invalid/
    )
    await assert.rejects(
      sails.helpers.bridge.verifyUploadReceipt.with({
        receipt,
        url: url + '?changed',
        context
      }),
      /Upload this file/
    )
  } finally {
    sails.config.session.secret = secret
  }
})

test('Bridge selects the app-scoped Sailsconf recording bucket without a public-bucket fallback', async ({
  sails
}) => {
  const get = sails.helpers.setting.get
  sails.helpers.setting.get = async () =>
    JSON.stringify({
      R2_ACCESS_KEY: 'global-fixture-key',
      R2_SECRET_KEY: 'global-fixture-secret',
      R2_BUCKET: 'unrelated-global-fixture',
      R2_ENDPOINT: 'https://global.example.test',
      R2_PUBLIC_URL: 'https://global-locator.example.test'
    })
  const settings = {
    R2_ACCESS_KEY: 'app-fixture-key',
    R2_SECRET_KEY: 'app-fixture-secret',
    R2_BUCKET: 'sailsconf-private-fixture',
    R2_ENDPOINT: 'https://account.example.test',
    R2_PUBLIC_URL: 'https://private-locator.example.test'
  }
  try {
    const result = await sails.helpers.bridge.getUploadStorageConfig.with({
      app: { secureEnvVars: settings },
      environment: {}
    })
    assert.equal(result.bucket, settings.R2_BUCKET)
    assert.equal(result.publicUrl, settings.R2_PUBLIC_URL)
    assert.equal(result.key, settings.R2_ACCESS_KEY)
  } finally {
    sails.helpers.setting.get = get
  }
})
