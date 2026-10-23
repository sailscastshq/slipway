// Static source checks only: deliberately never import Tailwind, Oxide or SQLite.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFileSync } = require('node:child_process')

const root = path.resolve(__dirname, '../..')
const stylesheet = path.join(root, 'assets/css/app.css')
const css = fs.readFileSync(stylesheet, 'utf8')
const sources = [...css.matchAll(/@source\s+(['"])([^'"]+)\1\s*;/g)].map(
  (match) => path.resolve(path.dirname(stylesheet), match[2])
)
const inside = (file, directory) =>
  file === directory || file.startsWith(directory + path.sep)

function inspectTree(directory) {
  assert.ok(
    !fs.lstatSync(directory).isSymbolicLink(),
    'source root must not be a symlink'
  )
  const files = []
  const pending = [directory]
  while (pending.length) {
    const entry = pending.pop()
    const info = fs.lstatSync(entry)
    assert.ok(
      !info.isSymbolicLink(),
      'source tree must not contain symlinks: ' +
        path.relative(directory, entry)
    )
    assert.ok(
      inside(fs.realpathSync(entry), fs.realpathSync(directory)),
      'source escaped its root'
    )
    if (info.isDirectory())
      for (const name of fs.readdirSync(entry))
        pending.push(path.join(entry, name))
    else if (info.isFile()) files.push(entry)
    else assert.fail('source tree contains a non-regular file')
  }
  return files
}

test('Tailwind automatic discovery is disabled and only UI roots are registered', () => {
  assert.match(css, /@import\s+(['"])tailwindcss\1\s+source\(none\)\s*;/)
  assert.equal(
    [...css.matchAll(/@import\b/g)].length,
    1,
    'review any additional CSS imports for discovery'
  )
  assert.equal(
    [...css.matchAll(/@source\b/g)].length,
    2,
    'no hidden, glob, inline or extra discovery roots'
  )
  assert.deepEqual(
    sources.sort(),
    [path.join(root, 'assets/js'), path.join(root, 'views')].sort()
  )
  for (const excluded of [
    'db',
    'backups',
    'data',
    '.tmp',
    'apps',
    'tests',
    'node_modules'
  ]) {
    const directory = path.join(root, excluded)
    assert.ok(
      !sources.some((source) => inside(directory, source)),
      excluded + ' must not be scanned'
    )
  }
})

test('registered roots contain the tracked Vue/JS class maps, copied UI components and EJS templates', () => {
  const tracked = execFileSync(
    'git',
    ['ls-files', '-z', '--', 'assets/js', 'views'],
    { cwd: root, encoding: 'utf8' }
  )
    .split('\0')
    .filter(Boolean)
  const ui = tracked.filter((file) =>
    /\.(vue|[cm]?js|jsx|ts|tsx|ejs|html)$/.test(file)
  )
  assert.ok(
    ui.some(
      (file) => file.startsWith('assets/js/pages/') && file.endsWith('.vue')
    )
  )
  assert.ok(
    ui.some(
      (file) =>
        file.startsWith('assets/js/components/ui/') && file.endsWith('.vue')
    )
  )
  assert.ok(
    ui.some((file) => file.startsWith('assets/js/lib/') && file.endsWith('.js'))
  )
  assert.ok(ui.includes('assets/js/app.js'))
  assert.ok(ui.includes('views/app.ejs'))
  assert.ok(
    ui.some((file) => file.startsWith('views/emails/') && file.endsWith('.ejs'))
  )
  for (const file of ui)
    assert.ok(
      sources.some((source) => inside(path.join(root, file), source)),
      file + ' is not covered'
    )
})

test('current source roots contain only regular files/directories, without symlink escapes', () => {
  for (const source of sources) assert.ok(inspectTree(source).length > 0)
})

test('static containment check rejects a future link to runtime data without reading its contents', () => {
  const fixture = fs.mkdtempSync(
    path.join(os.tmpdir(), 'tailwind-static-boundary-')
  )
  try {
    const frontend = path.join(fixture, 'frontend')
    const runtime = path.join(fixture, 'runtime')
    fs.mkdirSync(frontend)
    fs.mkdirSync(runtime)
    fs.writeFileSync(
      path.join(frontend, 'component.vue'),
      '<div class="border-dashed" />'
    )
    assert.equal(inspectTree(frontend).length, 1)
    fs.symlinkSync(runtime, path.join(frontend, 'data-link'), 'dir')
    assert.throws(() => inspectTree(frontend), /must not contain symlinks/)
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true })
  }
})
