const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('sounding')
const ejs = require('ejs')
const renderInertia = require('inertia-sails/lib/render')
const {
  QuestPreloadManifestPlugin,
  questPreloadAssets
} = require('../../../scripts/quest-preload-manifest')

const js = '/js/async/1234.0123456789.js'
const css = '/css/async/1234.abcdef0123.css'
const initial = '/js/app.0123456789.js'
const questPath = '/app/assets/js/pages/projects/quest.vue'

function graph() {
  const page = { nameForCondition: () => questPath }
  const unrelated = { nameForCondition: () => questPath + '.js' }
  const group = {
    isInitial: () => false,
    chunks: [
      { canBeInitial: () => true, files: [initial.slice(1)] },
      { canBeInitial: () => false, files: [js.slice(1), css.slice(1)] }
    ],
    childrenIterable: [
      { chunks: [{ files: ['js/async/not-initial.0123456789.js'] }] }
    ]
  }
  const pageChunk = { groupsIterable: new Set([group]) }
  return {
    group,
    pageChunk,
    compilation: {
      modules: [unrelated, page],
      chunkGraph: {
        getModuleChunksIterable(module) {
          assert.equal(module, page)
          return [pageChunk]
        }
      }
    }
  }
}

function readerFixture() {
  let now = 1000
  let reads = 0
  const files = {
    'quest-preload-manifest.json': JSON.stringify({
      version: 1,
      mode: 'production',
      page: 'projects/quest',
      assets: [js, css]
    }),
    'manifest.json': JSON.stringify({
      allFiles: [js, css, initial],
      entries: { app: { initial: { js: [initial], css: [] } } }
    })
  }
  const filesystem = {
    statSync(filename) {
      const value = files[path.basename(filename)]
      if (value === undefined) throw new Error('ENOENT')
      return { isFile: () => true, size: Buffer.byteLength(value) }
    },
    readFileSync(filename) {
      reads++
      return Buffer.from(files[path.basename(filename)])
    }
  }
  const module = { exports: {} }
  vm.runInNewContext(
    fs.readFileSync(
      path.resolve(__dirname, '../../../api/lib/quest-asset-preloads.js'),
      'utf8'
    ),
    {
      module,
      Date: { now: () => now },
      require(name) {
        if (name === 'node:fs') return filesystem
        if (name === 'node:path') return path
        throw new Error(name)
      }
    }
  )
  return {
    files,
    read: (options = {}) => module.exports({ appPath: '/app', ...options }),
    reads: () => reads,
    advance: (ms) => (now += ms),
    setManifest(value) {
      files['quest-preload-manifest.json'] = JSON.stringify(value)
    }
  }
}

test('Quest preload graph includes only the actual route group, excluding initial and deferred chunks', () => {
  const { compilation } = graph()
  assert.deepEqual(questPreloadAssets(compilation, questPath), [css, js])
})

test('Quest preload graph fails closed for missing, ambiguous, unsafe or excessive assets', () => {
  const missing = graph()
  assert.deepEqual(questPreloadAssets(missing.compilation, '/missing.vue'), [])
  const ambiguous = graph()
  ambiguous.pageChunk.groupsIterable.add({ isInitial: () => false })
  assert.deepEqual(questPreloadAssets(ambiguous.compilation, questPath), [])
  for (const file of ['//remote.test/x.js', '../secret.js', 'js/dev.js']) {
    const fixture = graph()
    fixture.group.chunks[1].files = [file]
    assert.deepEqual(questPreloadAssets(fixture.compilation, questPath), [])
  }
  const excessive = graph()
  excessive.group.chunks[1].files = Array.from(
    { length: 33 },
    (_, i) => `js/async/${i}.0123456789.js`
  )
  assert.deepEqual(questPreloadAssets(excessive.compilation, questPath), [])
})

test('Quest preload plugin leaves development compilation untouched', () => {
  const plugin = new QuestPreloadManifestPlugin()
  plugin.apply({ options: { mode: 'development' } })
})

