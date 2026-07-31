module.exports = {
  friendlyName: 'Validate Bridge resource values',

  description:
    'Validate normalized Bridge values against the target Waterline model without mutating it.',

  inputs: {
    containerName: {
      type: 'string',
      required: true
    },
    resource: {
      type: 'ref',
      required: true
    },
    values: {
      type: 'ref',
      required: true
    },
    recordId: {
      type: 'ref'
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ containerName, resource, values, recordId }) {
    const fields = Object.keys(values)
    if (!fields.length) return {}

    const validationContract = {
      identity: resource.identity,
      primaryKey: resource.primaryKey,
      fields: Object.fromEntries(
        fields.map((field) => {
          const attribute = resource.attributes[field] || {}
          return [
            field,
            {
              label: attribute.label || field,
              unique: attribute.unique === true,
              association: (resource.associations || []).some(
                (candidate) =>
                  candidate.type === 'model' && candidate.alias === field
              )
            }
          ]
        })
      )
    }
    const validationCode = `
      const contract = ${JSON.stringify(validationContract)};
      const values = ${JSON.stringify(values)};
      const recordId = ${JSON.stringify(recordId)};
      const model = sails.models[contract.identity];
      if (!model) throw new Error('Configured Bridge model is unavailable.');

      const fieldErrors = {};
      for (const [field, value] of Object.entries(values)) {
        const fieldContract = contract.fields[field];
        if (!fieldContract || fieldContract.association) continue;

        try {
          if (typeof model.validate === 'function') {
            model.validate(field, value);
          }
        } catch (_error) {
          fieldErrors[field] = fieldContract.label + ' is invalid.';
          continue;
        }

        if (fieldContract.unique && value !== null && value !== undefined) {
          const existing = await model.findOne({ [field]: value }).select([
            contract.primaryKey
          ]);
          if (
            existing &&
            (recordId === null ||
              recordId === undefined ||
              String(existing[contract.primaryKey]) !== String(recordId))
          ) {
            fieldErrors[field] = fieldContract.label + ' is already in use.';
          }
        }
      }

      return { fieldErrors };
    `
    const wrappedCode = await sails.helpers.bridge.buildSailsWrapper(
      validationCode
    )
    const result = await sails.helpers.bridge.executeInContainer(
      containerName,
      wrappedCode
    )

    if (!result.success) {
      const error = new Error(
        result.error || 'Bridge could not validate this record.'
      )
      error.code = 'BRIDGE_VALIDATION_FAILED'
      throw error
    }

    let fieldErrors
    try {
      fieldErrors = JSON.parse(result.output).fieldErrors || {}
    } catch (cause) {
      const error = new Error('Bridge could not read the validation result.')
      error.code = 'BRIDGE_VALIDATION_FAILED'
      error.cause = cause
      throw error
    }

    if (Object.keys(fieldErrors).length) {
      const error = new Error('Some Bridge fields are invalid.')
      error.code = 'BRIDGE_FIELD_INVALID'
      error.fields = Object.keys(fieldErrors)
      error.fieldErrors = fieldErrors
      throw error
    }

    return values
  }
}
