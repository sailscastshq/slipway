const path = require('node:path')
module.exports = async () => {
  const root = process.cwd()
  const { createRsbuild } = require('@rsbuild/core')
  const { pluginVue } = require('@rsbuild/plugin-vue')
  const { pluginTailwindcss } = require('@rsbuild/plugin-tailwindcss')
  const { pluginInertia } = require('rsbuild-plugin-inertia')
  const build = await createRsbuild({
    cwd: root,
    rsbuildConfig: {
      plugins: [
        pluginVue(),
        pluginTailwindcss(),
        pluginInertia({ pages: false })
      ],
      resolve: { alias: { '@': path.join(root, 'assets/js') } },
      source: {
        entry: { index: path.join(root, 'tests/fixtures/ci/main.js') }
      },
      output: {
        distPath: { root: path.join(root, '.tmp/ci-component-preview') }
      },
      html: { title: 'CI · Slipway component preview' }
    }
  })
  await build.build()
}
if (require.main === module)
  module.exports().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
