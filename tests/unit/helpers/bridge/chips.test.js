const { test } = require('sounding')
const assert = require('node:assert/strict')

test('Bridge currency chips preserve USD/NGN arrays and reject malformed amounts', async ({
  sails
}) => {
  const { toBridgeFieldInputValue, prepareBridgeFieldSubmission } =
    await import('../../../../assets/js/lib/bridge/fields.mjs')
  for (const [code, locale, stored] of [
    ['USD', 'en-US', [500, 1250]],
    ['NGN', 'en-NG', [100000, 250000]]
  ]) {
    const contract = await sails.helpers.bridge.normalizeResourceContract.with({
      models: {
        event: {
          identity: 'event',
          primaryKey: 'id',
          attributes: {
            id: { type: 'number' },
            presets: { type: 'json' },
            metadata: { type: 'json' }
          }
        }
      },
      config: {
        resources: {
          event: {
            fields: {
              presets: {
                type: 'chips',
                items: {
                  type: 'currency',
                  currency: { code, locale, storage: 'minor', submit: 'minor' }
                }
              }
            }
          }
        }
      }
    })
    const resource = contract.resources.event,
      attribute = resource.attributes.presets
    const input = toBridgeFieldInputValue(attribute, stored)
    const submit = prepareBridgeFieldSubmission({
      attribute,
      value: input
    }).value
    const result = await sails.helpers.bridge.allowResourceValues.with({
      resource,
      surface: 'edit',
      values: { presets: submit, metadata: { arbitrary: true } }
    })
    assert.deepEqual(result.presets, stored)
    assert.deepEqual(result.metadata, { arbitrary: true })
    const empty = await sails.helpers.bridge.allowResourceValues.with({
      resource,
      surface: 'edit',
      values: { presets: [] }
    })
    assert.deepEqual(empty.presets, [])
    for (const value of [
      ['-1'],
      ['1.001'],
      ['Infinity'],
      [Infinity],
      [true],
      ['90071992547409.92'],
      ['0'],
      ['1', '1.00']
    ]) {
      await assert.rejects(() =>
        sails.helpers.bridge.allowResourceValues.with({
          resource,
          surface: 'edit',
          values: { presets: value }
        })
      )
    }
  }
})
