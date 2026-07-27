const { test } = require('sounding')

test('Bridge field inputs and submissions use the normalized contract', async ({
  expect
}) => {
  const {
    bridgeFieldType,
    prepareBridgeFieldSubmission,
    toBridgeFieldInputValue,
    validateBridgeFieldValue
  } = await import('../../../assets/js/lib/bridge/fields.mjs')
  const currency = {
    type: 'number',
    required: true,
    label: 'Price',
    field: {
      type: 'currency',
      currency: {
        code: 'USD',
        storage: 'minor',
        submit: 'major',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }
    }
  }
  const json = {
    type: 'json',
    required: true,
    label: 'Metadata',
    field: { type: 'json' }
  }

  expect(bridgeFieldType(currency)).toBe('currency')
  expect(toBridgeFieldInputValue(json, { level: 'production' })).toBe(
    '{\n  "level": "production"\n}'
  )
  expect(
    validateBridgeFieldValue({
      attribute: json,
      value: '{broken'
    })
  ).toBe('Metadata must contain valid JSON.')
  expect(
    prepareBridgeFieldSubmission({
      attribute: json,
      value: '{"level":"production"}'
    })
  ).toEqual({
    include: true,
    value: { level: 'production' }
  })
  expect(
    prepareBridgeFieldSubmission({
      attribute: currency,
      value: '34.99'
    })
  ).toEqual({ include: true, value: 34.99 })
  expect(
    validateBridgeFieldValue({
      attribute: {
        type: 'string',
        label: 'Release date',
        field: { type: 'date' }
      },
      value: '2026-02-31'
    })
  ).toBe('Release date must be a valid date.')
})

test('Bridge field formatting is safe and typed', async ({ expect }) => {
  const { formatBridgeFieldValue, safeBridgeHttpUrl } = await import(
    '../../../assets/js/lib/bridge/fields.mjs'
  )

  expect(
    formatBridgeFieldValue(
      34.99,
      {
        field: {
          type: 'currency',
          currency: {
            code: 'USD',
            locale: 'en-US',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
          }
        }
      },
      'show'
    ).display
  ).toBe('$34.99')
  expect(safeBridgeHttpUrl('javascript:alert(1)')).toBe(null)
  expect(safeBridgeHttpUrl('https://example.com/file.png')).toBe(
    'https://example.com/file.png'
  )
})

test('Bridge custom field components are registered per surface', async ({
  expect
}) => {
  const {
    clearBridgeFieldComponents,
    registerBridgeFieldComponent,
    resolveBridgeFieldComponent
  } = await import('../../../assets/js/lib/bridge/field-components.mjs')
  const form = { name: 'RatingForm' }
  const list = { name: 'RatingList' }

  try {
    registerBridgeFieldComponent('content/rating', { form, list })

    expect(resolveBridgeFieldComponent('content/rating', 'form')).toBe(form)
    expect(resolveBridgeFieldComponent('content/rating', 'list')).toBe(list)
    expect(resolveBridgeFieldComponent('content/rating', 'show')).toBe(null)
  } finally {
    clearBridgeFieldComponents()
  }
})
