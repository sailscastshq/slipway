const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

for (const failure of ['pull', 'health'])
  test(`local upgrade cleanup retains owned names and original ${failure} failure after function scope unwinds`, () => {
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
      const script = `source "$1"\nPREVIOUS_VERSION=0.0.86\nensure_network(){ :; }\nbuild_local_image(){ :; }\ngenerate_hex_secret(){ echo fixture; }\ngenerate_base64_secret(){ echo fixture; }\ndocker(){ if [ "$1" = pull ] && [ "$FAIL_AT" = pull ]; then return 9; fi; printf '%s\\n' "$*" >> "$CALLS"; }\nwait_for_container_health(){ return 14; }\ncheck_upgrade_from_previous_release\n`
      const result = spawnSync('bash', ['-c', script, 'fixture', fixture], {
        encoding: 'utf8',
        env: { ...process.env, FAIL_AT: failure, CALLS: calls }
      })
      assert.equal(result.status, failure === 'pull' ? 9 : 14, result.stderr)
      assert.doesNotMatch(result.stderr, /unbound variable/)
      const log = fs.readFileSync(calls, 'utf8')
      assert.match(
        log,
        /rm -f slipway-upgrade-seed-\d+ slipway-upgrade-current-\d+ slipway-upgrade-candidate-\d+/
      )
      assert.match(
        log,
        /volume rm -f slipway-upgrade-db-\d+ slipway-upgrade-apps-\d+/
      )
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })
