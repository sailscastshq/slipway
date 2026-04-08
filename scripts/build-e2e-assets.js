const path = require('node:path')
const {
  createRsbuild,
  defineConfig,
  mergeRsbuildConfig
} = require('@rsbuild/core')
const { pluginVue } = require('@rsbuild/plugin-vue')
const {
  detectStylesEntry,
  detectJsEntry,
  expandEntryPatterns
} = require('sails-hook-shipwright/lib/entry')

async function main() {
  const appPath = process.cwd()
  const shipwrightModule = require(path.resolve(
    appPath,
    'config/shipwright.js'
  ))
  const shipwrightConfig = shipwrightModule.shipwright || {}

  const entry = {}
  const jsEntry = detectJsEntry(appPath, shipwrightConfig.js?.entry)
  const stylesEntry = detectStylesEntry(appPath, shipwrightConfig.styles?.entry)
  const jsFiles = expandEntryPatterns(jsEntry, appPath)

  if (jsFiles?.length) {
    entry.app = jsFiles
  } else if (jsEntry && !Array.isArray(jsEntry)) {
    entry.app = [path.resolve(appPath, jsEntry)]
  }

  if (stylesEntry) {
    const stylesPath = path.resolve(appPath, stylesEntry)

    if (entry.app) {
      entry.app.unshift(stylesPath)
    } else {
      entry.styles = stylesPath
    }
  }

  if (!Object.keys(entry).length) {
    return
  }

  const defaultConfig = defineConfig({
    source: { entry },
    resolve: {
      alias: {
        '@': path.resolve(appPath, 'assets', 'js'),
        '~': path.resolve(appPath, 'assets')
      }
    },
    output: {
      manifest: true,
      distPath: {
        root: '.tmp/public',
        css: 'css',
        js: 'js',
        font: 'fonts',
        image: 'images'
      },
      copy: [
        {
          from: path.resolve(appPath, 'assets'),
          to: path.resolve(appPath, '.tmp', 'public'),
          noErrorOnMissing: true,
          globOptions: { ignore: ['**/js/**', '**/styles/**', '**/css/**'] }
        }
      ]
    },
    tools: {
      htmlPlugin: false,
      cssLoader: { url: { filter: (url) => !url.startsWith('/') } },
      rspack: {
        watchOptions: {
          ignored: /^(?!.*[\\/](assets|node_modules)[\\/])/
        }
      }
    },
    performance: {
      chunkSplit: { strategy: 'split-by-experience' },
      printFileSize: { diff: true }
    },
    logLevel: 'error'
  })

  const rsbuildConfig = mergeRsbuildConfig(
    defaultConfig,
    shipwrightConfig.build || { plugins: [pluginVue()] }
  )

  const rsbuild = await createRsbuild({ rsbuildConfig })
  await rsbuild.build()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
