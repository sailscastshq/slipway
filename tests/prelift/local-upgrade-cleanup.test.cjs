const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

function rehearse({ failure = '', mode = 'development' } = {}) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'slipway-upgrade-trap-')
  )
  try {
    const source = fs
      .readFileSync(path.resolve('local.sh'), 'utf8')
      .replace(/\nmain\s*$/, '\n')
    const fixture = path.join(directory, 'installer.sh')
    fs.writeFileSync(fixture, source)
    const calls = path.join(directory, 'calls')
    const script = `source "$1"
PREVIOUS_VERSION=0.0.124
ensure_network(){ :; }
build_local_image(){ :; }
generate_hex_secret(){ echo fixture; }
generate_base64_secret(){ echo fixture; }
docker(){
  if [ "$1" = pull ] && [ "$FAIL_AT" = pull ]; then return 9; fi
  printf '%s\\n' "$*" >> "$CALLS"
  if [ "$1" = run ] && [ "$2" = --rm ] && [ "$3" = --entrypoint ]; then
    if [ "$FAIL_AT" = probe ]; then return 18; fi
    echo "$IMAGE_SEED_MODE"
  fi
}
wait_for_container_health(){ if [ "$FAIL_AT" = health ]; then return 14; fi; }
check_upgrade_from_previous_release
`
    const result = spawnSync('bash', ['-c', script, 'fixture', fixture], {
      encoding: 'utf8',
      env: {
        ...process.env,
        FAIL_AT: failure,
        IMAGE_SEED_MODE: mode,
        CALLS: calls
      }
    })
    return { result, log: fs.readFileSync(calls, 'utf8') }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

for (const [failure, status] of [
  ['pull', 9],
  ['health', 14],
  ['probe', 18]
]) {
  test(`local upgrade cleanup retains owned names and original ${failure} failure after function scope unwinds`, () => {
    const { result, log } = rehearse({ failure })
    assert.equal(result.status, status, result.stderr)
    assert.doesNotMatch(result.stderr, /unbound variable/)
    assert.match(
      log,
      /rm -f slipway-upgrade-seed-\d+ slipway-upgrade-current-\d+ slipway-upgrade-candidate-\d+/
    )
    assert.match(
      log,
      /volume rm -f slipway-upgrade-db-\d+ slipway-upgrade-apps-\d+/
    )
  })
}

for (const mode of ['development', 'production']) {
  test(`local upgrade seeds with the previous image's supported ${mode} startup and validates both production writers`, () => {
    const { result, log } = rehearse({ mode })
    assert.equal(result.status, 0, result.stderr)
    const seed = log
      .split('\n')
      .find((line) => /^run -d --name slipway-upgrade-seed-/.test(line))
    assert.ok(seed.includes(`NODE_ENV=${mode}`), seed)
    for (const role of ['current', 'candidate']) {
      const command = log
        .split('\n')
        .find((line) =>
          new RegExp(`^run -d --name slipway-upgrade-${role}-`).test(line)
        )
      assert.ok(command.includes('NODE_ENV=production'), command)
    }
    assert.match(log, /preflightOnly:true/)
  })
}

test('local upgrade refuses an invalid startup probe instead of silently changing schema policy', () => {
  const { result, log } = rehearse({ mode: 'unknown' })
  assert.equal(result.status, 1)
  assert.match(
    result.stderr,
    /Could not determine the previous image's supported startup mode/
  )
  assert.doesNotMatch(log, /run -d --name slipway-upgrade-seed-/)
  assert.match(
    log,
    /volume rm -f slipway-upgrade-db-\d+ slipway-upgrade-apps-\d+/
  )
})
