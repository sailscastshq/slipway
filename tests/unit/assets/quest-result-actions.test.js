const assert = require('node:assert/strict')
const fs = require('node:fs')
const Vue = require('vue')
const { parse, compileScript } = require('@vue/compiler-sfc')
const { test } = require('sounding')

const resultActions = () =>
  import('../../../assets/js/components/quest/questResultActions.mjs')

test('Quest JSON actions preserve null, false, zero, empty strings, arrays and sanitized business fields exactly', async () => {
  const { serializeQuestResult } = await resultActions()
  for (const value of [
    null,
    false,
    0,
    '',
    [],
    [null, false, 0, ''],
    [{ count: 0, token: '<redacted>' }],
    { success: false, message: '', nested: { token: '[REDACTED]' } }
  ]) {
    const result = {
      status: 'available',
      value,
      exit: 'invalid',
      stdout: 'must not copy logs',
      stderr: 'must not copy diagnostics',
      exitCode: 0,
      truncated: true
    }
    const before = JSON.stringify(result)
    assert.equal(serializeQuestResult(result), JSON.stringify(value, null, 2))
    assert.deepEqual(JSON.parse(serializeQuestResult(result)), value)
    assert.equal(JSON.stringify(result), before)
  }
})

test('Quest unavailable or unsupported results never become fabricated JSON values', async () => {
  const { serializeQuestResult } = await resultActions()
  for (const status of [
    undefined,
    'undefined',
    'unsupported',
    'too_large',
    'serialization_error',
    'unavailable'
  ]) {
    assert.equal(serializeQuestResult({ status, value: null }), null)
  }
  assert.equal(serializeQuestResult(null), null)
  assert.equal(serializeQuestResult({ status: 'available' }), null)
  const circular = {}
  circular.self = circular
  let getterCalled = false
  const accessor = {
    get value() {
      getterCalled = true
      return 'not a JSON property'
    }
  }
  for (const value of [
    undefined,
    NaN,
    Infinity,
    1n,
    Symbol('unsupported'),
    () => {},
    new Date(),
    circular,
    accessor,
    { missing: undefined },
    [undefined],
    [NaN],
    Array(1)
  ]) {
    assert.equal(serializeQuestResult({ status: 'available', value }), null)
  }
  assert.equal(getterCalled, false)
})

function downloadBrowser({ fails = false } = {}) {
  const blobs = []
  const links = []
  const revoked = []
  const timers = []
  const browser = {
    Blob,
    URL: {
      createObjectURL(blob) {
        blobs.push(blob)
        return `blob:retained-${blobs.length}`
      },
      revokeObjectURL: (url) => revoked.push(url)
    },
    document: {
      createElement(tag) {
        assert.equal(tag, 'a')
        const link = {
          click() {
            assert.equal(this.appended, true)
            this.clicked = true
            if (fails) throw new Error('Downloads unavailable')
          },
          remove() {
            this.removed = true
          }
        }
        links.push(link)
        return link
      },
      body: {
        appendChild(link) {
          link.appended = true
        }
      }
    },
    setTimeout(callback, delay) {
      assert.equal(delay, 0)
      timers.push(callback)
    }
  }
  return { browser, blobs, links, revoked, timers }
}

test('Quest downloads only retained JSON, marks truncated filenames and releases every object URL', async () => {
  const { downloadQuestResultJson } = await resultActions()
  const fixture = downloadBrowser()
  for (const truncated of [false, true, false]) {
    const text = '[null, false, 0, "", "<redacted>"]'
    const filename = downloadQuestResultJson(text, truncated, fixture.browser)
    assert.equal(
      filename,
      truncated ? 'quest-result-truncated.json' : 'quest-result.json'
    )
    assert.equal(fixture.links.at(-1).download, filename)
    assert.equal(fixture.links.at(-1).removed, true)
    assert.equal(fixture.links.at(-1).hidden, true)
    assert.equal(fixture.blobs.at(-1).type, 'application/json;charset=utf-8')
    assert.equal(await fixture.blobs.at(-1).text(), text)
  }
  assert.deepEqual(fixture.revoked, [])
  fixture.timers.forEach((callback) => callback())
  assert.deepEqual(fixture.revoked, [
    'blob:retained-1',
    'blob:retained-2',
    'blob:retained-3'
  ])
  assert.throws(() => downloadQuestResultJson(null, false, fixture.browser))
  assert.equal(fixture.blobs.length, 3)
})

test('Quest failed downloads still clean up their link and object URL', async () => {
  const { downloadQuestResultJson } = await resultActions()
  const fixture = downloadBrowser({ fails: true })
  assert.throws(
    () => downloadQuestResultJson('false', false, fixture.browser),
    /Downloads unavailable/
  )
  assert.equal(fixture.links[0].removed, true)
  fixture.timers.forEach((callback) => callback())
  assert.deepEqual(fixture.revoked, ['blob:retained-1'])
})

