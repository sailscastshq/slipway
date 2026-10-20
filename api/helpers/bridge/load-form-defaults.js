module.exports = {
  friendlyName: 'Load Bridge form defaults',
  description:
    'Call only the configured defaults helper and validate its bounded suggestions.',
  inputs: {
    containerName: { type: 'string', required: true },
    environmentId: { type: 'number', required: true },
    resource: { type: 'ref', required: true },
    actor: { type: 'ref', required: true },
    surface: { type: 'string', isIn: ['create', 'edit'], required: true },
    recordId: { type: 'ref' },
    values: { type: 'ref', required: true }
  },
  fn: async function ({
    containerName,
    environmentId,
    resource,
    actor,
    surface,
    recordId,
    values
  }) {
    const provider = resource.defaultsProvider
    if (
      !provider ||
      !/^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*$/.test(
        provider.helper
      ) ||
      provider.helper
        .split('.')
        .some((s) => ['constructor', 'prototype', '__proto__'].includes(s))
    )
      throw new Error('Defaults provider unavailable.')
    const names = provider.dependsOn
    if (
      names.some(
        (name) =>
          values[name] === undefined ||
          values[name] === null ||
          values[name] === ''
      )
    )
      return { values: {} }
    const dependencies = await sails.helpers.bridge.allowResourceValues.with({
      resource,
      surface,
      values,
      validateOnly: names
    })
    if (
      names.some(
        (name) =>
          dependencies[name] === undefined ||
          dependencies[name] === null ||
          dependencies[name] === ''
      )
    )
      return { values: {} }
    await sails.helpers.bridge.authorizeRelationshipValues.with({
      containerName,
      environmentId,
      resource,
      actor,
      values: dependencies
    })
    const code = `
      let helper = sails.helpers;
      for (const segment of ${JSON.stringify(
        provider.helper
      )}.split('.')) helper = helper && helper[segment];
      if (!helper || typeof helper.with !== 'function') throw new Error('Defaults provider unavailable');
      const result = await helper.with(${JSON.stringify({
        actor,
        surface,
        ...(recordId == null ? {} : { recordId }),
        values: dependencies
      })});
      return result;
    `
    const response = await sails.helpers.bridge.executeInContainer(
      containerName,
      await sails.helpers.bridge.buildSailsWrapper(code)
    )
    if (
      !response.success ||
      typeof response.output !== 'string' ||
      response.output.length > 12000
    )
      throw new Error('Invalid defaults response.')
    const result = JSON.parse(response.output)
    if (
      !result ||
      !result.values ||
      typeof result.values !== 'object' ||
      Array.isArray(result.values) ||
      Object.keys(result).some((key) => key !== 'values') ||
      Object.keys(result.values).some((name) => !provider.fields.includes(name))
    )
      throw new Error('Invalid defaults response.')
    if (Object.keys(result.values).length === 0) return { values: {} }
    const typed = await sails.helpers.bridge.allowResourceValues.with({
      resource,
      surface,
      values: { ...dependencies, ...result.values },
      validateOnly: Object.keys(result.values)
    })
    const defaults = Object.fromEntries(
      Object.keys(result.values).map((name) => [name, typed[name]])
    )
    await sails.helpers.bridge.authorizeRelationshipValues.with({
      containerName,
      environmentId,
      resource,
      actor,
      values: { ...dependencies, ...defaults }
    })
    return { values: defaults }
  }
}
