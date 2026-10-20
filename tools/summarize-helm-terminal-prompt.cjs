const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = process.argv[2] || '.tmp/screenshots/helm-terminal-prompt'
const read = (variant) =>
  JSON.parse(fs.readFileSync(path.join(root, variant, 'metrics.json'), 'utf8'))
const baseline = read('baseline')
const current = read('current')
assert.deepEqual(current.fixture, baseline.fixture)
assert.deepEqual(current.methodology, baseline.methodology)
assert.deepEqual(current.browser, baseline.browser)
assert.equal(current.cases.length, 4)
assert.equal(baseline.cases.length, 4)
const comparison = {
  baselineComponentRevision: baseline.sourceRevision,
  currentComponentRevision: current.sourceRevision,
  scope:
    'Only HelmCommandConsole.vue and HelmWriteGuardDialog.vue are swapped. Both trials use the current backend, dependencies, browser, and deterministic synthetic container-runner fixture.',
  limits: current.methodology.limits,
  fixture: current.fixture,
  cases: current.cases.map((after, index) => {
    const before = baseline.cases[index]
    assert.equal(after.device, before.device)
    assert.equal(after.theme, before.theme)
    assert.equal(after.layout.viewportWidth, before.layout.viewportWidth)
    assert.equal(after.layout.viewportHeight, before.layout.viewportHeight)
    return {
      device: after.device,
      theme: after.theme,
      modeClickToSecondAnimationFrameMedianMs: {
        baseline: before.modeClickToSecondAnimationFrame.medianMs,
        current: after.modeClickToSecondAnimationFrame.medianMs
      },
      inputEventToSecondAnimationFrameMedianMs: {
        baseline: before.inputEventToSecondAnimationFrame.medianMs,
        current: after.inputEventToSecondAnimationFrame.medianMs
      },
      layout: { baseline: before.layout, current: after.layout }
    }
  })
}
fs.writeFileSync(
  path.join(root, 'comparison.json'),
  JSON.stringify(comparison, null, 2) + '\n'
)
const lines = [
  '# Helm terminal prompt paired evidence',
  '',
  `Baseline components: ${comparison.baselineComponentRevision}`,
  `Current components: ${comparison.currentComponentRevision}`,
  '',
  comparison.scope,
  '',
  'The screenshots are real browser captures. Command results are synthetic: the container runner returns exactly `2` followed by a newline for the displayed `node -p 1+1`, then a multi-line readiness summary matching the displayed Node JSON expression. No actual container command or production workload is executed, and the summary is not an observed service-health report. Both versions use the same Production target, commands, stdout, exit 0, and synthetic duration. History contains deterministic source/status metadata only.',
  '',
  'Each version contains focused-native-caret, idle, warning, completed arithmetic, meaningful-output, edited-draft, history-open, and history-restored screenshots at 1440×900 and 390×844 in light and dark mode. Production arming is separately asserted to perform zero executions; only the subsequent explicit submit completes each fixture. Editing the draft and restoring history preserve the prior output and do not execute. The same history-restoration action intentionally leaves the baseline panel open and closes the current panel.',
  '',
  'The focused-native-caret captures show an empty field with the browser’s native caret; typed command/output states are captured separately, and the remaining captures hide it for stable comparison. Focus, visible caret color, and native selection are asserted in each viewport and theme. A still image does not measure the browser’s blink cadence.',
  '',
  'The prompt remains at the top in both versions. The current idle view omits the Ready status and empty-output placeholder, whether the draft is empty or typed but not run. Running, completed, and attention states still retain their status and output context.',
  '',
  '## Browser timing samples',
  '',
  'Nine samples per viewport/theme follow one untimed warmup. A real browser click or input event starts performance.now(); the second requestAnimationFrame ends the sample. These values include frame scheduling and are expected to be noisy. Raw samples are in each metrics.json.',
  '',
  comparison.limits,
  '',
  '| Viewport / theme | Mode reveal median, baseline / current (ms) | Input median, baseline / current (ms) |',
  '| --- | ---: | ---: |'
]
for (const item of comparison.cases) {
  const reveal = item.modeClickToSecondAnimationFrameMedianMs
  const input = item.inputEventToSecondAnimationFrameMedianMs
  lines.push(
    `| ${item.device} / ${item.theme} | ${reveal.baseline.toFixed(
      2
    )} / ${reveal.current.toFixed(2)} | ${input.baseline.toFixed(
      2
    )} / ${input.current.toFixed(2)} |`
  )
}
lines.push(
  '',
  'No performance improvement is inferred from these small synthetic samples. This is paired presentation and basic responsiveness evidence; runtime correctness remains covered by separate command contracts.',
  ''
)
fs.writeFileSync(path.join(root, 'README.md'), lines.join('\n'))
console.log(lines.join('\n'))
