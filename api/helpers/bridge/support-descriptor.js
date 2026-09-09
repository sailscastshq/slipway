module.exports = {
  friendlyName: 'Read host support configuration',
  inputs: { containerName: { type: 'string', required: true } },
  fn: async function ({ containerName }) {
    const result = await sails.helpers.bridge.executeInContainer(
      containerName,
      `
      let support = { enabled: false };
      try {
        const policy = require('sails-hook-slipway/lib/bridge-support-policy');
        const mapping = policy.configuration(sails);
        support = { enabled: mapping.enabled && Array.isArray(mapping.readOnlyPaths) && mapping.readOnlyPaths.length > 0,
          model: mapping.model, idAttribute: mapping.idAttribute };
      } catch {}
      console.log(JSON.stringify(support));
    `
    )
    if (!result.success) return { enabled: false }
    try {
      return JSON.parse(result.output)
    } catch {
      return { enabled: false }
    }
  }
}
