const assert = require('node:assert/strict')
const fs = require('node:fs')
const Vue = require('vue')
const { parse, compileScript } = require('@vue/compiler-sfc')
const { test } = require('sounding')

async function compileComponent(filename) {
  const helpers = await import('../../../assets/js/lib/questWorkspace.mjs')
  const { descriptor } = parse(
    fs.readFileSync(require.resolve(filename), 'utf8')
  )
  const script = compileScript(descriptor, {
    id: filename,
    inlineTemplate: true
  })
  const Slot = {
    render() {
      return Vue.h('section', null, this.$slots.default?.())
    }
  }
  const dependencies = {
    vue: Vue,
    '@/lib/questWorkspace.mjs': helpers,
    '@/components/ui/tabs/Tabs.vue': {
      emits: ['update:modelValue'],
      render() {
        return Vue.h(
          'section',
          {
            'data-test': 'test-tabs',
            onClick: () => this.$emit('update:modelValue', 'logs')
          },
          this.$slots.default?.()
        )
      }
    },
    './QuestStatus.vue': {
      props: ['state'],
      render() {
        return Vue.h('span', this.state)
      }
    },
    './QuestResult.vue': {
      render() {
        return Vue.h('span', 'Business result component')
      }
    }
  }
  const compiled = script.content
    .replace(
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

function mount(component, props) {
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
      return { tag, props: {}, children: [] }
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
  const app = renderer.createApp({ render: () => Vue.h(component, props) })
  app.mount(root)
  return { root, stop: () => app.unmount() }
}
const content = (node) =>
  `${node.text || ''} ${(node.children || []).map(content).join(' ')}`
const find = (node, predicate) =>
  predicate(node)
    ? node
    : (node.children || []).map((child) => find(child, predicate)).find(Boolean)

test('Quest skipped details show a no-child result and neutral reason without fetching nonexistent process logs', async () => {
  const component = await compileComponent(
    '../../../assets/js/components/quest/QuestRunDetail.vue'
  )
  const originalFetch = global.fetch
  try {
    for (const [reason, message] of [
      ['paused', 'The job is paused.'],
      ['already_running', 'Another execution is already running.']
    ]) {
      const requests = []
      global.fetch = async (url) => {
        requests.push(url)
        return {
          ok: true,
          json: async () => ({
            run: {
              runId: 'skip-1',
              state: 'skipped',
              trigger: 'unknown',
              error: reason,
              startedAt: null,
              requestedAt: Date.now(),
              duration: null,
              exitCode: null,
              result: { status: 'unavailable' }
            }
          })
        }
      }
      const view = mount(component, {
        apiUrl: '/fixture/quest',
        runId: 'skip-1'
      })
      try {
        await new Promise((resolve) => setImmediate(resolve))
        await Vue.nextTick()
        const text = content(view.root)
        assert.match(
          text,
          /This job did not start, so there is no business result\./
        )
        assert.ok(text.includes(message))
        assert.match(text, /Unknown origin/)
        assert.equal(text.includes('Business result component'), false)
        assert.equal(text.includes('Return value unavailable'), false)
        const reasonNode = find(
          view.root,
          (node) => node.props?.role === 'status'
        )
        assert.match(reasonNode.props.class, /bg-amber-50/)
        assert.doesNotMatch(reasonNode.props.class, /bg-red-50/)
        find(
          view.root,
          (node) => node.props?.['data-test'] === 'test-tabs'
        ).props.onClick()
        await Vue.nextTick()
        assert.deepEqual(requests, ['/fixture/quest/runs/skip-1'])
        assert.match(content(view.root), /no process logs were produced/)
      } finally {
        view.stop()
      }
    }
  } finally {
    global.fetch = originalFetch
  }
})

test('Quest run rows explicitly distinguish known triggers from unknown origins', async () => {
  const component = await compileComponent(
    '../../../assets/js/components/quest/QuestRuns.vue'
  )
  for (const [trigger, label] of [
    ['scheduled', 'Scheduled'],
    ['manual', 'Manual'],
    ['cli', 'CLI'],
    ['unknown', 'Unknown origin'],
    [undefined, 'Unknown origin'],
    ['arbitrary-origin', 'Unknown origin']
  ]) {
    const view = mount(component, {
      runs: [{ runId: 'skip-1', jobName: 'report', state: 'skipped', trigger }]
    })
    try {
      assert.ok(content(view.root).includes(label))
      assert.equal(content(view.root).includes('arbitrary-origin'), false)
    } finally {
      view.stop()
    }
  }
})
