const { test } = require('sounding')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
async function harness(overrides = {}) {
  const helpers = await import(
    '../../../assets/js/components/ui/schedule-picker/schedule.js'
  )
  const props = {
    modelValue: '2026-10-22T08:30:50.368Z',
    timeZone: 'Africa/Lagos',
    locale: 'en-GB',
    allowPast: true,
    minuteStep: 15,
    ...overrides
  }
  const emitted = []
  const source = fs
    .readFileSync(
      require.resolve(
        '../../../assets/js/components/ui/schedule-picker/SchedulePicker.vue'
      ),
      'utf8'
    )
    .split('<script setup>')[1]
    .split('</script>')[0]
    .replace(/^import[\s\S]*?from ['"][^'"]+['"]\n/gm, '')
  const context = {
    ...helpers,
    defineOptions() {},
    defineProps: () => props,
    defineEmits:
      () =>
      (...args) =>
        emitted.push(args),
    defineExpose() {},
    useAttrs: () => ({}),
    useId: () => 'precision-test',
    ref: (value) => ({ value }),
    computed: (fn) => ({
      get value() {
        return fn()
      }
    }),
    watch() {},
    nextTick: async () => {},
    Date,
    Intl
  }
  vm.runInNewContext(
    source +
      '\nglobalThis.api = { useExactMinute, stage, finish, interpretation, selectedDate, selectedTime, constraintError };',
    context
  )
  return { ...context.api, emitted }
}
test('minute correction is explicit; unchanged selection retains seconds and milliseconds', async () => {
  const h = await harness()
  h.stage()
  h.finish()
  assert.equal(
    h.emitted.find((e) => e[0] === 'update:modelValue')[1],
    '2026-10-22T08:30:50.368Z'
  )
  const corrected = await harness()
  corrected.useExactMinute()
  assert.equal(
    corrected.emitted.find((e) => e[0] === 'update:modelValue')[1],
    '2026-10-22T08:30:00.000Z'
  )
})
test('minute correction retains the later DST-overlap occurrence rather than changing the hour', async () => {
  const h = await harness({
    modelValue: '2026-11-01T06:30:27.123Z',
    timeZone: 'America/New_York'
  })
  h.useExactMinute()
  assert.equal(
    h.emitted.find((e) => e[0] === 'update:modelValue')[1],
    '2026-11-01T06:30:00.000Z'
  )
})
test('minute correction cannot commit before a legitimate minimum boundary', async () => {
  const h = await harness({ min: '2026-10-22T08:30:50.000Z' })
  h.useExactMinute()
  assert.equal(h.constraintError.value, 'min')
  assert.equal(h.emitted.length, 0)
})
test('disabled and readonly precision actions never change the selected instant', async () => {
  for (const restriction of [{ disabled: true }, { readonly: true }]) {
    const h = await harness(restriction)
    h.useExactMinute()
    assert.equal(h.interpretation.value.iso, '2026-10-22T08:30:50.368Z')
    assert.equal(h.emitted.length, 0)
  }
})
