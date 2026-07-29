const acorn = require('acorn')

const MODEL_MUTATIONS = new Map([
  ['addToCollection', 'Add to collection'],
  ['archive', 'Archive records'],
  ['archiveOne', 'Archive one record'],
  ['create', 'Create records'],
  ['createEach', 'Create records'],
  ['destroy', 'Destroy records'],
  ['destroyOne', 'Destroy one record'],
  ['removeFromCollection', 'Remove from collection'],
  ['replaceCollection', 'Replace collection'],
  ['save', 'Save a record'],
  ['update', 'Update records'],
  ['updateOne', 'Update one record']
])

const NATIVE_CALLS = new Map([
  ['sendNativeQuery', 'Run a native database query'],
  ['query', 'Run a native query']
])

const EXTERNAL_IDENTIFIERS = new Map([
  ['fetch', 'Make an external request'],
  ['request', 'Make an external request']
])

const EXTERNAL_METHODS = new Map([
  ['broadcast', 'Broadcast an external event'],
  ['emit', 'Emit an external event'],
  ['enqueue', 'Enqueue background work'],
  ['publish', 'Publish an external event'],
  ['schedule', 'Schedule background work'],
  ['sendTemplate', 'Send a message']
])

module.exports = {
  friendlyName: 'Classify Helm mutations',

  description:
    'Use JavaScript parser data to identify obvious writes and external side effects without executing submitted source.',

  inputs: {
    source: {
      type: 'string',
      required: true
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  sync: true,

  fn: function ({ source }) {
    const submittedSource = String(source || '')
    const prefix = 'async function __helmMutationScan__() {\n'
    const suffix = '\n}'
    let program

    try {
      program = acorn.parse(`${prefix}${submittedSource}${suffix}`, {
        ecmaVersion: 'latest',
        sourceType: 'script',
        locations: true
      })
    } catch (error) {
      return {
        mutating: false,
        complete: false,
        findings: [],
        parserError: {
          line: Math.max(1, (error.loc?.line || 2) - 1),
          column: (error.loc?.column || 0) + 1
        }
      }
    }

    const findings = []
    walk(program, (node) => {
      if (node.type !== 'CallExpression') return

      const callee = unwrapChain(node.callee)
      const property = memberPropertyName(callee)
      const identifier = callee?.type === 'Identifier' ? callee.name : null
      const path = memberPath(callee)

      if (property && MODEL_MUTATIONS.has(property)) {
        addFinding(findings, node, {
          kind: 'database-write',
          method: property,
          label: MODEL_MUTATIONS.get(property)
        })
        return
      }

      if (property && NATIVE_CALLS.has(property)) {
        addFinding(findings, node, {
          kind: 'native-query',
          method: property,
          label: NATIVE_CALLS.get(property)
        })
        return
      }

      if (identifier && EXTERNAL_IDENTIFIERS.has(identifier)) {
        addFinding(findings, node, {
          kind: 'external-side-effect',
          method: identifier,
          label: EXTERNAL_IDENTIFIERS.get(identifier)
        })
        return
      }

      if (
        (identifier === 'axios' || path.startsWith('axios.')) &&
        !path.endsWith('.get')
      ) {
        addFinding(findings, node, {
          kind: 'external-side-effect',
          method: property || identifier,
          label: 'Make an external request'
        })
        return
      }

      const helperExternalMethod = [...EXTERNAL_METHODS.keys()].find(
        (method) =>
          path.includes(`.${method}.`) && isRecognizedExternalPath(path)
      )
      if (helperExternalMethod) {
        addFinding(findings, node, {
          kind: 'external-side-effect',
          method: helperExternalMethod,
          label: EXTERNAL_METHODS.get(helperExternalMethod)
        })
        return
      }

      if (
        property &&
        EXTERNAL_METHODS.has(property) &&
        isRecognizedExternalPath(path)
      ) {
        addFinding(findings, node, {
          kind: 'external-side-effect',
          method: property,
          label: EXTERNAL_METHODS.get(property)
        })
      }
    })

    return {
      mutating: findings.length > 0,
      complete: true,
      findings: findings.slice(0, 20).map(({ key, ...finding }) => finding)
    }
  }
}

function addFinding(findings, node, finding) {
  const line = Math.max(1, (node.loc?.start.line || 2) - 1)
  const column = (node.loc?.start.column || 0) + 1
  const key = `${finding.kind}:${finding.method}:${line}:${column}`
  if (findings.some((candidate) => candidate.key === key)) return
  findings.push({ ...finding, line, column, key })
}

function unwrapChain(node) {
  return node?.type === 'ChainExpression' ? node.expression : node
}

function memberPropertyName(node) {
  const unwrapped = unwrapChain(node)
  if (unwrapped?.type !== 'MemberExpression') return null
  if (!unwrapped.computed && unwrapped.property.type === 'Identifier') {
    return unwrapped.property.name
  }
  if (
    unwrapped.computed &&
    unwrapped.property.type === 'Literal' &&
    typeof unwrapped.property.value === 'string'
  ) {
    return unwrapped.property.value
  }
  return null
}

function memberPath(node) {
  const unwrapped = unwrapChain(node)
  if (!unwrapped) return ''
  if (unwrapped.type === 'Identifier') return unwrapped.name
  if (unwrapped.type === 'CallExpression') return memberPath(unwrapped.callee)
  if (unwrapped.type !== 'MemberExpression') return ''

  const object = memberPath(unwrapped.object)
  const property = memberPropertyName(unwrapped)
  return [object, property].filter(Boolean).join('.')
}

function isRecognizedExternalPath(path) {
  return [
    'sails.helpers.mail.',
    'sails.helpers.quest.',
    'sails.helpers.request.',
    'sails.helpers.webhook.',
    'sails.sockets.',
    'Mail.',
    'Quest.',
    'Webhook.'
  ].some((prefix) => path.startsWith(prefix))
}

function walk(value, visit, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)

  if (typeof value.type === 'string') visit(value)

  for (const [key, child] of Object.entries(value)) {
    if (['loc', 'start', 'end'].includes(key)) continue
    if (Array.isArray(child)) {
      for (const entry of child) walk(entry, visit, seen)
    } else {
      walk(child, visit, seen)
    }
  }
}
