// Public, versioned appearance contract, also bundled by the UI.
const palettes = {
  light: {
    canvas: '#ffffff',
    surface: '#f5f5f5',
    text: '#171717',
    mutedText: '#616161',
    border: '#d4d4d4',
    accent: '#0369a1',
    accentText: '#ffffff',
    focus: '#0369a1'
  },
  dark: {
    canvas: '#0a0a0a',
    surface: '#171717',
    text: '#fafafa',
    mutedText: '#a3a3a3',
    border: '#404040',
    accent: '#7dd3fc',
    accentText: '#082f49',
    focus: '#7dd3fc'
  }
}
const fonts = {
  system: 'system-ui, sans-serif',
  editorial: 'Georgia, serif',
  mono: 'ui-monospace, monospace'
}
const radii = { square: '4px', soft: '12px', round: '20px' }
const tokens = Object.keys(palettes.light)
const modes = ['host', 'system', 'light', 'dark']
const color = (value) =>
  typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)
function normalize(value = {}, fallbackName = 'App') {
  const source =
    value && typeof value === 'object' && value.version === 1 ? value : {}
  return {
    version: 1,
    displayName:
      typeof source.displayName === 'string'
        ? source.displayName.trim().slice(0, 80) || fallbackName
        : fallbackName,
    logoText:
      typeof source.logoText === 'string'
        ? source.logoText.trim().slice(0, 120)
        : '',
    mode: modes.includes(source.mode) ? source.mode : 'system',
    fallbackMode: ['system', 'light', 'dark'].includes(source.fallbackMode)
      ? source.fallbackMode
      : 'system',
    font: Object.hasOwn(fonts, source.font) ? source.font : 'system',
    radius: Object.hasOwn(radii, source.radius) ? source.radius : 'soft',
    density: source.density === 'compact' ? 'compact' : 'comfortable',
    ...Object.fromEntries(
      ['light', 'dark'].map((mode) => [
        mode,
        Object.fromEntries(
          tokens.map((token) => [
            token,
            color(source[mode]?.[token])
              ? source[mode][token].toLowerCase()
              : palettes[mode][token]
          ])
        )
      ])
    )
  }
}
function luminance(hex) {
  const rgb = hex
    .slice(1)
    .match(/../g)
    .map((v) => parseInt(v, 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
}
function contrast(a, b) {
  const x = luminance(a),
    y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
function warnings(value) {
  const result = []
  for (const mode of ['light', 'dark']) {
    const p = value[mode]
    for (const [a, b, min] of [
      ['text', 'canvas', 4.5],
      ['text', 'surface', 4.5],
      ['mutedText', 'canvas', 4.5],
      ['mutedText', 'surface', 4.5],
      ['accentText', 'accent', 4.5],
      ['focus', 'canvas', 3],
      ['focus', 'surface', 3]
    ]) {
      if (contrast(p[a], p[b]) < min)
        result.push(
          `${
            mode === 'light' ? 'Light' : 'Dark'
          }: ${a} on ${b} needs ${min}:1 contrast.`
        )
    }
  }
  return result
}
function validate(value) {
  if (
    !value ||
    value.version !== 1 ||
    typeof value !== 'object' ||
    Array.isArray(value)
  )
    throw new Error('Choose a supported appearance version.')
  const allowed = [
    'version',
    'displayName',
    'logoText',
    'mode',
    'fallbackMode',
    'font',
    'radius',
    'density',
    'light',
    'dark',
    'logoLight',
    'logoDark'
  ]
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error('Appearance contains an unsupported setting.')
  for (const key of ['displayName', 'logoText'])
    if (
      typeof value[key] !== 'string' ||
      value[key].length > (key === 'displayName' ? 80 : 120)
    )
      throw new Error('Use a shorter display name or logo description.')
  if (
    !modes.includes(value.mode) ||
    !['system', 'light', 'dark'].includes(value.fallbackMode) ||
    !Object.hasOwn(fonts, value.font) ||
    !Object.hasOwn(radii, value.radius) ||
    !['comfortable', 'compact'].includes(value.density)
  )
    throw new Error('Choose one of the available appearance presets.')
  for (const mode of ['light', 'dark']) {
    if (
      !value[mode] ||
      Object.keys(value[mode]).some((key) => !tokens.includes(key)) ||
      tokens.some((key) => !color(value[mode][key]))
    )
      throw new Error('Use six-digit hex colours for every palette colour.')
  }
  const normalized = normalize(value)
  const problems = warnings(normalized)
  if (problems.length) throw new Error(problems.join(' '))
  return normalized
}
function variables(value, mode) {
  const appearance = normalize(value)
  return {
    ...Object.fromEntries(
      tokens.map((token) => [
        `--app-${token.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}`,
        appearance[mode][token]
      ])
    ),
    '--app-font': fonts[appearance.font],
    '--app-radius': radii[appearance.radius],
    '--app-spacing': appearance.density === 'compact' ? '.85' : '1'
  }
}
function css(value, selector = ':root') {
  const appearance = normalize(value)
  const declaration = (mode) =>
    Object.entries(variables(appearance, mode))
      .map(([k, v]) => `${k}:${v}`)
      .join(';') + `;color-scheme:${mode}`
  const mode =
    appearance.mode === 'host' ? appearance.fallbackMode : appearance.mode
  return `${selector}{${declaration(mode === 'dark' ? 'dark' : 'light')}}${
    mode === 'system'
      ? `@media(prefers-color-scheme:dark){${selector}{${declaration('dark')}}}`
      : ''
  }${selector}[data-appearance-mode="light"]{${declaration(
    'light'
  )}}${selector}[data-appearance-mode="dark"]{${declaration('dark')}}`
}
module.exports = {
  palettes,
  fonts,
  radii,
  tokens,
  normalize,
  validate,
  contrast,
  warnings,
  variables,
  css
}
