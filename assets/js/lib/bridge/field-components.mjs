const registry = new Map()

export function registerBridgeFieldComponent(name, components) {
  if (!/^[A-Za-z][A-Za-z0-9]*(?:[./-][A-Za-z0-9]+)*$/.test(name)) {
    throw new Error('Bridge field component names must be safe identifiers.')
  }
  if (!components || typeof components !== 'object') {
    throw new Error('Bridge field components must be an object.')
  }
  registry.set(name, { ...components })
}

export function resolveBridgeFieldComponent(name, context) {
  if (!name) return null
  return registry.get(name)?.[context] || null
}

export function clearBridgeFieldComponents() {
  registry.clear()
}
