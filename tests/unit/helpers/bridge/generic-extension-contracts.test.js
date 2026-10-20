const { test } = require('sounding')
const assert = require('node:assert/strict')

test('Bridge defaults and immutable receipts work for a shipping app without conference models or routes', async ({
  sails
}) => {
  const originals = { ...sails.helpers.bridge }
  const models = {
    shipment: {
      identity: 'shipment',
      primaryKey: 'id',
      attributes: {
        id: { type: 'number', autoIncrement: true },
        country: { type: 'string' },
        customer: { type: 'string' },
        street: { type: 'string' },
        city: { type: 'string' },
        postalCode: { type: 'string' },
        documentUrl: { type: 'string' }
      }
    }
  }
  const defaultsProvider = {
    helper: 'bridge.customerAddressDefaults',
    dependsOn: ['country', 'customer'],
    fields: ['street', 'city', 'postalCode']
  }
  const contract = await originals.normalizeResourceContract.with({
    models,
    config: {
      resources: {
        shipment: {
          defaultsProvider,
          fields: {
            documentUrl: {
              type: 'file',
              upload: {
                immutable: true,
                directory: 'documents/{id}',
                accept: ['application/pdf']
              }
            }
          }
        }
      }
    }
  })
  const resource = contract.resources.shipment
  assert.deepEqual(resource.defaultsProvider, defaultsProvider)
  assert.equal(resource.attributes.documentUrl.field.upload.immutable, true)
  let received
  sails.helpers.bridge.buildSailsWrapper = async (code) => code
  sails.helpers.bridge.authorizeRelationshipValues = { with: async () => {} }
  sails.helpers.bridge.executeInContainer = async (_, code) => ({
    success: true,
    output: JSON.stringify(
      await new Function('sails', `return(async()=>{${code}})()`)({
        helpers: {
          bridge: {
            customerAddressDefaults: {
              with: async (input) => {
                received = input
                return {
                  values: {
                    street: 'Example Street',
                    city: 'Berlin',
                    postalCode: '10115'
                  }
                }
              }
            }
          }
        }
      })
    )
  })
  try {
    const result = await originals.loadFormDefaults.with({
      containerName: 'shipping-fixture',
      environmentId: 3,
      resource,
      actor: { id: 'operator' },
      surface: 'create',
      values: { country: 'DE', customer: 'customer-1' }
    })
    assert.deepEqual(received.values, { country: 'DE', customer: 'customer-1' })
    assert.equal(result.values.city, 'Berlin')
    const context = {
      actorId: 'operator',
      appId: 4,
      projectId: 2,
      environmentId: 3,
      resource: 'shipment.attachDocument',
      field: 'documentUrl',
      recordId: 'shipment-1'
    }
    const url = 'https://files.example.test/documents/shipment-1/object.pdf'
    const receipt = await originals.createUploadReceipt.with({
      url,
      context,
      completedMultipart: true
    })
    assert.equal(
      await originals.verifyUploadReceipt.with({
        url,
        receipt,
        context: { ...context, requireCompletedMultipart: true }
      }),
      url
    )
    const {
      normalizeMediaPreview
    } = require('../../../../api/lib/bridge-media-preview')
    assert.deepEqual(
      normalizeMediaPreview({
        type: 'pdf',
        title: 'Shipping document',
        url: '/api/files/file-1/preview'
      }),
      {
        type: 'pdf',
        title: 'Shipping document',
        url: '/api/files/file-1/preview'
      }
    )
  } finally {
    Object.assign(sails.helpers.bridge, originals)
  }
})
