const { test } = require('sounding')
const assert = require('node:assert/strict')
const prepare = require('../../../../api/controllers/project/bridge-prepare-upload-field')
const resume = require('../../../../api/controllers/project/bridge-resume-upload-field')
const complete = require('../../../../api/controllers/project/bridge-complete-upload-field')
const proxy = require('../../../../api/controllers/project/bridge-upload-field')

const MIB = 1024 * 1024
const context = {
  actorId: 5,
  appId: 4,
  projectId: 2,
  environmentId: 3,
  resource: 'proposal.uploadMaterials',
  field: 'material',
  recordId: 'proposal-1'
}
const inputs = {
  slug: 'fixture',
  envSlug: 'production',
  modelIdentity: 'proposal',
  actionName: 'uploadMaterials',
  fieldName: 'material',
  recordId: 'proposal-1',
  values: { id: 'forged-proposal', assetId: 'forged-asset' },
  fileName: 'forged-key.mp4',
  fileType: 'video/mp4',
  fileSize: 4 * MIB
}

test('Bridge normalizes immutable upload fields and rejects nonboolean opt-ins', async ({
  sails
}) => {
  const normalize = (immutable) =>
    sails.helpers.bridge.normalizeResourceContract.with({
      models: {
        proposal: {
          identity: 'proposal',
          primaryKey: 'id',
          attributes: { id: { type: 'string' } }
        }
      },
      config: {
        resources: {
          proposal: {
            actions: {
              uploadMaterials: {
                scope: 'record',
                helper: 'bridge.uploadMaterials',
                fields: { material: { type: 'file', upload: { immutable } } }
              }
            }
          }
        }
      }
    })
  const c = await normalize(true)
  assert.equal(
    c.resources.proposal.actionDefinitions.uploadMaterials.fields.material.field
      .upload.immutable,
    true
  )
  for (const invalid of ['true', 1, {}, null]) {
    await assert.rejects(normalize(invalid), /immutable must be a boolean/)
  }
  assert.equal(
    (await normalize(false)).resources.proposal.actionDefinitions
      .uploadMaterials.fields.material.field.upload.immutable,
    undefined
  )
})

test('Immutable small and large uploads use unique final keys, resume missing parts, and close before target-bound receipts', async ({
  sails
}) => {
  await fixture(sails, async (f) => {
    const paths = new Set()
    for (const size of [1, 4 * MIB, 16 * MIB, 33 * MIB]) {
      const prepared = await prepare.fn.call(
        { req: {} },
        { ...inputs, fileSize: size }
      )
      const payload = await sails.helpers.bridge.verifyDirectUploadIntent.with({
        intent: prepared.uploadIntent,
        context
      })
      assert.equal(prepared.strategy, 'multipart')
      assert.equal(prepared.partCount, Math.ceil(size / (16 * MIB)))
      assert.match(
        payload.objectPath,
        /^talks\/proposal-1\/[a-f0-9-]{36}\.mp4$/
      )
      assert(!paths.has(payload.objectPath))
      paths.add(payload.objectPath)
      const session = f.sessions.get(payload.uploadId)
      assert.equal(session.immutable, true)
      session.parts = [
        { partNumber: 1, size: Math.min(size, 16 * MIB), etag: 'part-1' }
      ]
      const args = { ...inputs, uploadIntent: prepared.uploadIntent }
      const resumed = await resume.fn.call({ req: {} }, args)
      assert.deepEqual(
        resumed.uploadedParts.map((p) => p.partNumber),
        [1]
      )
      assert.deepEqual(
        resumed.parts.map((p) => p.partNumber),
        Array.from({ length: prepared.partCount - 1 }, (_, i) => i + 2)
      )
      session.parts = Array.from({ length: prepared.partCount }, (_, i) => ({
        partNumber: i + 1,
        size: Math.min(16 * MIB, size - i * 16 * MIB),
        etag: `part-${i + 1}`
      }))
      const start = f.operations.length
      const result = await complete.fn.call({ req: {} }, args)
      assert.deepEqual(f.operations.slice(start), [
        'listParts',
        'completeMultipart',
        'head'
      ])
      assert.equal(session.closed, true)
      await assert.rejects(
        sails.helpers.bridge.directUploadStorage.with({
          operation: 'signParts',
          uploadId: payload.uploadId,
          partNumbers: [1]
        }),
        (error) => error.code === 'BRIDGE_MULTIPART_UPLOAD_MISSING'
      )
      const proof = JSON.parse(
        Buffer.from(result.receipt.split('.')[0], 'base64url')
      )
      assert.equal(proof.completedMultipart, true)
      assert.equal(proof.recordId, inputs.recordId)
      const allowed = await sails.helpers.bridge.allowActionValues.with({
        values: { material: result },
        resource: f.resource,
        action: f.action,
        uploadContext: context
      })
      assert.equal(allowed.material, result.url)
      // Finalized upload IDs are no longer writable. Resumption recognizes
      // the marked, verified final object and does not mint replacement URLs.
      assert.equal((await resume.fn.call({ req: {} }, args)).completed, true)
      const retried = await complete.fn.call({ req: {} }, args)
      assert.equal(retried.url, result.url)
      for (const key of [
        'actorId',
        'appId',
        'projectId',
        'environmentId',
        'resource',
        'field',
        'recordId'
      ]) {
        await assert.rejects(
          sails.helpers.bridge.verifyUploadReceipt.with({
            receipt: result.receipt,
            url: result.url,
            context: {
              ...context,
              [key]: 'other',
              requireCompletedMultipart: true
            }
          }),
          /before saving/
        )
      }
      await assert.rejects(
        sails.helpers.bridge.verifyUploadReceipt.with({
          receipt: result.receipt,
          url: result.url.replace('proposal-1', 'proposal-2'),
          context
        }),
        /before saving/
      )
      const tampered = { ...proof, completedMultipart: false }
      await assert.rejects(
        sails.helpers.bridge.verifyUploadReceipt.with({
          receipt:
            Buffer.from(JSON.stringify(tampered)).toString('base64url') +
            '.' +
            result.receipt.split('.')[1],
          url: result.url,
          context
        }),
        /before saving/
      )
    }
    assert(!f.operations.includes('signPut'))
  })
})

