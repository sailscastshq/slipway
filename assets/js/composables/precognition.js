export function usePrecognitionValidation(form) {
  function validateOnBlur(field) {
    if (String(form[field] ?? '').trim()) {
      form.validate(field)
    }
  }

  function revalidateWhenInvalid(field) {
    if (form.invalid(field)) {
      form.validate(field)
    }
  }

  return {
    revalidateWhenInvalid,
    validateOnBlur
  }
}
