import { questInputType } from '../../lib/questWorkspace.mjs'

const own = (value, key) =>
  Object.prototype.hasOwnProperty.call(value || {}, key)

// Input drafts stay in component memory. Never persist secrets, results, or
// submitted inputs in query state, localStorage, or browser history.
export function createQuestInputDraft(inputs = [], previous = {}) {
  return Object.fromEntries(
    inputs.map((input) => {
      const type = questInputType(input)
      let value
      if (!input.sensitive) {
        if (own(previous, input.name)) value = previous[input.name]
        else if (own(input, 'defaultsTo')) value = input.defaultsTo
      }
      const included = value !== undefined || input.required === true
      const raw =
        value === undefined
          ? ''
          : ['json', 'ref', 'object', 'array'].includes(type)
          ? JSON.stringify(value, null, 2)
          : value
      return [input.name, { included, raw }]
    })
  )
}

export function validateQuestInputs(inputs = [], draft = {}) {
  const values = {}
  const errors = {}
  for (const input of inputs) {
    const entry = draft[input.name] || { included: false, raw: '' }
    const type = questInputType(input)
    if (!entry.included) {
      if (input.required) errors[input.name] = 'This input is required.'
      continue
    }
    let value = entry.raw
    if (type === 'number') {
      if (
        value === '' ||
        value === null ||
        (typeof value === 'string' && value.trim() === '') ||
        !Number.isFinite(Number(value))
      ) {
        errors[input.name] = 'Enter a valid number.'
        continue
      }
      value = Number(value)
    } else if (type === 'boolean') {
      if (input.sensitive && value === 'true') value = true
      if (input.sensitive && value === 'false') value = false
      if (value !== true && value !== false) {
        errors[input.name] = 'Choose true or false.'
        continue
      }
    } else if (['json', 'ref', 'object', 'array'].includes(type)) {
      try {
        value = JSON.parse(value)
      } catch {
        errors[input.name] = 'Enter valid JSON.'
        continue
      }
      if (type === 'array' && !Array.isArray(value)) {
        errors[input.name] = 'Enter a JSON array.'
        continue
      }
      if (
        type === 'object' &&
        (value === null || Array.isArray(value) || typeof value !== 'object')
      ) {
        errors[input.name] = 'Enter a JSON object.'
        continue
      }
    } else if (typeof value !== 'string') {
      errors[input.name] = 'Enter a string.'
      continue
    }
    if (input.required && (value === null || value === '')) {
      errors[input.name] = 'This input is required.'
    } else if (
      Array.isArray(input.isIn) &&
      !input.isIn.some(
        (option) => JSON.stringify(option) === JSON.stringify(value)
      )
    ) {
      errors[input.name] = 'Choose one of the allowed values.'
    } else if (
      typeof value === 'number' &&
      Number.isFinite(input.min) &&
      value < input.min
    ) {
      errors[input.name] = `Must be at least ${input.min}.`
    } else if (
      typeof value === 'number' &&
      Number.isFinite(input.max) &&
      value > input.max
    ) {
      errors[input.name] = `Must be at most ${input.max}.`
    } else if (
      (typeof value === 'string' || Array.isArray(value)) &&
      Number.isFinite(input.minLength) &&
      value.length < input.minLength
    ) {
      errors[input.name] = `Use at least ${input.minLength} characters.`
    } else if (
      (typeof value === 'string' || Array.isArray(value)) &&
      Number.isFinite(input.maxLength) &&
      value.length > input.maxLength
    ) {
      errors[input.name] = `Use at most ${input.maxLength} characters.`
    } else {
      Object.defineProperty(values, input.name, {
        value,
        enumerable: true,
        configurable: true,
        writable: true
      })
    }
  }
  return { values, errors, valid: Object.keys(errors).length === 0 }
}

export async function requestQuestInvocation(
  url,
  body,
  csrf = '',
  fetchRequest = fetch
) {
  const unconfirmed = {
    state: 'unconfirmed',
    error:
      'No acceptance was received. The job may have started. Check Runs before submitting again.'
  }
  let response
  try {
    response = await fetchRequest(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify(body)
    })
  } catch {
    return unconfirmed
  }
  if (!response.ok) {
    let detail
    try {
      detail = await response.json()
    } catch {
      /* A non-JSON rejection is still request evidence only. */
    }
    if (detail?.code === 'QUEST_UNCONFIRMED' || response.status >= 500) {
      return {
        ...unconfirmed,
        error: `${
          typeof detail?.message === 'string'
            ? detail.message
            : `Request failed (HTTP ${response.status}).`
        } ${unconfirmed.error}`
      }
    }
    return {
      state: 'request_failed',
      error:
        typeof detail?.message === 'string'
          ? detail.message
          : `Request rejected (HTTP ${response.status}).`,
      errors: detail?.errors || null
    }
  }
  let data
  try {
    data = await response.json()
  } catch {
    return unconfirmed
  }
  if (
    typeof data?.run?.runId !== 'string' ||
    !data.run.runId ||
    typeof data.run.state !== 'string' ||
    !data.run.state
  )
    return unconfirmed
  return { state: 'accepted', run: data.run }
}