async function compileResult(overrides = {}) {
  const Slot = {
    render() {
      return Vue.h('section', null, this.$slots.default?.())
    }
  }
  const dependencies = {
    vue: Vue,
    '@/lib/questWorkspace.mjs': await import(
      '../../../assets/js/lib/questWorkspace.mjs'
    ),
    '@/lib/helmResult': await import('../../../assets/js/lib/helmResult.js'),
    './questResultActions.mjs': { ...(await resultActions()), ...overrides },
    '@/components/ActionMenu.vue': {
      props: ['items', 'disabled', 'testId', 'label'],
      emits: ['select'],
      render() {
        return Vue.h(
          'div',
          { 'aria-label': this.label },
          this.items.map((item) =>
            Vue.h(
              'button',
              {
                type: 'button',
                disabled: this.disabled,
                'data-test': `${this.testId}-${item.key}`,
                onClick: () => this.$emit('select', item)
              },
              item.label
            )
          )
        )
      }
    }
  }
  const { descriptor } = parse(
    fs.readFileSync(
      require.resolve('../../../assets/js/components/quest/QuestResult.vue'),
      'utf8'
    )
  )
  const compiled = compileScript(descriptor, {
    id: 'quest-result-actions',
    inlineTemplate: true
  })
    .content.replace(
      /import\s+(\{[\s\S]*?\}|\w+)\s+from\s+['"]([^'"]+)['"]/g,
      (_, binding, name) =>
        binding.startsWith('{')
          ? `const ${binding.replace(
              / as /g,
              ': '
            )} = dependencies[${JSON.stringify(name)}]`
          : `const ${binding} = dependencies[${JSON.stringify(name)}] || Slot`
    )
    .replace('export default', 'return')
  return new Function('dependencies', 'Slot', compiled)(dependencies, Slot)
}

function mount(component, initialProps) {
  const props = Vue.reactive(initialProps)
  const root = { children: [] }
  const errors = []
  const remove = (node) => {
    const siblings = node.parent?.children
    const index = siblings?.indexOf(node)
    if (index >= 0) siblings.splice(index, 1)
  }
  const renderer = Vue.createRenderer({
    patchProp(node, key, previous, next) {
      node.props[key] = next
    },
    createElement: (tag) => ({ tag, props: {}, children: [] }),
    insert(node, parent, anchor) {
      remove(node)
      const index = anchor ? parent.children.indexOf(anchor) : -1
      if (index >= 0) parent.children.splice(index, 0, node)
      else parent.children.push(node)
      node.parent = parent
    },
    createText: (text) => ({ text }),
    createComment: (comment) => ({ comment }),
    setText(node, text) {
      node.text = text
    },
    setElementText(node, text) {
      node.text = text
      node.children = []
    },
    parentNode: (node) => node.parent,
    nextSibling(node) {
      const siblings = node.parent?.children || []
      return siblings[siblings.indexOf(node) + 1] || null
    },
    remove
  })
  const app = renderer.createApp({ render: () => Vue.h(component, props) })
  app.config.errorHandler = (error) => errors.push(error)
  app.mount(root)
  return { root, props, errors, stop: () => app.unmount() }
}

const content = (node) =>
  `${node.text || ''} ${(node.children || []).map(content).join(' ')}`
const find = (node, predicate) =>
  predicate(node)
    ? node
    : (node.children || []).map((child) => find(child, predicate)).find(Boolean)
const action = (root, key) =>
  find(
    root,
    (node) => node.props?.['data-test'] === `quest-result-actions-${key}`
  )
const feedback = (root) =>
  find(
    root,
    (node) => node.props?.['data-test'] === 'quest-result-action-feedback'
  )
const settle = async () => {
  await Vue.nextTick()
  await new Promise((resolve) => setImmediate(resolve))
  await Vue.nextTick()
}

function replaceNavigator(value) {
  const original = Object.getOwnPropertyDescriptor(global, 'navigator')
  Object.defineProperty(global, 'navigator', {
    configurable: true,
    value
  })
  return () => {
    if (original) Object.defineProperty(global, 'navigator', original)
    else delete global.navigator
  }
}

