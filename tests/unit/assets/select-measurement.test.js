const assert = require('node:assert/strict')
const fs = require('node:fs')
const Vue = require('vue')
const { parse, compileScript } = require('@vue/compiler-sfc')
const { test } = require('node:test')

// Mount the real Select lifecycle with a fixed-geometry renderer. Native
// popover placement and focus are covered by the select-styling browser test.
function mountSelect(initialProps = {}, { observeResize = true } = {}) {
  const previousObserver = global.ResizeObserver
  const observers = []
  let width = 160
  const ResizeObserverStub = observeResize
    ? class {
        constructor(callback) {
          this.callback = callback
          observers.push(this)
        }
        observe(element) {
          this.element = element
        }
        disconnect() {
          this.disconnected = true
        }
      }
    : undefined
  const Popover = {
    props: ['open'],
    emits: ['update:open'],
    setup(props, { attrs, emit, slots, expose }) {
      expose({ open: () => emit('update:open', true) })
      return () => Vue.h('section', attrs, slots.default?.())
    }
  }
  const dependencies = {
    vue: Vue,
    'tailwind-merge': require('tailwind-merge'),
    '../popover/Popover.vue': Popover
  }
  const { descriptor } = parse(
    fs.readFileSync(
      require.resolve('../../../assets/js/components/ui/select/Select.vue'),
      'utf8'
    )
  )
  const compiled = compileScript(descriptor, {
    id: 'select-measurement',
    inlineTemplate: true
  })
    .content.replace(
      /import\s+(\{[\s\S]*?\}|\w+)\s+from\s+['"]([^'"]+)['"]/g,
      (_, binding, name) =>
        `const ${binding.replace(
          / as /g,
          ': '
        )} = dependencies[${JSON.stringify(name)}]`
    )
    .replace('export default', 'return')
  const Select = new Function('dependencies', compiled)(dependencies)
  const root = { children: [] }
  const remove = (node) => {
    const siblings = node.parent?.children
    const index = siblings?.indexOf(node)
    if (index >= 0) siblings.splice(index, 1)
  }
  const renderer = Vue.createRenderer({
    patchProp(node, key, previous, next) {
      node.props[key] = next
    },
    createElement(tag) {
      return {
        tag,
        props: {},
        children: [],
        getBoundingClientRect() {
          return { width }
        }
      }
    },
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
  const props = Vue.reactive({
    options: [
      { value: 'first', label: 'First' },
      { value: 'second', label: 'Second' }
    ],
    ...initialProps
  })
  const select = Vue.ref()
  const app = renderer.createApp({
    render: () => Vue.h(Select, { ...props, ref: select })
  })
  global.ResizeObserver = ResizeObserverStub
  try {
    app.mount(root)
  } catch (error) {
    observers.forEach((observer) => observer.disconnect())
    global.ResizeObserver = previousObserver
    throw error
  }
  const find = (node, slot) =>
    node.props?.['data-slot'] === slot
      ? node
      : node.children?.map((child) => find(child, slot)).find(Boolean)
  return {
    props,
    observers,
    open: () => select.value.open(),
    close: () => select.value.close(),
    resize(nextWidth) {
      width = nextWidth
      observers.forEach((observer) => observer.callback())
    },
    isOpen: () =>
      find(root, 'select-trigger').props['aria-expanded'] === 'true',
    popupWidth: () => find(root, 'select-content').props.style?.minWidth,
    stop() {
      try {
        app.unmount()
      } finally {
        global.ResizeObserver = previousObserver
      }
    }
  }
}

const flush = async () => {
  await Vue.nextTick()
  await Vue.nextTick()
}

test('Select refreshes popup width on opening, open resize and reopening', async () => {
  const view = mountSelect()
  try {
    await flush()
    assert.equal(view.isOpen(), false)
    view.resize(240)
    view.open()
    await flush()
    assert.equal(view.popupWidth(), '240px')
    view.resize(320)
    await flush()
    assert.equal(view.popupWidth(), '320px')
    view.close()
    await flush()
    assert.equal(view.isOpen(), false)
    view.resize(400)
    await flush()
    view.open()
    await flush()
    assert.equal(view.popupWidth(), '400px')
  } finally {
    view.stop()
  }
  assert.equal(view.observers[0].disconnected, true)
})

test('Select measures initially open controlled and default-open popups', async () => {
  for (const props of [{ open: true }, { defaultOpen: true }]) {
    const view = mountSelect(props)
    try {
      await flush()
      assert.equal(view.isOpen(), true)
      assert.equal(view.popupWidth(), '160px')
      view.resize(280)
      await flush()
      assert.equal(view.popupWidth(), '280px')
    } finally {
      view.stop()
    }
  }
})

test('Select respects controlled closed state and sizes parent-driven opens without a ResizeObserver', async () => {
  const view = mountSelect(
    { open: false, defaultOpen: true },
    { observeResize: false }
  )
  try {
    await flush()
    assert.equal(view.isOpen(), false)
    view.resize(260)
    view.props.open = true
    await flush()
    assert.equal(view.popupWidth(), '260px')
    view.props.open = false
    await flush()
    assert.equal(view.isOpen(), false)
    view.resize(380)
    view.props.open = true
    await flush()
    assert.equal(view.popupWidth(), '380px')
  } finally {
    view.stop()
  }
})
