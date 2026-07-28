const { test } = require('sounding')

test('Bridge resolves reusable upload path templates from fields and relationships', async ({
  sails,
  expect
}) => {
  const originalBuildSailsWrapper = sails.helpers.bridge.buildSailsWrapper
  const originalExecuteInContainer = sails.helpers.bridge.executeInContainer
  let executedCode = ''
  sails.helpers.bridge.buildSailsWrapper = async (code) => code
  sails.helpers.bridge.executeInContainer = async (_containerName, code) => {
    executedCode = code
    return {
      success: true,
      output: JSON.stringify({
        resolved: {
          '{workspace.slug}': 'acme-studio',
          '{folder.title|slug}': 'Brand Assets',
          '{title|slug}': 'Summer Campaign'
        }
      })
    }
  }

  try {
    const result = await sails.helpers.bridge.resolveUploadObjectPath.with({
      containerName: 'content-web',
      resource: documentResource(),
      resources: resources(),
      upload: {
        directory: '{workspace.slug}/{folder.title|slug}',
        filename: '{title|slug}'
      },
      values: {
        title: 'Summer Campaign',
        workspace: 'workspace-1',
        folder: 'folder-1'
      }
    })

    expect(result).toEqual({
      directory: 'acme-studio/brand-assets',
      filename: 'summer-campaign'
    })
    expect(executedCode).toContain('sails.models[definition.identity]')
    expect(executedCode).toContain('"workspace-1"')
    expect(executedCode).toContain('"folder-1"')
  } finally {
    sails.helpers.bridge.buildSailsWrapper = originalBuildSailsWrapper
    sails.helpers.bridge.executeInContainer = originalExecuteInContainer
  }
})

test('Bridge upload templates fail safely when required context is missing', async ({
  sails,
  expect
}) => {
  const originalBuildSailsWrapper = sails.helpers.bridge.buildSailsWrapper
  const originalExecuteInContainer = sails.helpers.bridge.executeInContainer
  sails.helpers.bridge.buildSailsWrapper = async (code) => code
  sails.helpers.bridge.executeInContainer = async () => ({
    success: true,
    output: JSON.stringify({
      resolved: {
        '{workspace.slug}': null,
        '{title|slug}': 'A document'
      }
    })
  })

  try {
    let receivedError
    try {
      await sails.helpers.bridge.resolveUploadObjectPath.with({
        containerName: 'content-web',
        resource: documentResource(),
        resources: resources(),
        upload: {
          directory: '{workspace.slug}',
          filename: '{title|slug}'
        },
        values: { title: 'A document' }
      })
    } catch (error) {
      receivedError = error
    }

    expect(receivedError.code).toBe('BRIDGE_UPLOAD_PATH_INVALID')
    expect(receivedError.message).toBe(
      'Complete Workspace before uploading this file.'
    )
  } finally {
    sails.helpers.bridge.buildSailsWrapper = originalBuildSailsWrapper
    sails.helpers.bridge.executeInContainer = originalExecuteInContainer
  }
})

function documentResource() {
  return {
    identity: 'document',
    primaryKey: 'id',
    attributes: {
      id: { type: 'string' },
      title: { type: 'string', sensitive: false },
      workspace: { type: 'string' },
      folder: { type: 'string' }
    },
    associations: [
      {
        alias: 'workspace',
        type: 'model',
        model: 'workspace'
      },
      {
        alias: 'folder',
        type: 'model',
        model: 'folder'
      }
    ],
    relationships: {
      workspace: {
        alias: 'workspace',
        resource: 'workspace'
      },
      folder: {
        alias: 'folder',
        resource: 'folder'
      }
    }
  }
}

function resources() {
  return {
    document: documentResource(),
    workspace: {
      identity: 'workspace',
      primaryKey: 'id',
      attributes: {
        id: { type: 'string' },
        slug: { type: 'string', sensitive: false }
      },
      associations: []
    },
    folder: {
      identity: 'folder',
      primaryKey: 'id',
      attributes: {
        id: { type: 'string' },
        title: { type: 'string', sensitive: false }
      },
      associations: []
    }
  }
}