test('Quest preload plugin writes metadata after production asset hashing', () => {
  const fixture = graph()
  let startCompilation
  let processAssets
  let emitted
  fixture.compilation.hooks = {
    processAssets: {
      tap(options, fn) {
        assert.equal(options.stage, 5000)
        processAssets = fn
      }
    }
  }
  fixture.compilation.emitAsset = (file, source) => {
    emitted = { file, data: JSON.parse(source.source) }
  }
  new QuestPreloadManifestPlugin().apply({
    context: '/app',
    options: { mode: 'production' },
    webpack: {
      Compilation: { PROCESS_ASSETS_STAGE_REPORT: 5000 },
      sources: {
        RawSource: class {
          constructor(source) {
            this.source = source
          }
        }
      }
    },
    hooks: { thisCompilation: { tap: (_, fn) => (startCompilation = fn) } }
  })
  startCompilation(fixture.compilation)
  processAssets()
  assert.equal(emitted.file, 'quest-preload-manifest.json')
  assert.deepEqual(emitted.data, {
    version: 1,
    mode: 'production',
    page: 'projects/quest',
    assets: [css, js]
  })
})

test('Quest preload reader validates current hashed assets and caches bounded metadata', () => {
  const fixture = readerFixture()
  const assets = fixture.read()
  assert.equal(
    JSON.stringify(assets),
    JSON.stringify([
      { href: js, as: 'script' },
      { href: css, as: 'style' }
    ])
  )
  assert.equal(fixture.read(), assets)
  assert.equal(fixture.reads(), 2)
  assert.ok(Object.isFrozen(assets) && Object.isFrozen(assets[0]))
  fixture.files['quest-preload-manifest.json'] = '{}'
  fixture.advance(1000)
  assert.equal(fixture.read().length, 0)
  assert.equal(fixture.reads(), 4)
})

test('Quest preload reader never reads production metadata with a live development pipeline', () => {
  const fixture = readerFixture()
  assert.equal(fixture.read({ development: true }).length, 0)
  assert.equal(fixture.reads(), 0)
})

test('Quest preload reader fails closed for missing, malformed, oversized, stale or unsafe metadata', () => {
  const manifest = {
    version: 1,
    mode: 'production',
    page: 'projects/quest',
    assets: [js]
  }
  for (const assets of [
    ['https://remote.test/x.js'],
    ['//remote.test/x.js'],
    ['/js/../private.0123456789.js'],
    ['/js/async/x.0123456789.js?token=1'],
    ['/js/async/x.0123456789.js" onload="alert(1)'],
    ['/css/async/1234.0123456789.js'],
    ['/js/async/stale.0123456789.js'],
    [initial],
    Array(33).fill(js)
  ]) {
    const fixture = readerFixture()
    fixture.setManifest({ ...manifest, assets })
    assert.equal(fixture.read().length, 0)
  }
  for (const value of [undefined, '{', ' '.repeat(131073)]) {
    const fixture = readerFixture()
    fixture.files['quest-preload-manifest.json'] = value
    assert.equal(fixture.read().length, 0)
  }
  for (const change of [
    { version: 2 },
    { mode: 'development' },
    { page: 'projects/helm' }
  ]) {
    const fixture = readerFixture()
    fixture.setManifest({ ...manifest, ...change })
    assert.equal(fixture.read().length, 0)
  }
})

test('Quest production template preloads only Quest and preserves safe host asset prefixes', () => {
  const template = fs.readFileSync(
    path.resolve(__dirname, '../../../views/app.ejs'),
    'utf8'
  )
  const render = (component, hostAssetBasePath = '') =>
    ejs.render(template, {
      page: { component, props: { hostAssetBasePath } },
      questAssetPreloads: [{ href: js, as: 'script' }],
      shipwright: { styles: () => '', scripts: () => '' }
    })
  assert.match(render('projects/quest'), new RegExp(`href="${js}"`))
  assert.match(render('projects/quest'), /data-quest-preload="1"/)
  assert.match(
    render('projects/quest', '/_slipway/assets'),
    new RegExp(`href="/_slipway/assets${js}"`)
  )
  assert.doesNotMatch(render('projects/helm'), /rel="preload"/)
  assert.doesNotMatch(
    render('projects/quest', '//remote.test'),
    /rel="preload"/
  )
})

