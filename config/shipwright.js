try {
  const { pluginVue } = require('@rsbuild/plugin-vue')
  module.exports.shipwright = {
    build: {
      plugins: [pluginVue()]
    }
  }
} catch {
  // @rsbuild/plugin-vue is a devDependency — not available in production.
  // The sails-hook-shipwright hook (also a devDep) won't load either,
  // so this config is unused at runtime.
}
