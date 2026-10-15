module.exports = {
  friendlyName: 'Validate action conditions',
  description:
    'Verify condition references against the resource and declared sibling fields.',
  sync: true,
  inputs: {
    action: { type: 'ref' },
    resource: { type: 'ref' }
  },
  exits: { success: {} },
  fn: function ({ action, resource }) {
    if (
      Object.keys(action.visibleWhen || {}).some((path) =>
        path.startsWith('form.')
      )
    )
      throw new Error('Action visibility may only reference record fields.')
    for (const [name, attribute] of Object.entries(action.fields || {})) {
      for (const [path, expected] of Object.entries(
        attribute.visibleWhen || {}
      )) {
        if (!path.startsWith('form.')) continue
        const driverName = path.slice(5)
        const driver = action.fields[driverName]
        if (
          driverName === name ||
          !driver ||
          driver.visibleWhen ||
          driver.sensitive ||
          !['boolean', 'number', 'text', 'select'].includes(driver.field?.type)
        )
          throw new Error(
            `Bridge action "${action.name}" form condition must reference an unconditional scalar sibling field.`
          )
        const expectedValues =
          expected && typeof expected === 'object' ? expected.in : [expected]
        if (
          !expectedValues.every(
            (value) => value === null || typeof value === driver.type
          )
        )
          throw new Error(
            `Bridge action "${action.name}" form condition must match its sibling field type.`
          )
      }
    }
    const references = sails.helpers.bridge.getActionConditionFields.with({
      action
    })
    if (references.length && action.scope !== 'record')
      throw new Error(
        `Bridge action "${action.name}" visibleWhen requires record scope.`
      )
    for (const name of references) {
      const attr = resource.attributes[name]
      if (
        !attr ||
        !resource.show.includes(name) ||
        attr.sensitive ||
        attr.model ||
        attr.collection ||
        !['string', 'number', 'boolean'].includes(attr.type) ||
        attr.field?.type === 'currency'
      )
        throw new Error(
          `Bridge action "${action.name}" condition field "${name}" must be a visible, non-sensitive scalar record field.`
        )
    }
  }
}
