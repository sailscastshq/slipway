const path = require('node:path')

const MANIFEST_FILE = 'quest-preload-manifest.json'
const MAX_ASSETS = 32
const ASSET_PATH = /^(?:js|css)\/(?:async\/)?[\w-]+\.[a-f\d]{8,}\.(?:js|css)$/

function questPreloadAssets(compilation, questPath) {
  const groups = new Set()
  for (const module of compilation.modules) {
    if (module.nameForCondition?.() !== questPath) continue
    for (const chunk of compilation.chunkGraph.getModuleChunksIterable(module))
      for (const group of chunk.groupsIterable) {
        if (!group.isInitial()) groups.add(group)
      }
  }

  // A page may be concatenated with its inspector, but must resolve to one
  // route group. Never fall back to preloading every asynchronous app asset.
  if (groups.size !== 1) return []
  const files = new Set()
  for (const chunk of [...groups][0].chunks) {
    if (chunk.canBeInitial()) continue
    for (const file of chunk.files) {
      if (!/\.(?:js|css)$/.test(file)) continue
      if (!ASSET_PATH.test(file)) return []
      files.add('/' + file)
    }
  }
  return files.size <= MAX_ASSETS ? [...files].sort() : []
}

class QuestPreloadManifestPlugin {
  apply(compiler) {
    if (compiler.options.mode !== 'production') return
    const name = 'QuestPreloadManifestPlugin'
    const { Compilation, sources } = compiler.webpack
    const questPath = path.resolve(
      compiler.context,
      'assets/js/pages/projects/quest.vue'
    )
    compiler.hooks.thisCompilation.tap(name, (compilation) => {
      compilation.hooks.processAssets.tap(
        { name, stage: Compilation.PROCESS_ASSETS_STAGE_REPORT },
        () => {
          const assets = questPreloadAssets(compilation, questPath)
          compilation.emitAsset(
            MANIFEST_FILE,
            new sources.RawSource(
              JSON.stringify({
                version: 1,
                mode: 'production',
                page: 'projects/quest',
                assets
              })
            )
          )
        }
      )
    })
  }
}

module.exports = { QuestPreloadManifestPlugin, questPreloadAssets }
