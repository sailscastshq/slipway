const path = require('node:path')
const root = process.cwd()
const req = require('node:module').createRequire(
  path.join(root, 'package.json')
)
const { createRsbuild } = req('@rsbuild/core')
const { pluginVue } = req('@rsbuild/plugin-vue')
const { pluginTailwindcss } = req('@rsbuild/plugin-tailwindcss')
module.exports = async () => {
  const build = await createRsbuild({
    cwd: root,
    rsbuildConfig: {
      plugins: [pluginVue(), pluginTailwindcss()],
      resolve: {
        alias: {
          '@': path.join(root, 'assets/js')
        }
      },
      source: {
        entry: {
          index: path.join(root, 'tests/fixtures/select-audit/main.js')
        }
      },
      output: { distPath: { root: path.join(root, '.tmp/select803-dist') } },
      html: { title: 'Select audit · synthetic fixture' }
    }
  })
  await build.build()
}