test('Quest result UI copies and exports every valid falsy value without receipt metadata or network reads', async () => {
  const copies = []
  const exports = []
  const restore = replaceNavigator({
    clipboard: { writeText: async (text) => copies.push(text) }
  })
  const originalFetch = global.fetch
  global.fetch = () => {
    assert.fail('Result actions must not fetch another endpoint')
  }
  const component = await compileResult({
    downloadQuestResultJson(text, truncated) {
      exports.push({ text, truncated })
      return 'quest-result.json'
    }
  })
  try {
    for (const value of [null, false, 0, '', [], [null, false, 0, '']]) {
      const view = mount(component, {
        result: { status: 'available', value, exit: 'invalid', exitCode: 0 }
      })
      try {
        assert.match(content(view.root), /Exit: invalid/)
        assert.match(content(view.root), /retained, sanitized return value/)
        assert.equal(action(view.root, 'copy-json').props.type, 'button')
        assert.equal(feedback(view.root).props['aria-live'], 'polite')
        action(view.root, 'copy-json').props.onClick()
        await settle()
        assert.equal(copies.at(-1), JSON.stringify(value, null, 2))
        assert.match(content(feedback(view.root)), /Copied result JSON/)
        action(view.root, 'export-json').props.onClick()
        await settle()
        assert.deepEqual(exports.at(-1), {
          text: JSON.stringify(value, null, 2),
          truncated: false
        })
        assert.match(content(feedback(view.root)), /Download started/)
        assert.deepEqual(view.errors, [])
      } finally {
        view.stop()
      }
    }
  } finally {
    restore()
    global.fetch = originalFetch
  }
})

test('Quest result UI hides JSON actions for unavailable, undefined, unsupported, pending and legacy results', async () => {
  const component = await compileResult()
  const cases = [
    ...[
      'undefined',
      'unsupported',
      'too_large',
      'serialization_error',
      'unavailable'
    ].map((status) => ({ result: { status, value: null, exit: 'invalid' } })),
    { result: { status: 'available' } },
    { result: { status: 'available', value: undefined } },
    { result: { status: 'available', value: false }, pending: true },
    { result: { status: 'available', value: false }, legacy: true }
  ]
  for (const props of cases) {
    const view = mount(component, props)
    try {
      assert.equal(action(view.root, 'copy-json'), undefined)
      assert.equal(action(view.root, 'export-json'), undefined)
      assert.deepEqual(view.errors, [])
    } finally {
      view.stop()
    }
  }
})

test('Quest truncated named-exit results retain their warning through repeated copies and exports', async () => {
  const copies = []
  const exports = []
  const restore = replaceNavigator({
    clipboard: { writeText: async (text) => copies.push(text) }
  })
  const component = await compileResult({
    downloadQuestResultJson(text, truncated) {
      exports.push({ text, truncated })
      return 'quest-result-truncated.json'
    }
  })
  const value = [{ token: '<redacted>', processed: 0 }]
  const view = mount(component, {
    result: { status: 'available', value, exit: 'partial', truncated: true }
  })
  try {
    assert.match(content(view.root), /Exit: partial/)
    assert.match(content(view.root), /Copy retained JSON/)
    assert.match(content(view.root), /Export retained JSON/)
    assert.match(content(view.root), /Return value truncated/)
    for (let index = 0; index < 3; index++) {
      action(view.root, 'copy-json').props.onClick()
      await settle()
      assert.match(content(feedback(view.root)), /Copied retained JSON only/)
      action(view.root, 'export-json').props.onClick()
      await settle()
      assert.match(content(feedback(view.root)), /quest-result-truncated.json/)
      assert.match(content(view.root), /will not include omitted data/)
    }
    assert.deepEqual(copies, Array(3).fill(JSON.stringify(value, null, 2)))
    assert.deepEqual(
      exports,
      Array(3).fill({ text: JSON.stringify(value, null, 2), truncated: true })
    )
    assert.deepEqual(view.errors, [])
  } finally {
    view.stop()
    restore()
  }
})

test('Quest clipboard rejection or missing support reports failure and permits retry without false success', async () => {
  let reject = true
  const restore = replaceNavigator({
    clipboard: {
      async writeText() {
        if (reject) throw new Error('Clipboard denied')
      }
    }
  })
  const component = await compileResult()
  const view = mount(component, {
    result: { status: 'available', value: false }
  })
  try {
    action(view.root, 'copy-json').props.onClick()
    await settle()
    assert.match(content(feedback(view.root)), /Could not copy/)
    assert.doesNotMatch(content(feedback(view.root)), /Copied/)
    assert.equal(action(view.root, 'copy-json').props.disabled, false)
    reject = false
    action(view.root, 'copy-json').props.onClick()
    await settle()
    assert.match(content(feedback(view.root)), /Copied result JSON/)
    delete global.navigator.clipboard
    action(view.root, 'copy-json').props.onClick()
    await settle()
    assert.match(content(feedback(view.root)), /Could not copy/)
    assert.deepEqual(view.errors, [])
  } finally {
    view.stop()
    restore()
  }
})

