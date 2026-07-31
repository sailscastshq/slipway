export function usePrecognitionValidation(form) {
  function valueFor(field) {
    return field.split('.').reduce((value, segment) => value?.[segment], form)
  }

  function validateOnBlur(field, event) {
    if (event?.relatedTarget?.closest?.('button, a[href]')) {
      return
    }

    if (String(valueFor(field) ?? '').trim()) {
      form.validate(field)
    }
  }

  function revalidateWhenInvalid(field) {
    if (form.invalid(field)) {
      form.validate(field)
    }
  }

  function applyResponseProblems(problems = []) {
    const errors = Object.assign(
      {},
      ...problems.filter(
        (problem) =>
          problem && typeof problem === 'object' && !Array.isArray(problem)
      )
    )

    if (Object.keys(errors).length) {
      form.setError(errors)
      return true
    }

    return false
  }

  return {
    applyResponseProblems,
    revalidateWhenInvalid,
    validateOnBlur
  }
}
