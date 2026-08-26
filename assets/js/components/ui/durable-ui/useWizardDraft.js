import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { clearDraft, clone, readDraft, writeDraft } from './core.js'

export function useWizardDraft(key, defaults, options = {}) {
  const stepKeys = Object.keys(defaults)
  const currentStep = ref(1)
  const steps = ref(clone(defaults))
  const draft = ref(null)
  const restored = ref(false)
  let timer

  const currentStepKey = computed(() => stepKeys[currentStep.value - 1])
  const canGoBack = computed(() => currentStep.value > 1)
  const canGoNext = computed(() => currentStep.value < stepKeys.length)
  const data = computed(() => Object.assign({}, ...Object.values(steps.value)))

  function apply(saved) {
    if (!saved) return null
    steps.value = merge(defaults, saved.data.steps)
    currentStep.value = clamp(saved.data.currentStep, stepKeys.length)
    restored.value = true
    return saved.data
  }

  function load() {
    draft.value = readDraft(key, {
      namespace: options.namespace || 'wizard',
      ttl: options.ttl ?? 7 * 24 * 60 * 60 * 1000,
      ...options
    })
    if (draft.value && options.restoreOnMount !== false) apply(draft.value)
    return draft.value
  }

  function save() {
    draft.value = writeDraft(
      key,
      { currentStep: currentStep.value, steps: steps.value },
      {
        namespace: options.namespace || 'wizard',
        ttl: options.ttl ?? 7 * 24 * 60 * 60 * 1000,
        isEmpty: () => false,
        ...options
      }
    )
    return draft.value
  }

  function clear() {
    clearTimeout(timer)
    clearDraft(key, { namespace: options.namespace || 'wizard', ...options })
    draft.value = null
    restored.value = false
  }

  function goTo(step) {
    const number = typeof step === 'string' ? stepKeys.indexOf(step) + 1 : step
    currentStep.value = clamp(number, stepKeys.length)
  }

  function update(step, patch) {
    const name = typeof step === 'number' ? stepKeys[step - 1] : step
    if (!stepKeys.includes(name)) return
    const next = typeof patch === 'function' ? patch(steps.value[name]) : patch
    steps.value = { ...steps.value, [name]: { ...steps.value[name], ...next } }
  }

  function reset() {
    clear()
    currentStep.value = 1
    steps.value = clone(defaults)
  }

  onMounted(load)
  onBeforeUnmount(() => clearTimeout(timer))
  watch(
    [currentStep, steps],
    () => {
      if (options.enabled === false || read(options.clearWhen)) return
      clearTimeout(timer)
      timer = setTimeout(save, options.debounceMs ?? 500)
    },
    { deep: true }
  )
  watch(
    () => read(options.clearWhen),
    (done) => {
      if (done) clear()
    }
  )

  return {
    canGoBack,
    canGoNext,
    clear,
    currentStep,
    currentStepKey,
    data,
    draft,
    goBack: () => goTo(currentStep.value - 1),
    goNext: () => goTo(currentStep.value + 1),
    goTo,
    load,
    reset,
    restore: () => apply(draft.value),
    restored,
    save,
    stepKeys,
    steps,
    update
  }
}

function read(source) {
  return typeof source === 'function' ? source() : source?.value ?? source
}

function clamp(value, total) {
  const number = Number(value)
  return Number.isFinite(number)
    ? Math.min(Math.max(Math.trunc(number), 1), total)
    : 1
}

function merge(defaults, saved = {}) {
  return Object.fromEntries(
    Object.entries(defaults).map(([key, value]) => [
      key,
      { ...value, ...(saved[key] || {}) }
    ])
  )
}
