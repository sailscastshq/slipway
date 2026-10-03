try {
  const { pluginTailwindcss } = require('@rsbuild/plugin-tailwindcss')
  const { pluginVue } = require('@rsbuild/plugin-vue')
  const { pluginInertia } = require('rsbuild-plugin-inertia')
  const {
    QuestPreloadManifestPlugin
  } = require('../scripts/quest-preload-manifest')

  module.exports.shipwright = {
    build: {
      // Sails parses the text/plain activation POST before Shipwright's dev
      // middleware. Compile async chunks up front in dev; production still
      // downloads these chunks only when their UI is opened.
      dev: { lazyCompilation: false },
      tools: { rspack: { plugins: [new QuestPreloadManifestPlugin()] } },
      plugins: [pluginVue(), pluginTailwindcss(), pluginInertia()]
    }
  }
} catch {
  // @rsbuild/plugin-vue is a devDependency — not available in production.
  // The sails-hook-shipwright hook (also a devDep) won't load either,
  // so this config is unused at runtime.
}
