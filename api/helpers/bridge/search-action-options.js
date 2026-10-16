module.exports = {
  friendlyName: 'Search Bridge action options',
  description:
    'Call only a configured options provider with an authorized record context.',
  inputs: {
    containerName: { type: 'string', required: true },
    action: { type: 'ref', required: true },
    fieldName: { type: 'string', required: true },
    actor: { type: 'ref', required: true },
    recordId: { type: 'ref', required: true },
    values: { type: 'ref', defaultsTo: {} },
    q: { type: 'string', defaultsTo: '', maxLength: 100 },
    selectedIds: { type: 'ref', defaultsTo: [] }
  },
  fn: async function ({
    containerName,
    action,
    fieldName,
    actor,
    recordId,
    values,
    q,
    selectedIds
  }) {
    const provider = action.fields?.[fieldName]?.field?.optionsProvider
    if (
      !provider ||
      !/^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*$/.test(
        provider.helper
      ) ||
      provider.helper
        .split('.')
        .some((part) =>
          ['constructor', 'prototype', '__proto__'].includes(part)
        )
    )
      throw new Error('This options provider is unavailable.')
    if (
      !Array.isArray(selectedIds) ||
      selectedIds.length > 100 ||
      selectedIds.some(
        (id) => typeof id !== 'string' || !id.trim() || id.length > 200
      )
    )
      throw new Error('Invalid selected identifiers.')
    const dependencies = Object.fromEntries(
      provider.dependsOn
        .filter((name) => Object.hasOwn(values, name))
        .map((name) => [name, values[name]])
    )
    const code = `
      let helper = sails.helpers;
      for (const segment of ${JSON.stringify(
        provider.helper
      )}.split('.')) helper = helper && helper[segment];
      if (!helper || typeof helper.with !== 'function') throw new Error('Options provider unavailable');
      const result = await helper.with(${JSON.stringify({
        actor,
        recordId,
        values: dependencies,
        q,
        selectedIds
      })});
      if (!result || !Array.isArray(result.options) || result.options.length > 100) throw new Error('Invalid options response');
      return {options: result.options.map(option=>({value:option.value,label:option.label,description:option.description})),hasMore:result.hasMore===true};
    `
    const response = await sails.helpers.bridge.executeInContainer(
      containerName,
      await sails.helpers.bridge.buildSailsWrapper(code)
    )
    if (
      !response.success ||
      typeof response.output !== 'string' ||
      response.output.length > 100000
    )
      throw new Error('Options could not be loaded. Try again.')
    let result
    try {
      result = JSON.parse(response.output)
    } catch {
      throw new Error('Options could not be loaded. Try again.')
    }
    if (
      !Array.isArray(result.options) ||
      result.options.length > 100 ||
      result.options.some(
        (option) =>
          !option ||
          typeof option.value !== 'string' ||
          !option.value ||
          option.value.length > 200 ||
          typeof option.label !== 'string' ||
          !option.label ||
          option.label.length > 200 ||
          (option.description !== undefined &&
            (typeof option.description !== 'string' ||
              option.description.length > 320))
      ) ||
      new Set(result.options.map((o) => o.value)).size !== result.options.length
    )
      throw new Error('Options could not be loaded. Try again.')
    return { options: result.options, hasMore: result.hasMore === true }
  }
}