test('Immutable completion fails closed for incomplete parts, failed close, invalid HEAD and absent marker', async ({
  sails
}) => {
  await fixture(sails, async (f) => {
    const originalReceipt = sails.helpers.bridge.createUploadReceipt
    let receipts = 0
    sails.helpers.bridge.createUploadReceipt = {
      with: async (args) => {
        receipts++
        return originalReceipt.with(args)
      }
    }
    for (const failure of [
      'incomplete',
      'close',
      'size',
      'type',
      'marker',
      'head'
    ]) {
      const prepared = await prepare.fn.call({ req: {} }, inputs)
      const payload = await sails.helpers.bridge.verifyDirectUploadIntent.with({
        intent: prepared.uploadIntent,
        context
      })
      const session = f.sessions.get(payload.uploadId)
      session.parts =
        failure === 'incomplete'
          ? []
          : [{ partNumber: 1, size: inputs.fileSize, etag: 'one' }]
      session.failure = failure
      await assert.rejects(
        complete.fn.call(
          { req: {} },
          { ...inputs, uploadIntent: prepared.uploadIntent }
        ),
        (e) => !!e.badRequest
      )
      assert.equal(receipts, 0)
    }
  })
})

test('Legacy single PUT intents and receipts cannot be upgraded into immutable uploads', async ({
  sails
}) => {
  await fixture(sails, async (f) => {
    const url = 'https://assets.example.test/talks/proposal-1/legacy.mp4'
    const intent = await sails.helpers.bridge.createDirectUploadIntent.with({
      context,
      upload: {
        strategy: 'single',
        url,
        objectPath: 'talks/proposal-1/legacy.mp4',
        fileSize: 4 * MIB,
        fileType: 'video/mp4',
        recordId: inputs.recordId
      }
    })
    for (const controller of [resume, complete]) {
      await assert.rejects(
        controller.fn.call({ req: {} }, { ...inputs, uploadIntent: intent }),
        (e) => /field contract/.test(e.badRequest?.message)
      )
    }
    const receipt = await sails.helpers.bridge.createUploadReceipt.with({
      url,
      context
    })
    assert.equal(
      await sails.helpers.bridge.verifyUploadReceipt.with({
        receipt,
        url,
        context
      }),
      url
    )
    await assert.rejects(
      sails.helpers.bridge.allowActionValues.with({
        values: { material: { url, receipt } },
        resource: f.resource,
        action: f.action,
        uploadContext: context
      }),
      (error) => /before saving/.test(error.fieldErrors?.material)
    )
    const ordinaryAction = structuredClone(f.action)
    ordinaryAction.fields.material.field.upload.immutable = false
    assert.deepEqual(
      await sails.helpers.bridge.allowActionValues.with({
        values: { material: { url, receipt } },
        resource: f.resource,
        action: ordinaryAction,
        uploadContext: context
      }),
      { material: url }
    )
    // A caller cannot add the proof claim without invalidating the HMAC.
    const [encoded, signature] = receipt.split('.')
    const proof = JSON.parse(Buffer.from(encoded, 'base64url'))
    proof.completedMultipart = true
    await assert.rejects(
      sails.helpers.bridge.verifyUploadReceipt.with({
        receipt:
          Buffer.from(JSON.stringify(proof)).toString('base64url') +
          '.' +
          signature,
        url,
        context: { ...context, requireCompletedMultipart: true }
      }),
      /before saving/
    )
    await assert.rejects(
      proxy.fn.call(
        {
          req: {
            file() {
              throw new Error('Proxy must not read the file')
            }
          }
        },
        { ...inputs, values: JSON.stringify(inputs.values) }
      ),
      (e) => /multipart upload/.test(e.badRequest?.message)
    )
    assert.equal(f.operations.length, 0)
  })
})

