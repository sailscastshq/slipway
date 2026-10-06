#!/usr/bin/env node
// Container compatibility entrypoint; fixed shared operation and private input.
const fs = require('node:fs')
const path = require('node:path')
const { run } = require('../api/lib/upgrade-host-program')
async function readInput() {
  if (process.argv[2] === '--request-file') {
    const filename = process.argv[3]
    const stat = fs.lstatSync(filename)
    if (
      !stat.isFile() ||
      stat.uid !== 0 ||
      (stat.mode & 0o777) !== 0o600 ||
      stat.size > 1024 * 1024
    )
      throw new Error('Invalid private request')
    const input = JSON.parse(fs.readFileSync(filename, 'utf8'))
    if (
      !path.isAbsolute(input.directory || '') ||
      !fs
        .realpathSync(filename)
        .startsWith(fs.realpathSync(input.directory) + path.sep)
    )
      throw new Error('Unbound request')
    fs.unlinkSync(filename)
    return input
  }
  if (process.argv.length !== 2) throw new Error('Unsupported input')
  const chunks = []
  let bytes = 0
  for await (const chunk of process.stdin) {
    bytes += chunk.length
    if (bytes > 1024 * 1024) throw new Error('Input too large')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString())
}
readInput()
  .then(run)
  .then((result) => {
    process.stdout.write(JSON.stringify(result) + '\n')
    if (result.success === false || result.recoveryRequired)
      process.exitCode = 1
  })
  .catch((failure) => {
    const code = /^upgrade[A-Za-z]+$/.test(failure.code || '')
      ? failure.code
      : 'upgradeHostRecoveryRequired'
    process.stdout.write(
      JSON.stringify({ success: false, code, recoveryRequired: true }) + '\n'
    )
    process.exitCode = 1
  })
