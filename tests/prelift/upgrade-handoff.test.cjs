const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Database = require('better-sqlite3')
const handoff = require('../../api/lib/upgrade-handoff')
function fixture(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'upgrade-handoff-'))
  const database = path.join(directory, 'app.db')
  const db = new Database(database)
  db.exec(
    "CREATE TABLE users(id INTEGER PRIMARY KEY, auth_version TEXT, is_genesis_user INTEGER); INSERT INTO users VALUES(1,'current-version',1),(2,'member-version',0)"
  )
  const options = {
    database,
    secret: 'synthetic-current-session-secret-value',
    actorUserId: 1,
    authVersion: 'current-version',
    instanceId: 'fixture-instance',
    reviewHash: 'a'.repeat(64),
    now: 1000000,
    consumedNonces: []
  }
  try {
    run({ db, options, grant: handoff.sign(options) })
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
}
test('handoff binds existing founder authentication to one reviewed instance plan', () =>
  fixture(({ options, grant }) => {
    const proof = handoff.verify({ ...options, grant })
    assert.equal(proof.actorUserId, 1)
    assert.equal(proof.reviewHash, options.reviewHash)
    assert.ok(!JSON.stringify(grant).includes(options.secret))
  }))
test('wrong instance, plan, signature, expiry, nonce replay and team membership cannot authorize an upgrade', () =>
  fixture(({ options, grant }) => {
    for (const change of [
      { instanceId: 'another-instance' },
      { reviewHash: 'b'.repeat(64) },
      { secret: 'another-synthetic-session-secret-value' },
      { now: options.now + 120000 },
      { consumedNonces: [grant.claims.nonce] },
      { grant: { ...grant, claims: { ...grant.claims, actorUserId: 2 } } },
      {
        grant: handoff.sign({
          ...options,
          actorUserId: 2,
          authVersion: 'member-version'
        })
      }
    ]) {
      assert.throws(() => handoff.verify({ ...options, grant, ...change }), {
        code: 'upgradeHandoffRejected'
      })
    }
  }))
test('password rotation, founder removal and revoked founder authority invalidate an existing handoff', () =>
  fixture(({ db, options, grant }) => {
    db.exec("UPDATE users SET auth_version='rotated' WHERE id=1")
    assert.throws(() => handoff.verify({ ...options, grant }), {
      code: 'upgradeHandoffRejected'
    })
    db.exec(
      "UPDATE users SET auth_version='current-version',is_genesis_user=0 WHERE id=1"
    )
    assert.throws(() => handoff.verify({ ...options, grant }), {
      code: 'upgradeHandoffRejected'
    })
    db.exec('DELETE FROM users WHERE id=1')
    assert.throws(() => handoff.verify({ ...options, grant }), {
      code: 'upgradeHandoffRejected'
    })
  }))

test('native founder authority handles SQLite text booleans and rejects false or unknown text', () =>
  fixture(({ db, options, grant }) => {
    for (const value of ['1', '1.0', 'true']) {
      db.prepare('UPDATE users SET is_genesis_user=? WHERE id=1').run(value)
      assert.equal(handoff.verify({ ...options, grant }).actorUserId, 1)
    }
    for (const value of ['0', '0.0', 'false', 'unknown', '', 2, null]) {
      db.prepare('UPDATE users SET is_genesis_user=? WHERE id=1').run(value)
      assert.throws(() => handoff.verify({ ...options, grant }), {
        code: 'upgradeHandoffRejected'
      })
    }
  }))
