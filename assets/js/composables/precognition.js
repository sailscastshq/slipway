export function usePrecognitionValidation(form) {
  function validateOnBlur(field, event) {
    if (event?.relatedTarget?.closest?.('button[type="submit"], a[href]')) {
      return
    }

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