test('Quest controller hints survive actual Inertia rendering and nested EJS locals without entering JSON responses', async () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../../api/controllers/project/view-quest.js'),
    'utf8'
  )
  for (const scenario of [
    {
      environment: 'production',
      hook: true,
      inertia: false,
      development: false
    },
    { environment: 'test', hook: false, inertia: false, development: false },
    {
      environment: 'development',
      hook: true,
      inertia: false,
      development: true
    },
    {
      environment: 'production',
      hook: false,
      inertia: true,
      development: false
    }
  ]) {
    const module = { exports: {} }
    const calls = []
    const workspace = { jobs: [], legacyEvents: [] }
    const hints = [{ href: js, as: 'script' }]
    const sails = {
      config: {
        appPath: '/app',
        environment: scenario.environment,
        inertia: { rootView: 'app', ssr: false }
      },
      hooks: { shipwright: scenario.hook },
      inertia: {
        getLocals: () => ({ title: 'Quest fixture' }),
        getShared: () => ({}),
        shouldClearHistory: () => false,
        shouldEncryptHistory: () => false,
        consumePreserveFragment: () => false,
        consumeFlash: () => ({})
      }
    }
    vm.runInNewContext(source, {
      module,
      sails,
      User: { forRequest: async () => ({ team: { id: 1 } }) },
      Project: { findOne: async () => ({ id: 2, slug: 'demo' }) },
      Environment: { findOne: async () => ({ id: 3, slug: 'production' }) },
      App: { findOne: async () => null },
      require(name) {
        if (name === '../../lib/app-selection')
          return async (req, environmentId) => {
            assert.equal(req.url, '/projects/demo/quest')
            assert.equal(environmentId, 3)
            return { app: null, defaultApp: null, explicit: false }
          }
        if (name === '../../lib/quest-workspace')
          return { initialSnapshot: async () => workspace }
        if (name === '../../lib/quest-asset-preloads')
          return (options) => {
            calls.push(options)
            return options.development ? [] : hints
          }
        throw new Error(name)
      }
    })
    const req = {
      _sails: sails,
      headers: scenario.inertia ? { 'x-inertia': 'true' } : {},
      method: 'GET',
      url: '/projects/demo/quest',
      get(name) {
        return this.headers[name.toLowerCase()]
      }
    }
    const res = {
      locals: {},
      set() {
        return this
      },
      json(page) {
        return page
      },
      view(name, data) {
        assert.equal(name, 'app')
        const template = fs.readFileSync(
          path.resolve(__dirname, '../../../views/app.ejs'),
          'utf8'
        )
        return ejs.render(template, {
          ...this.locals,
          ...data,
          shipwright: { styles: () => '', scripts: () => '' }
        })
      }
    }
    const result = await module.exports.fn.call(
      { req, res },
      { slug: 'demo', envSlug: 'production' }
    )
    assert.equal(result.props.workspace, workspace)
    assert.equal(calls.length, scenario.inertia ? 0 : 1)
    if (!scenario.inertia) {
      assert.equal(calls[0].development, scenario.development)
      if (!scenario.development)
        assert.equal(result.locals.questAssetPreloads, hints)
    } else assert.equal(result.locals.questAssetPreloads, undefined)
    assert.equal(res.locals.questAssetPreloads, undefined)

    // The installed Inertia renderer creates data.locals independently from
    // res.locals. Exercise that integration instead of hand-assembling EJS
    // data, which can hide a misplaced controller local.
    const rendered = await renderInertia(req, res, result)
    if (scenario.inertia) {
      assert.equal(rendered.component, 'projects/quest')
      assert.equal(rendered.props.questAssetPreloads, undefined)
      assert.equal(rendered.locals, undefined)
    } else {
      const tags = rendered.match(/data-quest-preload="1"/g) || []
      assert.equal(tags.length, scenario.development ? 0 : hints.length)
      if (!scenario.development)
        assert.match(rendered, new RegExp(`href="${js}"`))
    }
  }
})
