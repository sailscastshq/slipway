const VARIABLE_PATTERN =
  /\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g
const MAX_EXPANSION_DEPTH = 64
const MAX_EXPANDED_VALUE_LENGTH = 1024 * 1024

module.exports = {
  friendlyName: 'Build Docker environment arguments',

  description:
    'Build shell-free Docker environment arguments with safe variable interpolation.',

  sync: true,

  inputs: {
    envVars: {
      type: 'ref',
      defaultsTo: {},
      description: 'Environment variables to pass to the container.'
    },
    runtimeValues: {
      type: 'ref',
      defaultsTo: {},
      description:
        'Slipway-owned runtime values available while expanding references.'
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: function ({ envVars, runtimeValues }) {
    assertVariableMap(envVars, 'envVars')
    assertVariableMap(runtimeValues, 'runtimeValues')

    const envEntries = Object.entries(envVars)
    const contextEntries = [
      ...envEntries,
      ...Object.entries(runtimeValues)
    ].map(([key, value]) => [key, String(value)])
    const escapedDollar = createEscapedDollarMarker(contextEntries)
    const context = new Map(
      contextEntries.map(([key, value]) => [
        key,
        protectEscapedDollars(value, escapedDollar)
      ])
    )
    const resolved = new Map()
    const args = []

    for (const [key, value] of envEntries) {
      const protectedValue = protectEscapedDollars(String(value), escapedDollar)
      const expansion = expandTemplate({
        template: protectedValue,
        context,
        resolved,
        stack: new Set([key]),
        depth: 0,
        rootKey: key
      })

      args.push(
        '-e',
        `${key}=${restoreEscapedDollars(expansion.value, escapedDollar)}`
      )
    }

    return args
  }
}

function expandTemplate({
  template,
  context,
  resolved,
  stack,
  depth,
  rootKey
}) {
  let cyclic = false

  const value = template.replace(
    VARIABLE_PATTERN,
    (reference, bracedName, bareName) => {
      const name = bracedName || bareName

      if (!context.has(name)) {
        return reference
      }

      if (stack.has(name) || depth >= MAX_EXPANSION_DEPTH) {
        cyclic = true
        return reference
      }

      if (resolved.has(name)) {
        return resolved.get(name)
      }

      const nextStack = new Set(stack)
      nextStack.add(name)
      const nested = expandTemplate({
        template: context.get(name),
        context,
        resolved,
        stack: nextStack,
        depth: depth + 1,
        rootKey
      })

      if (nested.cyclic) {
        cyclic = true
        return reference
      }

      resolved.set(name, nested.value)
      return nested.value
    }
  )

  if (value.length > MAX_EXPANDED_VALUE_LENGTH) {
    throw new Error(
      `Expanded value for environment variable "${rootKey}" exceeds the 1 MiB safety limit.`
    )
  }

  return { value, cyclic }
}

function createEscapedDollarMarker(entries) {
  const values = entries.map(([, value]) => value)
  let marker = '\uE000SLIPWAY_ESCAPED_DOLLAR\uE001'

  while (values.some((value) => value.includes(marker))) {
    marker += '_'
  }

  return marker
}

function protectEscapedDollars(value, marker) {
  return value.replace(/\$\$/g, marker)
}

function restoreEscapedDollars(value, marker) {
  return value.split(marker).join('$')
}

function assertVariableMap(value, inputName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${inputName} must be an object of environment variables.`)
  }
}