test('Quest in-flight copy suppresses repeated actions and cannot update a different result or an unmounted view', async () => {
  const copies = []
  const completions = []
  const restore = replaceNavigator({
    clipboard: {
      writeText(text) {
        copies.push(text)
        return new Promise((resolve, reject) =>
          completions.push({ resolve, reject })
        )
      }
    }
  })
  let exports = 0
  const component = await compileResult({
    downloadQuestResultJson() {
      exports += 1
    }
  })
  const view = mount(component, {
    result: { status: 'available', value: 'first' }
  })
  try {
    action(view.root, 'copy-json').props.onClick()
    action(view.root, 'copy-json').props.onClick()
    action(view.root, 'export-json').props.onClick()
    await settle()
    assert.equal(action(view.root, 'copy-json').props.disabled, true)
    assert.deepEqual(copies, ['"first"'])
    assert.equal(exports, 0)
    view.props.result = { status: 'available', value: 'second' }
    await settle()
    assert.equal(action(view.root, 'copy-json').props.disabled, false)
    assert.equal(content(feedback(view.root)).trim(), '')
    action(view.root, 'copy-json').props.onClick()
    await settle()
    completions[0].resolve()
    await settle()
    assert.match(content(feedback(view.root)), /Copying result/)
    assert.equal(action(view.root, 'copy-json').props.disabled, true)
    completions[1].resolve()
    await settle()
    assert.match(content(feedback(view.root)), /Copied result JSON/)
    action(view.root, 'copy-json').props.onClick()
    await settle()
    view.stop()
    completions[2].reject(new Error('View already closed'))
    await settle()
    assert.deepEqual(view.errors, [])
  } finally {
    view.stop()
    restore()
  }
})

test('Quest download failure reports a retryable error without claiming a saved export', async () => {
  let fail = true
  const component = await compileResult({
    downloadQuestResultJson() {
      if (fail) throw new Error('Download blocked')
      return 'quest-result.json'
    }
  })
  const view = mount(component, { result: { status: 'available', value: 0 } })
  try {
    action(view.root, 'export-json').props.onClick()
    await settle()
    assert.match(content(feedback(view.root)), /Could not start the download/)
    assert.doesNotMatch(content(feedback(view.root)), /Download started/)
    fail = false
    action(view.root, 'export-json').props.onClick()
    await settle()
    assert.match(
      content(feedback(view.root)),
      /Download started: quest-result.json/
    )
    assert.deepEqual(view.errors, [])
  } finally {
    view.stop()
  }
})

test('Quest table, tree and raw views copy the same retained sanitized value', async () => {
  const copies = []
  const restore = replaceNavigator({
    clipboard: { writeText: async (text) => copies.push(text) }
  })
  const component = await compileResult()
  const value = [{ count: 0, token: '<redacted>' }]
  const view = mount(component, { result: { status: 'available', value } })
  try {
    for (const name of ['table', 'tree', 'raw', 'table']) {
      const button = find(
        view.root,
        (node) => node.tag === 'button' && node.text?.trim() === name
      )
      assert.equal(button.props.type, 'button')
      assert.match(button.props.class, /focus-visible:ring-2/)
      button.props.onClick()
      await settle()
      assert.equal(button.props['aria-pressed'], true)
      action(view.root, 'copy-json').props.onClick()
      await settle()
    }
    assert.deepEqual(copies, Array(4).fill(JSON.stringify(value, null, 2)))
    assert.deepEqual(view.errors, [])
  } finally {
    view.stop()
    restore()
  }
})

test('Quest changing selection before an action starts cancels the old copy and clears prior feedback', async () => {
  const copies = []
  const restore = replaceNavigator({
    clipboard: { writeText: async (text) => copies.push(text) }
  })
  const component = await compileResult()
  const view = mount(component, {
    result: { status: 'available', value: 'old result' }
  })
  try {
    action(view.root, 'copy-json').props.onClick()
    view.props.pending = true
    await settle()
    assert.deepEqual(copies, [])
    assert.equal(action(view.root, 'copy-json'), undefined)
    view.props.pending = false
    view.props.result = { status: 'available', value: 'new result' }
    await settle()
    action(view.root, 'copy-json').props.onClick()
    await settle()
    assert.deepEqual(copies, ['"new result"'])
    assert.match(content(feedback(view.root)), /Copied result JSON/)
    view.props.result.truncated = true
    await settle()
    assert.equal(content(feedback(view.root)).trim(), '')
    assert.match(content(view.root), /Copy retained JSON/)
    assert.deepEqual(view.errors, [])
  } finally {
    view.stop()
    restore()
  }
})