async function fixture(sails, run) {
  const originals = { ...sails.helpers.bridge }
  const originalSecret = sails.config.session.secret
  sails.config.session.secret = 'synthetic-immutable-upload-test-secret'
  const h = (fn) => ({ with: fn })
  const resource = {
    identity: 'proposal',
    primaryKey: 'id',
    attributes: {},
    actions: { update: false, view: true }
  }
  const action = {
    name: 'uploadMaterials',
    scope: 'record',
    helper: 'bridge.uploadMaterials',
    fields: {
      material: {
        type: 'string',
        required: true,
        label: 'Material',
        field: {
          type: 'file',
          upload: {
            storage: 'bridge',
            scope: 'bucket',
            directory: 'talks/{id}',
            immutable: true,
            accept: ['video/mp4'],
            maxBytes: 512 * MIB
          }
        }
      }
    }
  }
  sails.helpers.bridge.resolveRequest = h(async () => ({
    project: { id: 2, team: 1 },
    environment: { id: 3 },
    app: { id: 4, containerName: 'fixture' },
    actorId: 5,
    actor: { id: 5 }
  }))
  sails.helpers.bridge.loadResource = h(async (args) => ({
    resource,
    recordId: args.recordId,
    actionDefinition: action
  }))
  sails.helpers.bridge.loadActionContext = h(async () => ({ action }))
  sails.helpers.bridge.getUploadStorageConfig = h(async () => ({
    publicUrl: 'https://assets.example.test'
  }))
  sails.helpers.bridge.authorizeRelationshipValues = h(async () => {})
  sails.helpers.bridge.resolveUploadObjectPath = h(async (args) => {
    assert.deepEqual(args.values, {})
    assert.equal(args.recordId, 'proposal-1')
    return { directory: 'talks/proposal-1' }
  })
  const sessions = new Map(),
    objects = new Map(),
    operations = []
  sails.helpers.bridge.directUploadStorage = h(async (args) => {
    operations.push(args.operation)
    if (args.operation === 'createMultipart') {
      const uploadId = `session-${sessions.size + 1}`
      sessions.set(uploadId, {
        immutable: args.immutable,
        parts: [],
        closed: false
      })
      return { uploadId }
    }
    const session = sessions.get(args.uploadId)
    if (
      ['listParts', 'signParts', 'completeMultipart'].includes(
        args.operation
      ) &&
      session.closed
    ) {
      throw Object.assign(new Error('Closed upload'), {
        code: 'BRIDGE_MULTIPART_UPLOAD_MISSING'
      })
    }
    if (args.operation === 'signParts')
      return {
        parts: args.partNumbers.map((partNumber) => ({
          partNumber,
          uploadUrl: `https://storage.example.test/part/${partNumber}`
        })),
        expiresInSeconds: 3600
      }
    if (args.operation === 'listParts') return { parts: session.parts }
    if (args.operation === 'completeMultipart') {
      if (session.failure === 'close') throw new Error('Completion failed')
      session.closed = true
      objects.set(args.objectPath, {
        session,
        size: session.parts.reduce((sum, p) => sum + p.size, 0)
      })
      return { etag: 'complete' }
    }
    if (args.operation === 'head') {
      const object = objects.get(args.objectPath)
      if (!object || object.session.failure === 'head')
        throw new Error('Object unavailable')
      return {
        size: object.size + (object.session.failure === 'size' ? 1 : 0),
        type: object.session.failure === 'type' ? 'text/plain' : 'video/mp4',
        etag: 'verified',
        bridgeImmutable:
          object.session.failure === 'marker' ? undefined : 'multipart-v1'
      }
    }
    throw new Error(`Unexpected storage operation: ${args.operation}`)
  })
  try {
    await run({ resource, action, sessions, objects, operations })
  } finally {
    Object.assign(sails.helpers.bridge, originals)
    sails.config.session.secret = originalSecret
  }
}
