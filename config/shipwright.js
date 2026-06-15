try {
  const { pluginVue } = require('@rsbuild/plugin-vue')
  const { pluginInertia } = require('rsbuild-plugin-inertia')

  module.exports.shipwright = {
    build: {
      plugins: [pluginVue(), pluginInertia()]
    }
  }
} catch {
  // @rsbuild/plugin-vue is a devDependency — not available in production.
  // The sails-hook-shipwright hook (also a devDep) won't load either,
  // so this config is unused at runtime.
}
